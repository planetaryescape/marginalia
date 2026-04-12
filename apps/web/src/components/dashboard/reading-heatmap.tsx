"use client";
import { motion } from "framer-motion";

interface HeatmapProps {
  data: Array<{ dayOfWeek: number; timeBlock: number; count: number }>;
}

const DAYS = ["S", "M", "T", "W", "T", "F", "S"];
const BLOCKS = ["Morn", "Aft", "Eve", "Night"];

export function ReadingHeatmap({ data }: HeatmapProps) {
  if (!data) return null;
  const maxCount = Math.max(1, ...data.map((d) => d.count));

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.1 }}
      className="p-5 rounded-xl border border-ink-100 dark:border-ink-800 bg-white dark:bg-ink-900"
    >
      <p className="text-[10px] font-sans font-semibold text-ink-400 dark:text-ink-500 uppercase tracking-[0.2em] mb-4">
        When you read
      </p>
      <div className="flex gap-1">
        {/* Time block labels */}
        <div className="flex flex-col gap-1 mr-1 pt-5">
          {BLOCKS.map((b) => (
            <div
              key={b}
              className="h-5 flex items-center text-[9px] font-sans text-ink-300 dark:text-ink-600"
            >
              {b}
            </div>
          ))}
        </div>
        {/* Grid */}
        <div className="grid grid-cols-7 gap-1 flex-1">
          {/* Day labels */}
          {DAYS.map((d, i) => (
            <div
              key={`day-${i}`}
              className="h-4 flex items-center justify-center text-[9px] font-sans text-ink-300 dark:text-ink-600"
            >
              {d}
            </div>
          ))}
          {/* Cells: iterate blocks (rows) then days (cols) */}
          {[0, 1, 2, 3].map((block) =>
            [0, 1, 2, 3, 4, 5, 6].map((day) => {
              const cell = data.find(
                (d) => d.dayOfWeek === day && d.timeBlock === block,
              );
              const count = cell?.count ?? 0;
              const opacity = count > 0 ? 0.15 + (count / maxCount) * 0.85 : 0.05;

              return (
                <div
                  key={`${day}-${block}`}
                  className="h-5 rounded-sm bg-annotation-crossref"
                  style={{ opacity }}
                  title={`${DAYS[day]} ${BLOCKS[block]}: ${count} article${count !== 1 ? "s" : ""}`}
                />
              );
            }),
          )}
        </div>
      </div>
    </motion.div>
  );
}
