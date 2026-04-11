"use client";
import { motion } from "framer-motion";
import { ProgressRing } from "./progress-ring";
import { MiniBar } from "./mini-bar";

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
  { key: "cross_reference", label: "Cross-ref", color: "stroke-annotation-crossref" },
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
      className="p-5 rounded-xl border border-ink-100 dark:border-ink-800 bg-white dark:bg-ink-900"
    >
      <p className="text-[10px] font-sans font-semibold text-ink-400 dark:text-ink-500 uppercase tracking-[0.2em] mb-5">
        Engagement depth
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
        {/* Scroll depth */}
        <div>
          <p className="text-[10px] font-sans text-ink-400 mb-2">Scroll depth</p>
          <div className="space-y-1">
            {buckets.map((count, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="text-[9px] font-sans text-ink-300 dark:text-ink-600 w-10">
                  {SCROLL_LABELS[i]}
                </span>
                <div className="flex-1 h-3 rounded-sm bg-ink-100 dark:bg-ink-800 overflow-hidden">
                  <div
                    className="h-full rounded-sm bg-annotation-crossref"
                    style={{
                      width: `${(count / maxBucket) * 100}%`,
                      opacity: 0.4 + (i / 4) * 0.6,
                    }}
                  />
                </div>
                <span className="text-[9px] font-sans text-ink-400 w-3 text-right">
                  {count}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Focus ratio */}
        <div>
          <p className="text-[10px] font-sans text-ink-400 mb-2">Focus</p>
          <div className="flex items-baseline gap-2 mb-2">
            <span className="text-lg font-serif text-ink-950 dark:text-parchment-100">
              {focusRatio > 0 ? `${focusRatio}%` : "—"}
            </span>
            {focusRatio >= 80 && (
              <span className="text-[9px] font-sans text-annotation-context">
                Focused
              </span>
            )}
          </div>
          <MiniBar value={focusRatio} width="100%" height="4px" color={focusColor} />
          <div className="flex justify-between mt-2 text-[9px] font-sans text-ink-300 dark:text-ink-600">
            <span>Active: {formatTime(activeTimeMs)}</span>
            <span>Wall: {formatTime(wallTimeMs)}</span>
          </div>
        </div>

        {/* Annotation engagement */}
        <div>
          <p className="text-[10px] font-sans text-ink-400 mb-2">Annotations</p>
          <div className="grid grid-cols-2 gap-3">
            {ANNOTATION_TYPES.map((t) => {
              const d = annotationsByType[t.key] ?? { viewed: 0, total: 0 };
              const pct = d.total > 0 ? Math.round((d.viewed / d.total) * 100) : 0;
              return (
                <div key={t.key} className="flex items-center gap-1.5">
                  <ProgressRing value={pct} size={24} strokeWidth={2.5} color={t.color} />
                  <div>
                    <p className="text-[9px] font-sans text-ink-500">{t.label}</p>
                    <p className="text-[9px] font-sans text-ink-300 dark:text-ink-600">
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
