import { capDwell } from "@marginalia/backend/reading-activity";

export const READING_IDLE_MS = 90_000;
export interface ReadingSample {
  day: string;
  startedAt: number;
  updatedAt: number;
  activeTimeMs: number;
  visibleTimeMs: number;
  timeSpentMs: number;
  maxScrollPercent: number;
  annotationsOpened: string[];
  /** Active milliseconds per displayed paragraph number */
  dwell: Record<string, number>;
}
export function articleProgress(
  top: number,
  height: number,
  viewport: number,
  header = 64,
) {
  if (!Number.isFinite(height) || height <= 0) return 0;
  const available = Math.max(1, viewport - header - 24);
  if (height <= available) return top + height <= viewport - 24 ? 100 : 0;
  return Math.round(
    Math.min(100, Math.max(0, ((header - top) / (height - available)) * 100)),
  );
}
function localDay(at: number) {
  const d = new Date(at);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export class ReadingClock {
  private samples = new Map<string, ReadingSample>();
  private lastAt: number;
  private lastTick: number;
  private lastActivity: number;
  private visible: boolean;
  private listening = false;
  private inView: readonly number[] = [];
  constructor(at: number, tick: number, visible: boolean) {
    this.lastAt = at;
    this.lastTick = tick;
    this.lastActivity = tick;
    this.visible = visible;
    this.sample(at);
  }
  private sample(at: number) {
    const day = localDay(at);
    let s = this.samples.get(day);
    if (!s) {
      s = {
        day,
        startedAt: at,
        updatedAt: at,
        activeTimeMs: 0,
        visibleTimeMs: 0,
        timeSpentMs: 0,
        maxScrollPercent: 0,
        annotationsOpened: [],
        dwell: {},
      };
      this.samples.set(day, s);
    }
    return s;
  }
  tick(at: number, tick: number) {
    const elapsed = Math.max(
      0,
      Math.min(tick - this.lastTick, at - this.lastAt),
    );
    // A suspended timer is not evidence of foreground reading.
    const visible = this.visible && elapsed <= 5000 ? elapsed : 0;
    const active = this.listening
      ? visible
      : Math.min(
          visible,
          Math.max(0, this.lastActivity + READING_IDLE_MS - this.lastTick),
        );
    let from = this.lastAt;
    const totalWall = Math.max(0, at - from);
    while (from < at) {
      const midnight = new Date(from);
      midnight.setHours(24, 0, 0, 0);
      const end = Math.min(at, midnight.getTime());
      const s = this.sample(from);
      const share = totalWall ? (end - from) / totalWall : 0;
      s.timeSpentMs += end - from;
      s.visibleTimeMs += visible * share;
      s.activeTimeMs += active * share;
      // Dwell takes the active share, so it stops when the tab is hidden, the
      // window loses focus or the reader goes idle, exactly as active time does
      for (const paragraph of this.inView)
        s.dwell[paragraph] = (s.dwell[paragraph] ?? 0) + active * share;
      s.updatedAt = end;
      from = end;
    }
    this.lastAt = Math.max(this.lastAt, at);
    this.lastTick = tick;
  }
  activity(at: number, tick: number) {
    this.tick(at, tick);
    this.lastActivity = tick;
  }
  visibility(visible: boolean, at: number, tick: number) {
    this.tick(at, tick);
    this.visible = visible;
    if (visible) this.lastActivity = tick;
  }
  speech(listening: boolean, at: number, tick: number) {
    this.tick(at, tick);
    this.listening = listening;
  }
  /** Sets which paragraphs are on screen; time up to now goes to the previous set. */
  paragraphs(inView: readonly number[], at: number, tick: number) {
    this.tick(at, tick);
    this.inView = [...inView];
  }
  progress(percent: number) {
    const s = this.sample(this.lastAt);
    s.maxScrollPercent = Math.max(
      s.maxScrollPercent,
      Math.min(100, Math.max(0, percent)),
    );
  }
  annotation(id: string) {
    const s = this.sample(this.lastAt);
    if (!s.annotationsOpened.includes(id) && s.annotationsOpened.length < 128)
      s.annotationsOpened.push(id);
  }
  snapshots(at: number, tick: number) {
    this.tick(at, tick);
    return [...this.samples.values()].map((s) => ({
      ...s,
      annotationsOpened: [...s.annotationsOpened],
      dwell: capDwell(s.dwell),
    }));
  }
  acknowledge(day: string) {
    if (day !== localDay(this.lastAt)) this.samples.delete(day);
  }
}
