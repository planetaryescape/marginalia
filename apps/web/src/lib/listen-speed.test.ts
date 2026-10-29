// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import {
  clampSpeed,
  formatSpeed,
  nextSpeed,
  readSpeed,
  SPEED_PRESETS,
  writeSpeed,
} from "./listen-speed";

afterEach(() => vi.unstubAllGlobals());

it("keeps speeds within 0.8 to 2 on the 0.05 grid", () => {
  expect(clampSpeed(0.5)).toBe(0.8);
  expect(clampSpeed(3)).toBe(2);
  expect(clampSpeed(1.23)).toBe(1.25);
  expect(clampSpeed(1.2)).toBe(1.2);
  expect(clampSpeed(Number.NaN)).toBe(1);
  expect(clampSpeed(Number.POSITIVE_INFINITY)).toBe(1);
});

it("steps 1, 1.2, 1.5, 1.75, 2, 0.8 and round to 1", () => {
  const seen = [1];
  for (let i = 0; i < SPEED_PRESETS.length; i++)
    seen.push(nextSpeed(seen[seen.length - 1]));
  expect(seen).toEqual([1, 1.2, 1.5, 1.75, 2, 0.8, 1]);
});

it("takes a speed between presets to the next one up, and wraps from the top", () => {
  expect(nextSpeed(1.3)).toBe(1.5);
  expect(nextSpeed(0.9)).toBe(1);
  expect(nextSpeed(1.9)).toBe(2);
});

it("writes speeds without trailing zeros", () => {
  expect(formatSpeed(1)).toBe("1×");
  expect(formatSpeed(1.2)).toBe("1.2×");
  expect(formatSpeed(1.75)).toBe("1.75×");
});

it("stores the speed, reads back 1× from junk, and survives blocked storage", () => {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  });
  expect(readSpeed()).toBe(1);
  writeSpeed(1.5);
  expect(readSpeed()).toBe(1.5);
  store.set("marginalia.listenSpeed", "fast");
  expect(readSpeed()).toBe(1);
  store.set("marginalia.listenSpeed", "9");
  expect(readSpeed()).toBe(2);

  vi.stubGlobal("localStorage", {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
  });
  expect(readSpeed()).toBe(1);
  expect(() => writeSpeed(1.5)).not.toThrow();
});
