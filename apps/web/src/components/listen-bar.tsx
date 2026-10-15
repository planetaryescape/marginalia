"use client";
import { AnimatePresence, motion } from "framer-motion";
import { Pause, Play, SkipBack, SkipForward, Square } from "lucide-react";

export function ListenBar({
  index,
  total,
  paused,
  onTogglePause,
  onSkip,
  onStop,
}: {
  index: number | null;
  total: number;
  paused: boolean;
  onTogglePause: () => void;
  onSkip: (index: number) => void;
  onStop: () => void;
}) {
  const button =
    "w-8 h-8 flex items-center justify-center rounded-full opacity-75 hover:opacity-100 hover:bg-white/10 transition";
  return (
    <AnimatePresence>
      {index !== null && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 12 }}
          style={{ x: "-50%" }}
          className="fixed bottom-6 left-1/2 z-40 flex items-center gap-1 pl-4 pr-1.5 py-1.5 rounded-full font-sans reader-float shadow-[0_10px_30px_-8px_rgba(0,0,0,0.5)]"
          role="region"
          aria-label="Listening"
        >
          <span className="flex items-center gap-2 mr-2 text-[12.5px]">
            <span
              className="listen-pulse w-1.5 h-1.5 rounded-full bg-[var(--pen)]"
              data-paused={paused || undefined}
            />
            Listening
            <span className="font-mono text-[11px] opacity-60 tabular-nums">
              ¶{index + 1}/{total}
            </span>
          </span>
          <button
            className={button}
            onClick={() => onSkip(index - 1)}
            aria-label="Previous paragraph"
            disabled={index === 0}
          >
            <SkipBack size={14} />
          </button>
          <button
            className={button}
            onClick={onTogglePause}
            aria-label={paused ? "Resume" : "Pause"}
          >
            {paused ? <Play size={14} /> : <Pause size={14} />}
          </button>
          <button
            className={button}
            onClick={() => onSkip(index + 1)}
            aria-label="Next paragraph"
          >
            <SkipForward size={14} />
          </button>
          <button
            className={button}
            onClick={onStop}
            aria-label="Stop listening"
          >
            <Square size={12} />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
