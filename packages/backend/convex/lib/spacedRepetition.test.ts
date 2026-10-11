import { describe, expect, it } from "vitest";
import {
  isDueForReview,
  nextReviewAt,
  snoozeReviewAt,
} from "./spacedRepetition";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = 1700000000000; // Fixed timestamp for deterministic tests

describe("spacedRepetition", () => {
  describe("nextReviewAt", () => {
    it("first review (index 0) schedules ~3 days out", () => {
      // With jitterSeed=0.5 (middle), should be exactly 3 days * 1.0 = 3 days
      const result = nextReviewAt(0, NOW, 0.5);
      const daysOut = (result - NOW) / DAY_MS;
      expect(daysOut).toBe(3); // 3 * (0.85 + 0.5*0.3) = 3 * 1.0 = 3
    });

    it("intervals follow Fibonacci sequence with no jitter (seed=0.5)", () => {
      const expected = [3, 5, 8, 13, 21, 34, 55];
      for (let i = 0; i < expected.length; i++) {
        const result = nextReviewAt(i, NOW, 0.5);
        const daysOut = (result - NOW) / DAY_MS;
        expect(daysOut).toBe(expected[i]);
      }
    });

    it("caps at 55 days for review indices beyond the array", () => {
      const result = nextReviewAt(100, NOW, 0.5);
      const daysOut = (result - NOW) / DAY_MS;
      expect(daysOut).toBe(55);
    });

    it("applies jitter: seed=0 gives 85% of base", () => {
      const result = nextReviewAt(0, NOW, 0);
      const daysOut = (result - NOW) / DAY_MS;
      expect(daysOut).toBeCloseTo(3 * 0.85, 1); // 2.55
    });

    it("applies jitter: seed=1 gives 115% of base", () => {
      const result = nextReviewAt(0, NOW, 1);
      const daysOut = (result - NOW) / DAY_MS;
      expect(daysOut).toBeCloseTo(3 * 1.15, 1); // 3.45
    });

    it("handles negative review index by clamping to 0", () => {
      const result = nextReviewAt(-5, NOW, 0.5);
      const daysOut = (result - NOW) / DAY_MS;
      expect(daysOut).toBe(3);
    });
  });

  describe("snoozeReviewAt", () => {
    it("snoozes exactly 3 days", () => {
      const result = snoozeReviewAt(NOW);
      expect(result - NOW).toBe(3 * DAY_MS);
    });
  });

  describe("isDueForReview", () => {
    it("returns true when nextReviewAt is in the past", () => {
      expect(isDueForReview(NOW - 1000, NOW)).toBe(true);
    });

    it("returns true when nextReviewAt is exactly now", () => {
      expect(isDueForReview(NOW, NOW)).toBe(true);
    });

    it("returns false when nextReviewAt is in the future", () => {
      expect(isDueForReview(NOW + 1000, NOW)).toBe(false);
    });
  });
});
