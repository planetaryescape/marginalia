"use client";
import type { ReadingCheckpoint } from "@marginalia/backend/reading-activity";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  acknowledgeCheckpoint,
  mergeCheckpoint,
  parseCheckpoints,
} from "./checkpoint-queue";
import { getArticleBody } from "./paragraphs";
import { articleProgress, ReadingClock } from "./reading-clock";

const QUEUE_KEY = "marginalia-reading-checkpoints-v1";
function queueCheckpoint(snapshot: ReadingCheckpoint) {
  try {
    const queue = parseCheckpoints(localStorage.getItem(QUEUE_KEY));
    localStorage.setItem(
      QUEUE_KEY,
      JSON.stringify(mergeCheckpoint(queue, snapshot)),
    );
  } catch {
    /* Private/full storage: the live request still runs. */
  }
}
function acknowledge(snapshot: ReadingCheckpoint) {
  try {
    const queue = parseCheckpoints(localStorage.getItem(QUEUE_KEY));
    localStorage.setItem(
      QUEUE_KEY,
      JSON.stringify(acknowledgeCheckpoint(queue, snapshot)),
    );
  } catch {
    /* Nothing durable to acknowledge. */
  }
}
async function send(snapshot: ReadingCheckpoint) {
  queueCheckpoint(snapshot);
  const result = await fetch("/api/engagement", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(snapshot),
    keepalive: true,
  });
  if (!result.ok) throw new Error("Reading activity hasn't synced yet.");
  acknowledge(snapshot);
}
export function useEngagementTracker({
  articleId,
  sessionId,
  ready,
  containerRef,
  listening,
}: {
  articleId: string;
  sessionId: string | null;
  ready: boolean;
  containerRef: React.RefObject<HTMLElement | null>;
  listening: boolean;
}) {
  const clockRef = useRef<ReadingClock | null>(null);
  const flushRef = useRef<((finish?: boolean) => Promise<void>) | null>(null);
  const retryRef = useRef<(() => Promise<void>) | null>(null);
  const [saveError, setSaveError] = useState(false);
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    if (!ready) return;
    const clock = new ReadingClock(
      Date.now(),
      performance.now(),
      !document.hidden && document.hasFocus(),
    );
    clockRef.current = clock;
    const visitId = crypto.randomUUID();
    let finished = false;
    let mounted = true;
    const samples = (finish = false): ReadingCheckpoint[] =>
      clock.snapshots(Date.now(), performance.now()).map((s, i, all) => ({
        ...s,
        articleId,
        sessionId: sessionId ?? undefined,
        visitId,
        finished: finish && i === all.length - 1,
      }));
    const flush = async (finish = false) => {
      try {
        for (const s of samples(finish)) {
          await send(s);
          clock.acknowledge(s.day);
        }
        if (finish) finished = true;
        if (mounted) setSaveError(false);
      } catch (error) {
        if (mounted) setSaveError(true);
        throw error;
      }
    };
    flushRef.current = flush;
    const active = () => clock.activity(Date.now(), performance.now());
    const measure = () => {
      const body = getArticleBody(containerRef.current);
      if (!body) return;
      const rect = body.getBoundingClientRect();
      const p = articleProgress(rect.top, rect.height, window.innerHeight);
      clock.progress(p);
      setProgress(p);
    };
    const scroll = () => {
      active();
      measure();
    };
    const visibility = () => {
      clock.visibility(
        !document.hidden && document.hasFocus(),
        Date.now(),
        performance.now(),
      );
      if (document.hidden && !finished) void flush().catch(() => {});
    };
    const leave = () => {
      if (!finished)
        for (const s of samples()) {
          queueCheckpoint(s);
          navigator.sendBeacon?.(
            "/api/engagement",
            new Blob([JSON.stringify(s)], { type: "application/json" }),
          );
        }
    };
    const retry = async () => {
      try {
        let queued: ReadingCheckpoint[] = [];
        try {
          queued = parseCheckpoints(localStorage.getItem(QUEUE_KEY));
        } catch {
          /* Storage unavailable: still send this visit. */
        }
        for (const entry of queued) await send(entry);
        await flush();
      } catch {
        if (mounted) setSaveError(true);
      }
    };
    retryRef.current = retry;
    measure();
    void retry();
    window.addEventListener("scroll", scroll, { passive: true });
    window.addEventListener("resize", measure);
    window.addEventListener("pointerdown", active, { passive: true });
    window.addEventListener("keydown", active);
    window.addEventListener("focus", visibility);
    window.addEventListener("blur", visibility);
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", leave);
    window.addEventListener("online", retry);
    const tick = window.setInterval(
      () => clock.tick(Date.now(), performance.now()),
      1000,
    );
    const save = window.setInterval(() => {
      if (!finished) void retry();
    }, 15_000);
    const observer = new ResizeObserver(measure);
    if (containerRef.current) observer.observe(containerRef.current);
    return () => {
      mounted = false;
      if (!finished) void flush().catch(() => {});
      if (clockRef.current === clock) {
        clockRef.current = null;
        flushRef.current = null;
        retryRef.current = null;
      }
      clearInterval(tick);
      clearInterval(save);
      observer.disconnect();
      window.removeEventListener("scroll", scroll);
      window.removeEventListener("resize", measure);
      window.removeEventListener("pointerdown", active);
      window.removeEventListener("keydown", active);
      window.removeEventListener("focus", visibility);
      window.removeEventListener("blur", visibility);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", leave);
      window.removeEventListener("online", retry);
    };
  }, [ready, articleId, sessionId, containerRef]);
  useEffect(() => {
    clockRef.current?.speech(listening, Date.now(), performance.now());
  }, [listening]);
  const trackAnnotationOpen = useCallback((id: string) => {
    clockRef.current?.annotation(id);
  }, []);
  const finish = useCallback(async () => {
    if (!flushRef.current) throw new Error("Reader is still opening");
    await flushRef.current(true);
  }, []);
  const retry = useCallback(async () => {
    await retryRef.current?.();
  }, []);
  return { trackAnnotationOpen, finish, retry, saveError, progress };
}
