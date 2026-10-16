import { describe, expect, it } from "vitest";
import { scrollTopForProgress, shouldRestorePlace } from "./place-restore";
import { articleProgress } from "./reading-clock";

describe("scrollTopForProgress", () => {
  it("lands where articleProgress reads the same percent", () => {
    const bodyTop = 200;
    const height = 6000;
    const viewport = 800;
    for (const percent of [10, 37, 62, 100]) {
      const y = scrollTopForProgress(bodyTop, height, viewport, percent);
      expect(y).not.toBeNull();
      const read = articleProgress(bodyTop - (y as number), height, viewport);
      expect(Math.abs(read - percent)).toBeLessThanOrEqual(1);
    }
  });

  it("does not scroll a body that fits on one screen", () => {
    expect(scrollTopForProgress(100, 300, 800, 50)).toBeNull();
  });

  it("clamps the percent", () => {
    expect(scrollTopForProgress(0, 6000, 800, 250)).toBe(
      scrollTopForProgress(0, 6000, 800, 100),
    );
  });
});

describe("shouldRestorePlace", () => {
  const base = { percent: 40, finished: false, hasTarget: false };
  it("restores an unfinished article with progress", () => {
    expect(shouldRestorePlace(base)).toBe(true);
  });
  it("leaves a finished article at the top", () => {
    expect(shouldRestorePlace({ ...base, finished: true })).toBe(false);
  });
  it("leaves a link to a quote or paragraph alone", () => {
    expect(shouldRestorePlace({ ...base, hasTarget: true })).toBe(false);
  });
  it("waits for the percent and ignores a barely started article", () => {
    expect(shouldRestorePlace({ ...base, percent: undefined })).toBe(false);
    expect(shouldRestorePlace({ ...base, percent: 1 })).toBe(false);
  });
});
