"use client";
import { motion } from "framer-motion";
import { MiniBar } from "./mini-bar";
import { ProgressRing } from "./progress-ring";

interface EngagementDepthProps {
  scrollDistribution: {
    bucket0to20: number;
    bucket20to40: number;
    bucket40to60: number;
    bucket60to80: number;
    bucket80to100: number;
  };
  focusRatio: number; // 0-100
  activeTimeMs: number;
  wallTimeMs: number;
  annotationsByType: Record<string, { viewed: number; total: number }>;
}

const SCROLL_LABELS = ["0–20%", "20–40%", "40–60%", "60–80%", "80–100%"];
const ANNOTATION_TYPES = [
  {
    key: "cross_reference",
    label: "Cross-ref",
    color: "stroke-annotation-crossref",
  },
  { key: "context", label: "Context", color: "stroke-annotation-context" },
  { key: "tension", label: "Tension", color: "stroke-annotation-tension" },
  { key: "question", label: "Question", color: "stroke-annotation-question" },
];

function formatTime(ms: number): string {
  const totalMin = Math.round(ms / 60000);
  if (totalMin < 60) return `${totalMin}m`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

export function EngagementDepth({
  scrollDistribution,
  focusRatio,
  activeTimeMs,
  wallTimeMs,
  annotationsByType,
}: EngagementDepthProps) {
  const buckets = [
    scrollDistribution.bucket0to20,
    scrollDistribution.bucket20to40,
    scrollDistribution.bucket40to60,
    scrollDistribution.bucket60to80,
    scrollDistribution.bucket80to100,
  ];
  const maxBucket = Math.max(1, ...buckets);

  const focusColor =
    focusRatio >= 80
      ? "bg-annotation-context"
      : focusRatio >= 60
        ? "bg-annotation-crossref"
        : "bg-annotation-tension";

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.2 }}
      className="p-5 rounded-lg border border-[var(--reader-border)] bg-[var(--reader-surface)]"
    >
      <h2 className="text-sm font-medium text-[var(--reader-fg)] mb-5">
        Engagement depth
      </h2>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
        {/* Scroll depth */}
        <div>
          <p className="text-[12px] font-sans text-[var(--reader-muted)] mb-2">
            Scroll depth
          </p>
          <div className="space-y-1">
            {buckets.map((count, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="text-[11px] font-sans text-[var(--reader-muted)] w-12">
                  {SCROLL_LABELS[i]}
                </span>
                <div className="flex-1 h-3 rounded-sm bg-[var(--reader-chip)] overflow-hidden">
                  <div
                    className="h-full rounded-sm bg-annotation-crossref"
                    style={{
                      width: `${(count / maxBucket) * 100}%`,
                      opacity: 0.4 + (i / 4) * 0.6,
                    }}
                  />
                </div>
                <span className="text-[11px] font-sans text-[var(--reader-muted)] w-3 text-right">
                  {count}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Focus ratio */}
        <div>
          <p className="text-[12px] font-sans text-[var(--reader-muted)] mb-2">
            Focus
          </p>
          <div className="flex items-baseline gap-2 mb-2">
            <span className="text-lg font-serif text-[var(--reader-fg)]">
              {focusRatio > 0 ? `${focusRatio}%` : "—"}
            </span>
            {focusRatio >= 80 && (
              <span className="text-[9px] font-sans text-annotation-context">
                Focused
              </span>
            )}
          </div>
          <MiniBar
            value={focusRatio}
            width="100%"
            height="4px"
            color={focusColor}
          />
          <div className="flex flex-wrap justify-between gap-2 mt-2 text-[11px] font-sans text-[var(--reader-muted)]">
            <span>Active: {formatTime(activeTimeMs)}</span>
            <span>Wall: {formatTime(wallTimeMs)}</span>
          </div>
        </div>

        {/* Annotation engagement */}
        <div>
          <p className="text-[12px] font-sans text-[var(--reader-muted)] mb-2">
            Annotations
          </p>
          <div className="grid grid-cols-2 gap-3">
            {ANNOTATION_TYPES.map((t) => {
              const d = annotationsByType[t.key] ?? { viewed: 0, total: 0 };
              const pct =
                d.total > 0 ? Math.round((d.viewed / d.total) * 100) : 0;
              return (
                <div key={t.key} className="flex items-center gap-1.5">
                  <ProgressRing
                    value={pct}
                    size={24}
                    strokeWidth={2.5}
                    color={t.color}
                  />
                  <div>
                    <p className="text-[11px] font-sans text-[var(--reader-muted)]">
                      {t.label}
                    </p>
                    <p className="text-[11px] font-sans text-[var(--reader-muted)]">
                      {d.viewed}/{d.total}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </motion.div>
  );
}
