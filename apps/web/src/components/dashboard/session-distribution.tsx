"use client";
import { motion } from "framer-motion";

interface SessionDistributionProps {
  data: Array<{
    requestedMinutes: number;
    count: number;
    avgActualMinutes: number;
  }>;
}

export function SessionDistribution({ data }: SessionDistributionProps) {
  if (!data) return null;
  const maxCount = Math.max(1, ...data.map((d) => d.count));

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.15 }}
      className="p-5 rounded-lg border border-[var(--reader-border)] bg-[var(--reader-surface)]"
    >
      <h2 className="text-sm font-medium text-[var(--reader-fg)] mb-4">
        Session lengths
      </h2>
      <div className="space-y-3">
        {[5, 10, 20, 30].map((mins) => {
          const d = data.find((x) => x.requestedMinutes === mins);
          const count = d?.count ?? 0;
          const pct = (count / maxCount) * 100;
          return (
            <div key={mins} className="flex items-center gap-3">
              <span className="text-xs font-sans text-[var(--reader-muted)] w-8 text-right">
                {mins}m
              </span>
              <div className="flex-1 h-4 rounded-full bg-[var(--reader-chip)] overflow-hidden">
                <div
                  className="h-full rounded-full bg-annotation-crossref transition-[width] duration-500 motion-reduce:transition-none"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className="text-xs font-sans font-medium text-[var(--reader-fg-soft)] w-6">
                {count}
              </span>
            </div>
          );
        })}
      </div>
      {data && data.length > 0 && (
        <p className="text-[11px] font-sans text-[var(--reader-muted)] mt-3">
          Avg actual:{" "}
          {data
            .filter((d) => d.avgActualMinutes > 0)
            .map((d) => `${d.requestedMinutes}m → ${d.avgActualMinutes}m`)
            .join(", ") || "—"}
        </p>
      )}
    </motion.div>
  );
}
