import { expect, it, vi } from "vitest";
import { internal } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";
import {
  ANSWER_DEADLINES,
  cancellablePreparation,
  interruptible,
} from "./requestControl";

it("blocks the next preparation stage after cancellation during a database read", async () => {
  let finish!: (result: null) => void;
  const runQuery = vi.fn(
    () =>
      new Promise<null>((resolve) => {
        finish = resolve;
      }),
  );
  const runMutation = vi.fn();
  // SAFETY: this partial fixture exercises only runQuery/runMutation, which it implements.
  const ctx = { runQuery, runMutation } as unknown as ActionCtx;
  const controller = new AbortController();
  const guarded = cancellablePreparation(ctx, controller.signal);
  const pending = guarded.runQuery(internal.summaries.forCompanion, {
    articleId: "fixture",
    userId: "reader",
  });
  controller.abort();
  finish(null);
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  await expect(
    guarded.runMutation(internal.limits.spend, {
      userId: "reader",
      bucket: "ai",
    }),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(runMutation).not.toHaveBeenCalled();
});

it("handles an already-rejected adapter when the signal aborts during dispatch", async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(
    interruptible(
      Promise.reject(new Error("provider rejected")),
      controller.signal,
    ),
  ).rejects.toMatchObject({ name: "AbortError" });
});

it("gives deliberate deep and web work longer first-token and total deadlines", () => {
  expect(ANSWER_DEADLINES.deep.firstTokenMs).toBeGreaterThan(
    ANSWER_DEADLINES.quick.firstTokenMs,
  );
  expect(ANSWER_DEADLINES.web.firstTokenMs).toBeGreaterThan(
    ANSWER_DEADLINES.quick.firstTokenMs,
  );
  expect(ANSWER_DEADLINES.deep.totalMs).toBeGreaterThan(
    ANSWER_DEADLINES.web.totalMs,
  );
});
