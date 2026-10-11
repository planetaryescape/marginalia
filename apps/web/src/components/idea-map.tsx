"use client";
import type { Doc } from "@marginalia/backend/convex/_generated/dataModel";
import { AnimatePresence, motion } from "framer-motion";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";

type Idea = NonNullable<Doc<"summaries">["ideas"]>[number];
type Link = NonNullable<Doc<"summaries">["links"]>[number];
type Role = Idea["role"];
type Relation = Link["relation"];

const EASE = [0.22, 1, 0.36, 1] as const;
const ROW_DELAY = 0.12;

const ROLE_LABELS: Record<Role, string> = {
  premise: "Premise",
  evidence: "Evidence",
  claim: "Claim",
  counterpoint: "Counterpoint",
  conclusion: "Conclusion",
};

const ROLE_STYLES: Record<Role, { box: string; caption: string }> = {
  premise: {
    box: "bg-[var(--reader-chip)] border-[var(--reader-border)]",
    caption: "text-[var(--reader-muted)]",
  },
  evidence: {
    box: "bg-[var(--reader-surface)] border-dashed border-[var(--reader-border-strong)]",
    caption: "text-[var(--reader-muted)]",
  },
  claim: {
    box: "bg-[var(--reader-surface)] border-[var(--reader-border-strong)]",
    caption: "text-[var(--reader-fg-soft)]",
  },
  counterpoint: {
    box: "bg-[var(--reader-surface)] border-dashed border-annotation-tension/70",
    caption: "text-annotation-tension",
  },
  conclusion: {
    box: "bg-[var(--pen-soft)] border-[var(--pen)] border-[1.5px]",
    caption: "text-[var(--pen)]",
  },
};

const RELATIONS: Record<
  Relation,
  { label: string; stroke: string; dash?: string }
> = {
  leads_to: { label: "leads to", stroke: "var(--reader-fg-soft)" },
  supports: { label: "supports", stroke: "var(--reader-muted)" },
  illustrates: {
    label: "illustrates",
    stroke: "var(--reader-muted)",
    dash: "1 5",
  },
  contrasts: { label: "contrasts", stroke: "#b07050", dash: "5 4" },
};

/**
 * Longest-path layering: an idea sits one row below the deepest idea that
 * points at it, so the map reads top to bottom towards the conclusion.
 */
function layout(ideas: Idea[], links: Link[]): Idea[][] {
  const incoming = new Map<string, string[]>();
  for (const link of links) {
    // A contrast pushes against an idea rather than building it, so it
    // shouldn't push that idea further down the map
    if (link.relation === "contrasts") continue;
    incoming.set(link.to, [...(incoming.get(link.to) ?? []), link.from]);
  }
  const depth = new Map<string, number>();
  const visiting = new Set<string>();
  const depthOf = (id: string): number => {
    const known = depth.get(id);
    if (known !== undefined) return known;
    if (visiting.has(id)) return 0; // break cycles
    visiting.add(id);
    const parents = incoming.get(id) ?? [];
    const d = parents.length ? 1 + Math.max(...parents.map(depthOf)) : 0;
    visiting.delete(id);
    depth.set(id, d);
    return d;
  };
  for (const idea of ideas) depthOf(idea.id);

  // Conclusions always close the map
  const deepest = Math.max(0, ...ideas.map((i) => depth.get(i.id) ?? 0));
  for (const idea of ideas) {
    if (idea.role === "conclusion")
      depth.set(idea.id, deepest + (deepest === 0 ? 1 : 0));
  }
  // Counterpoints sit beside the idea they push against
  for (const link of links) {
    if (link.relation !== "contrasts") continue;
    const from = ideas.find((i) => i.id === link.from);
    if (from?.role === "counterpoint" && !incoming.has(from.id)) {
      depth.set(from.id, depth.get(link.to) ?? 0);
    }
  }

  const rows: Idea[][] = [];
  for (const idea of ideas) {
    const d = depth.get(idea.id) ?? 0;
    if (!rows[d]) rows[d] = [];
    rows[d].push(idea);
  }
  const compact = rows.filter(Boolean);

  // Order each row under its parents to keep lines from crossing
  const position = new Map<string, number>();
  compact.forEach((row, r) => {
    if (r > 0) {
      const centre = (idea: Idea) => {
        const xs = (incoming.get(idea.id) ?? [])
          .map((p) => position.get(p))
          .filter((x): x is number => x !== undefined);
        return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0.5;
      };
      row.sort((a, b) => centre(a) - centre(b));
    }
    row.forEach((idea, i) => {
      position.set(idea.id, (i + 0.5) / row.length);
    });
  });
  return compact;
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Spreads where lines leave and enter each box along its edge, ordered by
 * where the other end sits, so lines into one idea don't pile onto a point.
 */
function anchorOffsets(links: Link[], boxes: Map<string, Box>) {
  const centre = (id: string) => {
    const b = boxes.get(id);
    return b ? b.x + b.w / 2 : 0;
  };
  const offsets = new Map<string, { out: number; in: number }>();
  const entry = (l: Link) => {
    const key = `${l.from}>${l.to}`;
    const value = offsets.get(key) ?? { out: 0.5, in: 0.5 };
    offsets.set(key, value);
    return value;
  };
  for (const id of boxes.keys()) {
    const leaving = links
      .filter((l) => l.from === id)
      .sort((p, q) => centre(p.to) - centre(q.to));
    leaving.forEach((l, k) => {
      entry(l).out = (k + 1) / (leaving.length + 1);
    });
    const arriving = links
      .filter((l) => l.to === id)
      .sort((p, q) => centre(p.from) - centre(q.from));
    arriving.forEach((l, k) => {
      entry(l).in = (k + 1) / (arriving.length + 1);
    });
  }
  return offsets;
}

function edgePath(a: Box, b: Box, out = 0.5, inn = 0.5): string {
  // Same row: arc between facing sides
  if (Math.abs(a.y - b.y) < 4) {
    const leftToRight = a.x < b.x;
    const x1 = leftToRight ? a.x + a.w : a.x;
    const x2 = leftToRight ? b.x : b.x + b.w;
    const y = a.y + a.h / 2;
    const lift = Math.min(28, Math.abs(x2 - x1) / 2);
    return `M ${x1} ${y} C ${x1} ${y - lift}, ${x2} ${y - lift}, ${x2} ${y}`;
  }
  const down = b.y > a.y;
  // Keep anchors off the rounded corners
  const x1 = a.x + a.w * (0.2 + out * 0.6);
  const y1 = down ? a.y + a.h : a.y;
  const x2 = b.x + b.w * (0.2 + inn * 0.6);
  const y2 = down ? b.y - 2 : b.y + b.h + 2;
  const bend = (y2 - y1) / 2;
  return `M ${x1} ${y1} C ${x1} ${y1 + bend}, ${x2} ${y2 - bend}, ${x2} ${y2}`;
}

export function IdeaMap({
  ideas,
  links,
  onJump,
}: {
  ideas: Idea[];
  links: Link[];
  onJump: (index: number) => void;
}) {
  const rows = useMemo(() => layout(ideas, links), [ideas, links]);
  const containerRef = useRef<HTMLDivElement>(null);
  const nodeRefs = useRef(new Map<string, HTMLButtonElement>());
  const [boxes, setBoxes] = useState<Map<string, Box>>(new Map());
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [hovered, setHovered] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  // Entrance delays apply once; afterwards hover feedback is immediate
  const [entered, setEntered] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure when the rows change
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const measure = () => {
      const origin = container.getBoundingClientRect();
      const next = new Map<string, Box>();
      for (const [id, el] of nodeRefs.current) {
        // offset* ignores the entrance transforms, so lines land where nodes settle
        next.set(id, {
          x: el.offsetLeft,
          y: el.offsetTop,
          w: el.offsetWidth,
          h: el.offsetHeight,
        });
      }
      setBoxes(next);
      setSize({ w: origin.width, h: origin.height });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, [rows]);

  const focus = hovered ?? selected;
  const connected = useMemo(() => {
    if (!focus) return null;
    const set = new Set([focus]);
    for (const l of links) {
      if (l.from === focus) set.add(l.to);
      if (l.to === focus) set.add(l.from);
    }
    return set;
  }, [focus, links]);

  const offsets = useMemo(() => anchorOffsets(links, boxes), [links, boxes]);
  const selectedIdea = ideas.find((i) => i.id === selected);
  const edgesDelay = rows.length * ROW_DELAY + 0.15;

  useLayoutEffect(() => {
    const timer = window.setTimeout(
      () => setEntered(true),
      (edgesDelay + links.length * 0.06 + 0.6) * 1000,
    );
    return () => window.clearTimeout(timer);
  }, [edgesDelay, links.length]);

  return (
    <div>
      <div ref={containerRef} className="relative">
        <svg
          className="absolute inset-0 pointer-events-none overflow-visible"
          width={size.w}
          height={size.h}
          aria-hidden
        >
          <defs>
            {Object.entries(RELATIONS).map(([key, r]) => (
              <marker
                key={key}
                id={`idea-arrow-${key}`}
                viewBox="0 0 8 8"
                refX="7"
                refY="4"
                markerWidth="8"
                markerHeight="8"
                markerUnits="userSpaceOnUse"
                orient="auto-start-reverse"
              >
                <path d="M 0 0.5 L 7.5 4 L 0 7.5 z" fill={r.stroke} />
              </marker>
            ))}
          </defs>
          {links.map((link, i) => {
            const a = boxes.get(link.from);
            const b = boxes.get(link.to);
            if (!a || !b) return null;
            const style = RELATIONS[link.relation];
            const active = !focus || link.from === focus || link.to === focus;
            return (
              <motion.path
                key={`${link.from}-${link.to}`}
                d={edgePath(
                  a,
                  b,
                  offsets.get(`${link.from}>${link.to}`)?.out,
                  offsets.get(`${link.from}>${link.to}`)?.in,
                )}
                fill="none"
                stroke={style.stroke}
                strokeWidth={active && focus ? 1.75 : 1.25}
                strokeDasharray={style.dash}
                strokeLinecap="round"
                markerEnd={`url(#idea-arrow-${link.relation})`}
                initial={{ pathLength: 0, opacity: 0 }}
                animate={{ pathLength: 1, opacity: active ? 0.9 : 0.12 }}
                transition={{
                  pathLength: {
                    delay: edgesDelay + i * 0.06,
                    duration: 0.6,
                    ease: EASE,
                  },
                  opacity: {
                    duration: 0.2,
                    delay: entered ? 0 : edgesDelay + i * 0.06,
                  },
                }}
              />
            );
          })}
        </svg>

        <div className="flex flex-col gap-7">
          {rows.map((row, r) => (
            <div
              key={row.map((i) => i.id).join()}
              className="flex justify-center gap-3"
            >
              {row.map((idea, i) => {
                const style = ROLE_STYLES[idea.role];
                const dimmed = connected && !connected.has(idea.id);
                return (
                  <motion.button
                    key={idea.id}
                    ref={(el) => {
                      if (el) nodeRefs.current.set(idea.id, el);
                      else nodeRefs.current.delete(idea.id);
                    }}
                    type="button"
                    initial={{ opacity: 0, y: 8, filter: "blur(4px)" }}
                    animate={{
                      opacity: dimmed ? 0.35 : 1,
                      y: 0,
                      filter: "blur(0px)",
                    }}
                    transition={{
                      duration: 0.45,
                      ease: EASE,
                      delay: entered ? 0 : r * ROW_DELAY + i * 0.04,
                    }}
                    onMouseEnter={() => setHovered(idea.id)}
                    onMouseLeave={() => setHovered(null)}
                    onFocus={() => setHovered(idea.id)}
                    onBlur={() => setHovered(null)}
                    onClick={() =>
                      setSelected((s) => (s === idea.id ? null : idea.id))
                    }
                    aria-pressed={selected === idea.id}
                    className={cn(
                      "flex-1 basis-0 min-w-0 max-w-[200px] rounded-lg border px-2.5 py-2 text-left outline-none transition-shadow",
                      "focus-visible:ring-1 focus-visible:ring-[var(--reader-focus)]",
                      style.box,
                      selected === idea.id && "ring-1 ring-[var(--reader-fg)]",
                    )}
                  >
                    <span
                      className={cn(
                        "block text-[9.5px] font-semibold uppercase tracking-wider",
                        style.caption,
                      )}
                    >
                      {ROLE_LABELS[idea.role]}
                    </span>
                    <span className="mt-0.5 block text-[12.5px] font-medium leading-snug text-[var(--reader-fg)]">
                      {idea.label}
                    </span>
                  </motion.button>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <AnimatePresence mode="wait" initial={false}>
        {selectedIdea ? (
          <motion.div
            key={selectedIdea.id}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2 }}
            className="mt-4 rounded-lg bg-[var(--reader-chip)] px-3 py-2.5"
          >
            <p className="text-[13.5px] leading-relaxed text-[var(--reader-fg-soft)]">
              <span className="font-medium text-[var(--reader-fg)]">
                {selectedIdea.label}.
              </span>{" "}
              {selectedIdea.detail}{" "}
              {selectedIdea.paragraphs.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => onJump(n - 1)}
                  className="inline-flex items-center align-[0.08em] mx-px px-1.5 h-[1.35em] rounded-md font-mono text-[0.72em] tabular-nums bg-[var(--reader-surface)] text-[var(--reader-muted)] hover:text-[var(--pen)] transition-colors"
                >
                  ¶{n}
                </button>
              ))}
            </p>
          </motion.div>
        ) : (
          <motion.p
            key="hint"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ delay: edgesDelay, duration: 0.3 }}
            className="mt-4 text-center text-[11.5px] text-[var(--reader-muted)]"
          >
            Select an idea to see what it means and where it appears
          </motion.p>
        )}
      </AnimatePresence>

      <div className="mt-3 flex flex-wrap justify-center gap-x-4 gap-y-1">
        {Object.entries(RELATIONS).map(([key, r]) => (
          <span
            key={key}
            className="flex items-center gap-1.5 text-[10.5px] text-[var(--reader-muted)]"
          >
            <svg width="22" height="6" aria-hidden>
              <line
                x1="1"
                y1="3"
                x2="21"
                y2="3"
                stroke={r.stroke}
                strokeWidth="1.5"
                strokeDasharray={r.dash}
                strokeLinecap="round"
              />
            </svg>
            {r.label}
          </span>
        ))}
      </div>
    </div>
  );
}
