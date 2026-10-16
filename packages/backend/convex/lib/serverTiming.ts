/** Collects named stage durations for a `Server-Timing` response header. */
export interface Timings {
  /** Records the time since the previous mark (or the start) under `name`. */
  mark(name: string): void;
  header(): string;
}

export function startTimings(now: () => number = Date.now): Timings {
  const start = now();
  let last = start;
  const stages: [string, number][] = [];
  return {
    mark(name) {
      const at = now();
      stages.push([name, at - last]);
      last = at;
    },
    header() {
      return [...stages, ["total", now() - start] as [string, number]]
        .map(([name, ms]) => `${name};dur=${ms}`)
        .join(", ");
    },
  };
}
