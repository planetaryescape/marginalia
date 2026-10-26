"use client";
import { useEffect, useMemo, useState } from "react";
import { kindOf } from "@/lib/margin-kinds";
import { getArticleBody, getParagraphs, paragraphText } from "@/lib/paragraphs";
import type { ReadingPosition } from "@/lib/reading-modes";

interface Block {
  length: number;
  heading: boolean;
  /** The margin note's stored type, or null when the paragraph has none. */
  kind: string | null;
  snippet: string;
}

const WIDTH = 34;

type ReaderMapProps = Parameters<typeof DesktopReaderMap>[0];

/** Match the CSS lg breakpoint, with no hidden map work during SSR/hydration. */
export function ReaderMap(props: ReaderMapProps) {
  const [desktop, setDesktop] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(min-width: 1024px)");
    const update = () => setDesktop(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return desktop ? <DesktopReaderMap {...props} /> : null;
}

function DesktopReaderMap({
  containerRef,
  version,
  position,
  marked,
  saved,
  ticks,
  onJump,
  minutesLeft,
}: {
  containerRef: React.RefObject<HTMLElement | null>;
  version: number;
  position: ReadingPosition;
  /** Paragraph the reading companion is talking about. */
  marked: number | null;
  /** Paragraphs with saved Ask / Explain / Simplify threads. */
  saved: number[];
  /** Paragraphs with the reader's own highlight or underline. */
  ticks: number[];
  onJump: (index: number) => void;
  /** Rough reading time still to go; shown in the map's tooltip, not the toolbar. */
  minutesLeft?: number | null;
}) {
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [viewportHeight, setViewportHeight] = useState(800);
  const [hover, setHover] = useState<number | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` bumps whenever the article is re-tagged
  useEffect(() => {
    const paragraphs = getParagraphs(getArticleBody(containerRef.current));
    setBlocks(
      paragraphs.map((el) => {
        const text = paragraphText(el);
        return {
          length: text.length,
          heading: /^H[1-6]$/.test(el.tagName),
          kind:
            el.querySelector(".annotation-mark")?.getAttribute("data-type") ??
            null,
          snippet: text.length > 90 ? `${text.slice(0, 90).trimEnd()}…` : text,
        };
      }),
    );
  }, [containerRef, version]);

  useEffect(() => {
    const onResize = () => setViewportHeight(window.innerHeight);
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const layout = useMemo(() => {
    const height = Math.min(viewportHeight - 200, blocks.length * 6);
    const pitch = blocks.length ? height / blocks.length : 0;
    const longest = Math.max(1, ...blocks.map((b) => b.length));
    return { height, pitch, longest };
  }, [blocks, viewportHeight]);

  if (blocks.length < 4 || layout.pitch <= 0) return null;

  const { height, pitch, longest } = layout;
  const barHeight = Math.max(1, Math.min(2.5, pitch * 0.55));
  const indexAt = (y: number) =>
    Math.min(blocks.length - 1, Math.max(0, Math.floor(y / pitch)));
  const windowTop = (position.firstVisible ?? 0) * pitch;
  const windowHeight =
    ((position.lastVisible ?? 0) - (position.firstVisible ?? 0) + 1) * pitch;

  return (
    <nav
      aria-label="Article map"
      className="reader-map fixed left-6 top-1/2 -translate-y-1/2 z-20 hidden lg:block"
      style={{ width: WIDTH, height }}
    >
      <div
        role="slider"
        tabIndex={0}
        aria-label="Article paragraph map"
        aria-valuemin={1}
        aria-valuemax={blocks.length}
        aria-valuenow={(hover ?? position.current ?? 0) + 1}
        aria-valuetext={`${blocks[hover ?? position.current ?? 0]?.snippet ?? ""}${minutesLeft ? `. About ${minutesLeft} min left` : ""}`}
        onKeyDown={(e) => {
          const current = hover ?? position.current ?? 0;
          const next =
            e.key === "ArrowDown" || e.key === "ArrowRight"
              ? Math.min(blocks.length - 1, current + 1)
              : e.key === "ArrowUp" || e.key === "ArrowLeft"
                ? Math.max(0, current - 1)
                : e.key === "Home"
                  ? 0
                  : e.key === "End"
                    ? blocks.length - 1
                    : e.key === "Enter" || e.key === " "
                      ? current
                      : null;
          if (next === null) return;
          e.preventDefault();
          setHover(next);
          onJump(next);
        }}
        onBlur={() => setHover(null)}
      >
        <svg
          aria-hidden="true"
          width={WIDTH}
          height={height}
          className="cursor-pointer overflow-visible"
          onMouseMove={(e) =>
            setHover(
              indexAt(e.clientY - e.currentTarget.getBoundingClientRect().top),
            )
          }
          onMouseLeave={() => setHover(null)}
          onClick={(e) =>
            onJump(
              indexAt(e.clientY - e.currentTarget.getBoundingClientRect().top),
            )
          }
        >
          {position.firstVisible !== null && (
            <rect
              x={-5}
              y={windowTop - 3}
              width={WIDTH + 10}
              height={windowHeight + 6}
              rx={5}
              className="transition-all duration-150"
              fill="var(--reader-chip)"
              stroke="var(--reader-border)"
            />
          )}
          {blocks.map((block, i) => {
            const width = block.heading
              ? WIDTH
              : Math.max(6, (block.length / longest) * WIDTH * 0.9);
            const isCurrent = i === position.current;
            const fill =
              i === marked
                ? "var(--ink)"
                : isCurrent || i === hover
                  ? "var(--reader-fg)"
                  : "var(--reader-muted)";
            return (
              <rect
                key={i}
                x={0}
                y={i * pitch + (pitch - barHeight) / 2}
                width={width}
                height={block.heading ? barHeight + 0.5 : barHeight}
                rx={barHeight / 2}
                fill={fill}
                opacity={
                  i === marked || isCurrent || i === hover
                    ? 1
                    : block.heading
                      ? 0.75
                      : 0.32
                }
              />
            );
          })}
          {blocks.map((block, i) => {
            // A kind this build doesn't know gets no dot
            const kind = block.kind === null ? undefined : kindOf(block.kind);
            return kind ? (
              <circle
                key={`kind-${i}`}
                cx={WIDTH + 5}
                cy={i * pitch + pitch / 2}
                r={2.5}
                fill={kind.color}
              />
            ) : null;
          })}
          {[...new Set(ticks)]
            .filter((i) => i >= 0 && i < blocks.length)
            .map((i) => (
              <rect
                key={`tick-${i}`}
                x={WIDTH + 10}
                y={i * pitch + pitch / 2 - 1}
                width={6}
                height={2}
                fill="var(--pen)"
              />
            ))}
          {[...new Set(saved)]
            .filter((i) => i >= 0 && i < blocks.length)
            .map((i) => (
              <circle
                key={`saved-${i}`}
                cx={-7}
                cy={i * pitch + pitch / 2}
                r={2}
                fill="var(--pencil)"
              />
            ))}
          {/* Invisible hit area so gaps between bars stay clickable */}
          <rect
            x={-6}
            y={0}
            width={WIDTH + 12}
            height={height}
            fill="transparent"
          />
        </svg>
      </div>

      {hover !== null && (
        <div
          className="absolute left-full ml-4 w-56 -translate-y-1/2 pointer-events-none rounded-lg px-3 py-2 font-sans bg-[var(--reader-surface)] ring-1 ring-[var(--reader-border)] shadow-lg"
          style={{ top: hover * pitch + pitch / 2 }}
        >
          <span className="font-mono text-[10px] text-[var(--reader-muted)]">
            ¶{hover + 1}
            {minutesLeft ? ` · about ${minutesLeft} min left` : ""}
          </span>
          <p className="mt-0.5 text-[12px] leading-snug text-[var(--reader-fg-soft)] line-clamp-3">
            {blocks[hover].snippet}
          </p>
        </div>
      )}
    </nav>
  );
}
