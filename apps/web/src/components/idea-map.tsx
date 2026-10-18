"use client";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import {
  edgeCurve,
  type Idea,
  type Link,
  layoutIdeaMap,
} from "./idea-map-layout";

type Role = Idea["role"];
type Relation = Link["relation"];

const EASE = [0.22, 1, 0.36, 1] as const;
const RANK_DELAY = 0.12;

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
    box: "bg-[var(--reader-chip)] border-[var(--pencil)] border-[1.5px]",
    caption: "text-[var(--pencil)]",
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

function ParagraphJump({
  paragraphs,
  onJump,
}: {
  paragraphs: number[];
  onJump: (index: number) => void;
}) {
  return paragraphs.map((n) => (
    <button
      key={n}
      type="button"
      onClick={() => onJump(n - 1)}
      className="inline-flex items-center align-[0.08em] mx-px px-1.5 h-[1.35em] rounded-md font-mono text-[0.72em] tabular-nums bg-[var(--reader-surface)] text-[var(--reader-muted)] hover:text-[var(--ink)] transition-colors"
    >
      ¶{n}
    </button>
  ));
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
  const layout = useMemo(() => layoutIdeaMap(ideas, links), [ideas, links]);
  const rankCount = useMemo(
    () => new Set(layout.nodes.map((n) => n.y)).size,
    [layout],
  );
  const [hovered, setHovered] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  // Entrance delays apply once; afterwards hover feedback is immediate
  const [entered, setEntered] = useState(false);

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

  const selectedIdea = ideas.find((i) => i.id === selected);
  const edgesDelay = rankCount * RANK_DELAY + 0.15;
  useEffect(() => {
    // Own one entrance clock, including maps without edges. Hover never restarts it.
    const duration = Math.max(
      Math.max(0, rankCount - 1) * RANK_DELAY + 0.45,
      edgesDelay + Math.max(0, layout.edges.length - 1) * 0.06 + 0.6,
    );
    const timer = window.setTimeout(() => setEntered(true), duration * 1000);
    return () => window.clearTimeout(timer);
  }, [rankCount, edgesDelay, layout.edges.length]);
  const rankOf = new Map(
    [...new Set(layout.nodes.map((n) => n.y))]
      .sort((a, b) => a - b)
      .map((y, r) => [y, r]),
  );

  return (
    <div>
      <div className="overflow-x-auto">
        <div
          className="relative mx-auto"
          style={{ width: layout.width, height: layout.height }}
        >
          <svg
            className="absolute inset-0 pointer-events-none overflow-visible"
            width={layout.width}
            height={layout.height}
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
            {layout.edges.map(({ link, points }, i) => {
              const style = RELATIONS[link.relation];
              const active = !focus || link.from === focus || link.to === focus;
              return (
                <motion.path
                  key={`${link.from}-${link.to}`}
                  d={edgeCurve(points, layout.direction)}
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
                      delay: entered ? 0 : edgesDelay + i * 0.06,
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

          {layout.nodes.map(({ idea, x, y, w, h }) => {
            const style = ROLE_STYLES[idea.role];
            const dimmed = connected && !connected.has(idea.id);
            const rank = rankOf.get(y) ?? 0;
            return (
              <motion.button
                key={idea.id}
                type="button"
                style={{ left: x, top: y, width: w, height: h }}
                initial={{ opacity: 0, y: 8, filter: "blur(4px)" }}
                animate={{
                  opacity: dimmed ? 0.35 : 1,
                  y: 0,
                  filter: "blur(0px)",
                }}
                transition={{
                  duration: 0.45,
                  ease: EASE,
                  delay: entered ? 0 : rank * RANK_DELAY,
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
                  "absolute rounded-lg border px-2.5 py-2 text-left outline-none transition-shadow",
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
              <ParagraphJump
                paragraphs={selectedIdea.paragraphs}
                onJump={onJump}
              />
            </p>
          </motion.div>
        ) : (
          <motion.p
            key="hint"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ delay: entered ? 0 : edgesDelay, duration: 0.3 }}
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
