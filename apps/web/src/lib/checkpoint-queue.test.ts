import { expect, it } from "vitest";
import {
  acknowledgeCheckpoint,
  mergeCheckpoint,
  parseCheckpoints,
} from "./checkpoint-queue";

const snapshot = {
  articleId: "fixture",
  visitId: "170d1ba0-28c2-44b1-9d97-c9f9bc9e944e",
  day: "2026-10-12",
  startedAt: 1000,
  updatedAt: 11000,
  activeTimeMs: 6000,
  visibleTimeMs: 8000,
  timeSpentMs: 10000,
  maxScrollPercent: 40,
  annotationsOpened: ["one"],
};
it("never downgrades queued progress or completion when an older request retries", () => {
  const latest = {
    ...snapshot,
    updatedAt: 16000,
    activeTimeMs: 10000,
    visibleTimeMs: 13000,
    timeSpentMs: 15000,
    maxScrollPercent: 80,
    annotationsOpened: ["one", "two"],
    finished: true,
  };
  const queue = mergeCheckpoint([latest], snapshot);
  expect(queue).toEqual([latest]);
  expect(acknowledgeCheckpoint(queue, snapshot)).toEqual([latest]);
  expect(acknowledgeCheckpoint(queue, latest)).toEqual([]);
});
it("retains same-timestamp annotation and finish updates until they too are acknowledged", () => {
  const updated = {
    ...snapshot,
    annotationsOpened: ["one", "two"],
    finished: true,
  };
  expect(acknowledgeCheckpoint([updated], snapshot)).toEqual([updated]);
});
it("keeps separate visits and days separate, discarding invalid stored payloads", () => {
  const nextDay = { ...snapshot, day: "2026-10-13" };
  expect(mergeCheckpoint([snapshot], nextDay)).toHaveLength(2);
  expect(
    parseCheckpoints(
      JSON.stringify([snapshot, { ...snapshot, activeTimeMs: -1 }]),
    ),
  ).toEqual([snapshot]);
});
