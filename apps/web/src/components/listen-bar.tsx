"use client";
import { AnimatePresence, motion } from "framer-motion";
import { Pause, Play, SkipBack, SkipForward, Square, X } from "lucide-react";
import Link from "next/link";
import type { ListenStatus } from "@/lib/use-natural-voice";

export function ListenBar({
  status,
  index,
  total,
  error,
  needsKey,
  deviceSupported,
  onTogglePause,
  onPrevious,
  onNext,
  onStop,
  onRetry,
  onUseDeviceVoice,
}: {
  status: ListenStatus;
  index: number | null;
  total: number;
  error: string | null;
  needsKey: boolean;
  deviceSupported: boolean;
  onTogglePause: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onStop: () => void;
  onRetry: () => void;
  onUseDeviceVoice: () => void;
}) {
  const button =
    "w-8 h-8 flex items-center justify-center rounded-full opacity-75 hover:opacity-100 hover:bg-white/10 transition";
  const textButton =
    "px-2 h-8 rounded-full text-[12.5px] opacity-75 hover:opacity-100 hover:bg-white/10 transition";
  const paused = status === "paused";
  const failed = status === "failed";
  const visible = needsKey || index !== null;
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 12 }}
          style={{ x: "-50%" }}
          className="fixed bottom-6 left-1/2 z-40 flex items-center gap-1 pl-4 pr-1.5 py-1.5 rounded-full font-sans reader-float shadow-[0_10px_30px_-8px_rgba(0,0,0,0.5)]"
          role="region"
          aria-label="Listening"
        >
          {needsKey ? (
            <>
              <Link
                href="/account"
                target="_blank"
                rel="noopener"
                className={`${textButton} flex items-center mr-1`}
              >
                Natural voice: add an OpenRouter key
              </Link>
              {deviceSupported && (
                <button className={textButton} onClick={onUseDeviceVoice}>
                  Use device voice
                </button>
              )}
              <button className={button} onClick={onStop} aria-label="Dismiss">
                <X size={14} />
              </button>
            </>
          ) : (
            <>
              <span
                className="flex items-center gap-2 mr-2 text-[12.5px]"
                role={failed ? "alert" : undefined}
              >
                <span
                  className="listen-pulse w-1.5 h-1.5 rounded-full"
                  style={{
                    background: failed ? "var(--danger)" : "var(--ink)",
                  }}
                  data-paused={paused || failed || undefined}
                />
                {failed ? (
                  (error ?? "The voice stopped.")
                ) : (
                  <>
                    Listening
                    <span className="font-mono text-[11px] opacity-60 tabular-nums">
                      ¶{(index ?? 0) + 1}/{total}
                    </span>
                  </>
                )}
              </span>
              {failed ? (
                <button className={textButton} onClick={onRetry}>
                  Retry
                </button>
              ) : (
                <>
                  <button
                    className={button}
                    onClick={onPrevious}
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
                    onClick={onNext}
                    aria-label="Next paragraph"
                  >
                    <SkipForward size={14} />
                  </button>
                </>
              )}
              <button
                className={button}
                onClick={onStop}
                aria-label="Stop listening"
              >
                <Square size={12} />
              </button>
            </>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
