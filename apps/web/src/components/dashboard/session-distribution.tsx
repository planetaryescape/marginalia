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
  const maxCount = Math.max(1, ...data.map((d) => d.count));

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.15 }}
      className="p-5 rounded-xl border border-ink-100 dark:border-ink-800 bg-white dark:bg-ink-900"
    >
      <p className="text-[10px] font-sans font-semibold text-ink-400 dark:text-ink-500 uppercase tracking-[0.2em] mb-4">
        Session lengths
      </p>
      <div className="space-y-3">
        {[5, 10, 20, 30].map((mins) => {
          const d = data.find((x) => x.requestedMinutes === mins);
          const count = d?.count ?? 0;
          const pct = (count / maxCount) * 100;
          return (
            <div key={mins} className="flex items-center gap-3">
              <span className="text-xs font-sans text-ink-400 w-8 text-right">
                {mins}m
              </span>
              <div className="flex-1 h-4 rounded-full bg-ink-100 dark:bg-ink-800 overflow-hidden">
                <div
                  className="h-full rounded-full bg-annotation-crossref transition-all duration-500"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className="text-xs font-sans font-medium text-ink-600 dark:text-ink-400 w-6">
                {count}
              </span>
            </div>
          );
        })}
      </div>
      {data.length > 0 && (
        <p className="text-[10px] font-sans text-ink-300 dark:text-ink-600 mt-3">
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
