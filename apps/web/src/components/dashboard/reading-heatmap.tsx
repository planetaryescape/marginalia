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
      className="p-5 rounded-lg border border-[var(--reader-border)] bg-[var(--reader-surface)]"
    >
      <h2 className="text-sm font-medium text-[var(--reader-fg)] mb-4">
        When you read
      </h2>
      <div className="flex gap-1">
        {/* Time block labels */}
        <div className="flex flex-col gap-1 mr-1 pt-5">
          {BLOCKS.map((b) => (
            <div
              key={b}
              className="h-5 flex items-center text-[11px] font-sans text-[var(--reader-muted)]"
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
              className="h-4 flex items-center justify-center text-[11px] font-sans text-[var(--reader-muted)]"
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
              const opacity =
                count > 0 ? 0.15 + (count / maxCount) * 0.85 : 0.05;

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
