/// <reference types="vite/client" />
import { afterEach, describe, expect, it, vi } from "vitest";
import { ownerTest } from "../test/owner";
import { api, internal } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
afterEach(() => vi.useRealTimers());

describe("resumable Reader sync", () => {
  it("backfills legacy installations regardless of their old incremental watermark", async () => {
    const t = await ownerTest(modules);
    await t.run((ctx) =>
      ctx.db.insert("userSettings", {
        userId: "default_user",
        readwiseSyncedAt: 12345,
        updatedAt: 12345,
      }),
    );
    const state = await t.mutation(internal.readwiseSyncState.claim, {
      token: "first",
    });
    expect(state).toMatchObject({
      active: true,
      phase: 0,
      pageProcessedIds: [],
    });
    expect(state?.updatedAfter).toBeUndefined();
  });

  it("rejects concurrent workers and fences a stale worker after lease recovery", async () => {
    vi.useFakeTimers();
    const t = await ownerTest(modules);
    await t.mutation(internal.readwiseSyncState.claim, { token: "first" });
    expect(
      await t.mutation(internal.readwiseSyncState.claim, { token: "second" }),
    ).toBeNull();
    vi.setSystemTime(Date.now() + 16 * 60_000);
    expect(
      await t.mutation(internal.readwiseSyncState.claim, { token: "recovery" }),
    ).not.toBeNull();
    await t.mutation(internal.readwiseSyncState.completePage, {
      token: "first",
      nextPageCursor: "wrong",
    });
    expect((await t.query(api.readwise.status, {})).progress?.phase).toBe(
      "Inbox",
    );
    await t.mutation(internal.readwiseSyncState.completePage, {
      token: "recovery",
      nextPageCursor: null,
    });
    expect((await t.query(api.readwise.status, {})).progress?.phase).toBe(
      "Later",
    );
  });

  it("retains cursor and document progress on failure, never advancing the watermark early", async () => {
    vi.useFakeTimers();
    const t = await ownerTest(modules);
    await t.mutation(internal.readwiseSyncState.claim, { token: "one" });
    await t.mutation(internal.readwiseSyncState.recordDocument, {
      token: "one",
      documentId: "a",
      outcome: "imported",
    });
    await t.mutation(internal.readwiseSyncState.recordDocument, {
      token: "one",
      documentId: "a",
      outcome: "imported",
    });
    await t.mutation(internal.readwiseSyncState.completePage, {
      token: "one",
      nextPageCursor: "page-2",
    });
    expect(
      await t.mutation(internal.readwiseSyncState.claim, { token: "too-soon" }),
    ).toBeNull();
    vi.setSystemTime(Date.now() + 61_000);
    await t.mutation(internal.readwiseSyncState.claim, { token: "two" });
    await t.mutation(internal.readwiseSyncState.recordDocument, {
      token: "two",
      documentId: "b",
      outcome: "imported",
    });
    await t.mutation(internal.readwiseSyncState.fail, {
      token: "two",
      error: "temporary outage",
      retryAfterMs: 300_000,
    });
    expect((await t.query(api.readwise.status, {})).syncedAt).toBeNull();
    vi.setSystemTime(Date.now() + 61_000);
    expect(
      await t.mutation(internal.readwiseSyncState.claim, {
        token: "rate-limited",
      }),
    ).toBeNull();
    vi.setSystemTime(Date.now() + 300_000);
    const resumed = await t.mutation(internal.readwiseSyncState.claim, {
      token: "three",
    });
    expect(resumed).toMatchObject({
      pageCursor: "page-2",
      pageProcessedIds: ["b"],
      imported: 2,
      scanned: 2,
    });
  });

  it("only completes after all document locations and highlights, then uses an overlapping incremental watermark", async () => {
    vi.useFakeTimers();
    const t = await ownerTest(modules);
    const startedAt = Date.now();
    for (let phase = 0; phase < 4; phase++) {
      const token = `phase-${phase}`;
      await t.mutation(internal.readwiseSyncState.claim, { token });
      await t.mutation(internal.readwiseSyncState.completePage, {
        token,
        nextPageCursor: null,
      });
      vi.setSystemTime(Date.now() + 61_000);
    }
    expect(await t.query(api.readwise.status, {})).toMatchObject({
      syncedAt: startedAt,
      progress: { active: false, backfilling: false, phase: "Complete" },
    });
    const next = await t.mutation(internal.readwiseSyncState.claim, {
      token: "incremental",
    });
    expect(next?.updatedAfter).toBe(
      new Date(startedAt - 120_000).toISOString(),
    );
  });
});
