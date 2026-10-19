import { describe, expect, it, vi } from "vitest";
import { SessionCache } from "./session-cache";

describe("session memory cache", () => {
  it("invalidates entries and in-flight generations without losing the current scope", () => {
    const cache = new SessionCache<number>(20, 60_000);
    cache.forScope("reader:phase");
    const generation = cache.generation;
    cache.set("old", 1);
    cache.invalidate();
    expect(cache.get("old")).toBeUndefined();
    cache.set("late", 2, generation);
    expect(cache.get("late")).toBeUndefined();
    cache.forScope("reader:phase");
    cache.set("explicit-next-lookup", 3);
    expect(cache.get("explicit-next-lookup")).toBe(3);
  });
  it("bounds entries, expires them and isolates sessions including late writes", () => {
    const cache = new SessionCache<number>(2, 100);
    cache.forScope("a");
    const old = cache.generation;
    cache.set("__proto__", 1);
    cache.set("two", 2);
    cache.set("three", 3);
    expect(cache.get("__proto__")).toBeUndefined();
    cache.forScope("b");
    cache.set("late", 4, old);
    expect(cache.get("late")).toBeUndefined();
    expect(cache.get("three")).toBeUndefined();
    vi.spyOn(Date, "now").mockReturnValue(1000);
    cache.set("fresh", 5);
    vi.spyOn(Date, "now").mockReturnValue(1100);
    expect(cache.get("fresh")).toBeUndefined();
    vi.restoreAllMocks();
    cache.forScope(null);
    cache.set("signed-out", 6);
    expect(cache.get("signed-out")).toBeUndefined();
  });
});
