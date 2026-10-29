"use client";
import {
  ArrowDownToLine,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Square,
  X,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { formatSpeed } from "@/lib/listen-speed";
import type { ListenStatus } from "@/lib/use-natural-voice";

/** How long the pill waits on one paragraph before it says so. */
export const SLOW_WAIT_MS = 4000;

interface View {
  kind: "listening" | "failed" | "nokey";
  status: ListenStatus;
  index: number | null;
  total: number;
  error: string | null;
  deviceSupported: boolean;
  following: boolean;
  speed: number;
}

function dotMode(view: View) {
  if (view.kind === "failed") return "failed";
  if (view.kind === "nokey") return "none";
  if (view.status === "paused") return "paused";
  return view.status === "preparing" ? "preparing" : "playing";
}

export function ListenBar({
  status,
  index,
  total,
  error,
  needsKey,
  deviceSupported,
  following,
  speed,
  onTogglePause,
  onPrevious,
  onNext,
  onStop,
  onRetry,
  onUseDeviceVoice,
  onFollow,
  onSpeed,
}: {
  status: ListenStatus;
  index: number | null;
  total: number;
  error: string | null;
  needsKey: boolean;
  deviceSupported: boolean;
  /** Whether the page is following the voice; Follow shows only when it isn't. */
  following: boolean;
  speed: number;
  onTogglePause: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onStop: () => void;
  onRetry: () => void;
  onUseDeviceVoice: () => void;
  onFollow: () => void;
  /** Steps to the next speed preset. */
  onSpeed: () => void;
}) {
  const open = needsKey || index !== null;
  // The pill sinks away still showing what it last said, not an empty shell
  const lastView = useRef<View | null>(null);
  if (open) {
    lastView.current = {
      kind: needsKey ? "nokey" : status === "failed" ? "failed" : "listening",
      status,
      index,
      total,
      error,
      deviceSupported,
      following,
      speed,
    };
  }
  const view = lastView.current;

  const [slow, setSlow] = useState(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new paragraph restarts the wait
  useEffect(() => {
    setSlow(false);
    if (status !== "preparing") return;
    const timer = setTimeout(() => setSlow(true), SLOW_WAIT_MS);
    return () => clearTimeout(timer);
  }, [status, index]);

  if (!view) return null;
  const waiting = open && slow && status === "preparing";
  const paused = view.status === "paused";
  const number = (view.index ?? 0) + 1;

  return (
    <div className="listen-wrap" data-open={open || undefined}>
      <div className="listen-anchor">
        <div
          className="listen-pill reader-float"
          data-kind={view.kind}
          role="region"
          aria-label={
            view.kind === "failed"
              ? "Listening stopped"
              : view.kind === "nokey"
                ? "Listening needs a voice"
                : "Listening"
          }
        >
          {view.kind === "listening" && !view.following && (
            <>
              <button
                type="button"
                className="listen-follow"
                onClick={onFollow}
                title="Scroll to the voice and follow it again"
              >
                <ArrowDownToLine size={14} aria-hidden="true" />
                <span className="listen-follow-text">Follow</span>
              </button>
              <i className="listen-sep" aria-hidden="true" />
            </>
          )}
          <span
            className="listen-dot"
            data-mode={dotMode(view)}
            aria-hidden="true"
          />
          <div className="listen-body" key={view.kind}>
            {view.kind === "listening" && (
              <>
                <span className="listen-label">
                  {paused ? "Paused" : "Listening"}
                </span>
                <span
                  role="img"
                  className="listen-count"
                  aria-label={`Paragraph ${number} of ${view.total}`}
                >
                  ¶{number}/{view.total}
                </span>
                <span className="listen-controls">
                  <button
                    type="button"
                    className="listen-btn"
                    onClick={onPrevious}
                    aria-label="Previous paragraph"
                  >
                    <SkipBack size={14} />
                  </button>
                  <button
                    type="button"
                    className="listen-btn"
                    data-primary=""
                    onClick={onTogglePause}
                    aria-label={paused ? "Resume" : "Pause"}
                  >
                    {paused ? <Play size={14} /> : <Pause size={14} />}
                  </button>
                  <button
                    type="button"
                    className="listen-btn"
                    onClick={onNext}
                    aria-label="Next paragraph"
                  >
                    <SkipForward size={14} />
                  </button>
                  <button
                    type="button"
                    className="listen-speed"
                    onClick={onSpeed}
                    aria-label={`Speed ${formatSpeed(view.speed)}. Change speed`}
                  >
                    {formatSpeed(view.speed)}
                  </button>
                  <i className="listen-sep" />
                  <button
                    type="button"
                    className="listen-btn"
                    data-quiet=""
                    onClick={onStop}
                    aria-label="Stop listening"
                  >
                    <Square size={14} />
                  </button>
                </span>
              </>
            )}
            {view.kind === "failed" && (
              <>
                <span className="listen-msg" role="alert">
                  {view.error ?? "The voice stopped."}
                </span>
                <button
                  type="button"
                  className="listen-link"
                  data-strong=""
                  onClick={onRetry}
                >
                  Retry
                </button>
                <button
                  type="button"
                  className="listen-btn"
                  data-quiet=""
                  onClick={onStop}
                  aria-label="Stop listening"
                >
                  <Square size={14} />
                </button>
              </>
            )}
            {view.kind === "nokey" && (
              <span className="listen-nokey">
                <Link
                  href="/account"
                  target="_blank"
                  rel="noopener"
                  title="Opens Your account"
                  className="listen-link"
                  data-strong=""
                >
                  Natural voice: add an OpenRouter key
                </Link>
                {view.deviceSupported && (
                  <>
                    <span className="listen-nokey-mid" aria-hidden="true">
                      ·
                    </span>
                    <button
                      type="button"
                      className="listen-link"
                      onClick={onUseDeviceVoice}
                    >
                      Use device voice
                    </button>
                  </>
                )}
                <button
                  type="button"
                  className="listen-btn"
                  data-quiet=""
                  onClick={onStop}
                  aria-label="Dismiss"
                >
                  <X size={14} />
                </button>
              </span>
            )}
          </div>
        </div>
        <div
          className="listen-pencil"
          role="status"
          aria-live="polite"
          data-show={waiting || undefined}
        >
          <svg viewBox="0 0 72 14" aria-hidden="true">
            <path d="M0.65 8 C 9.8 1, 16.4 13, 26.2 6 S 42.5 1, 52.3 8 S 65.4 11, 71.3 5" />
          </svg>
          <span>{waiting ? "Still preparing this paragraph." : ""}</span>
        </div>
      </div>
    </div>
  );
}
