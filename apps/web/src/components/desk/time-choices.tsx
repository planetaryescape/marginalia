"use client";
import { cn } from "@/lib/utils";

const TIMES = [
  { minutes: 5, name: "Quick read", key: "1" },
  { minutes: 10, name: "Coffee break", key: "2" },
  { minutes: 20, name: "Focused", key: "3" },
  { minutes: 30, name: "Deep dive", key: "4", plus: true },
] as const;

export type Fits = Record<number, number | null>;

/**
 * Four plain numerals. A chosen time stays in ink and the others dim, so the
 * row itself says what was picked. The counts that fit are in the tooltip only.
 */
export function TimeChoices({
  chosen,
  fits,
  showKeys,
  onChoose,
  onIntent,
}: {
  chosen: number | null;
  fits?: Fits;
  showKeys: boolean;
  onChoose: (minutes: number) => void;
  /** Hover or keyboard focus: the reader is probably about to choose this one. */
  onIntent: (minutes: number) => void;
}) {
  return (
    <div
      role="group"
      aria-label="How much time do you have?"
      className="flex items-baseline justify-between sm:justify-start sm:gap-5"
    >
      {TIMES.map((time) => {
        const count = fits?.[time.minutes];
        const tooltip = [
          time.name,
          count != null ? `${count} fit` : null,
          `press ${time.key}`,
        ]
          .filter(Boolean)
          .join(" · ");
        const dimmed = chosen !== null && chosen !== time.minutes;
        return (
          <button
            key={time.minutes}
            type="button"
            title={tooltip}
            aria-pressed={chosen === time.minutes}
            aria-keyshortcuts={time.key}
            onClick={() => onChoose(time.minutes)}
            onPointerEnter={() => onIntent(time.minutes)}
            onFocus={() => onIntent(time.minutes)}
            style={{
              transition:
                "color var(--motion-quick), background-color var(--motion-quick)",
            }}
            className={cn(
              "relative flex items-baseline gap-1 rounded-lg px-2.5 py-1.5 outline-none hover:bg-[var(--reader-surface)] focus-visible:bg-[var(--reader-surface)] focus-visible:ring-1 focus-visible:ring-[var(--reader-focus)]",
              dimmed ? "text-[var(--ink-muted)]" : "text-[var(--ink)]",
            )}
          >
            <span className="font-serif text-[32px] lg:text-[40px] leading-none">
              {time.minutes}
              {"plus" in time ? "+" : ""}
            </span>
            <span className="text-[13px] text-[var(--ink-muted)]">min</span>
            {showKeys && (
              <kbd aria-hidden className="reader-kbd absolute -top-2 -right-1">
                {time.key}
              </kbd>
            )}
          </button>
        );
      })}
    </div>
  );
}
