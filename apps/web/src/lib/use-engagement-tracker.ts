"use client";
import { useCallback, useEffect, useRef } from "react";

const IDLE_TIMEOUT_MS = 30_000; // 30s of no activity = idle
const TICK_INTERVAL_MS = 1_000; // Check every second

export interface EngagementSnapshot {
  activeTimeMs: number;
  maxScrollPercent: number;
  annotationsOpened: string[]; // annotation IDs
  totalScrollEvents: number;
  tabHiddenCount: number;
}

/**
 * Tracks real engagement with the article:
 * - Active time: only counts when user is interacting (scroll, mouse, keyboard)
 *   and tab is visible. Pauses after 30s of inactivity.
 * - Scroll depth: max scroll percentage reached.
 * - Annotation opens: which annotations were opened (by ID).
 */
export function useEngagementTracker() {
  const state = useRef({
    activeTimeMs: 0,
    maxScrollPercent: 0,
    annotationsOpened: new Set<string>(),
    totalScrollEvents: 0,
    tabHiddenCount: 0,
    lastActivityAt: Date.now(),
    isActive: true,
    isVisible: true,
    startedAt: Date.now(),
  });

  // Track user activity (scroll, mouse move, key press)
  useEffect(() => {
    const markActive = () => {
      state.current.lastActivityAt = Date.now();
      state.current.isActive = true;
    };

    const handleScroll = () => {
      markActive();
      state.current.totalScrollEvents++;

      // Calculate scroll percentage
      const scrollTop = window.scrollY;
      const docHeight = document.documentElement.scrollHeight - window.innerHeight;
      if (docHeight > 0) {
        const pct = Math.min(100, Math.round((scrollTop / docHeight) * 100));
        if (pct > state.current.maxScrollPercent) {
          state.current.maxScrollPercent = pct;
        }
      }
    };

    const handleVisibility = () => {
      if (document.hidden) {
        state.current.isVisible = false;
        state.current.tabHiddenCount++;
      } else {
        state.current.isVisible = true;
        markActive();
      }
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("mousemove", markActive, { passive: true });
    window.addEventListener("keydown", markActive, { passive: true });
    window.addEventListener("touchstart", markActive, { passive: true });
    document.addEventListener("visibilitychange", handleVisibility);

    // Tick: accumulate active time only when user is active + tab visible
    const interval = setInterval(() => {
      const now = Date.now();
      const idleMs = now - state.current.lastActivityAt;

      if (idleMs > IDLE_TIMEOUT_MS) {
        state.current.isActive = false;
      }

      if (state.current.isActive && state.current.isVisible) {
        state.current.activeTimeMs += TICK_INTERVAL_MS;
      }
    }, TICK_INTERVAL_MS);

    return () => {
      window.removeEventListener("scroll", handleScroll);
      window.removeEventListener("mousemove", markActive);
      window.removeEventListener("keydown", markActive);
      window.removeEventListener("touchstart", markActive);
      document.removeEventListener("visibilitychange", handleVisibility);
      clearInterval(interval);
    };
  }, []);

  const trackAnnotationOpen = useCallback((annotationId: string) => {
    state.current.annotationsOpened.add(annotationId);
  }, []);

  const getSnapshot = useCallback((): EngagementSnapshot => {
    return {
      activeTimeMs: state.current.activeTimeMs,
      maxScrollPercent: state.current.maxScrollPercent,
      annotationsOpened: [...state.current.annotationsOpened],
      totalScrollEvents: state.current.totalScrollEvents,
      tabHiddenCount: state.current.tabHiddenCount,
    };
  }, []);

  return { trackAnnotationOpen, getSnapshot };
}
