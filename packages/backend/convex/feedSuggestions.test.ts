/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { secondReaderTest } from "../test/owner";
import { api } from "./_generated/api";
import type { MutationCtx } from "./_generated/server";
import { KEEP_MS } from "./feedSuggestions";

const modules = import.meta.glob("./**/*.ts");
const OWNER = "default_user";
const DAY = 24 * 60 * 60_000;

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

async function counted(
  ctx: MutationCtx,
  userId: string,
  title: string,
  offered: number,
  opened: number,
  isActive = true,
) {
  const feedId = await ctx.db.insert("feeds", {
    userId,
    url: `https://${userId}-${title}.example/feed`,
    title,
    isActive,
    createdAt: Date.now(),
  });
  await ctx.db.insert("feedStats", {
    userId,
    feedId,
    offered,
    opened,
    finished: 0,
    skipped: 0,
    updatedAt: Date.now(),
  });
  return feedId;
}

describe("feed suggestions", () => {
  it("suggests feeds offered at least 15 times and opened under 10% of them", async () => {
    const { t, owner } = await secondReaderTest(modules);
    const ids = await t.run(async (ctx) => ({
      skipped: await counted(ctx, OWNER, "skipped", 40, 1),
      fewOffers: await counted(ctx, OWNER, "few offers", 14, 0),
      tenPercent: await counted(ctx, OWNER, "exactly ten percent", 20, 2),
      read: await counted(ctx, OWNER, "read", 40, 30),
      paused: await counted(ctx, OWNER, "paused", 40, 0, false),
      worse: await counted(ctx, OWNER, "never opened", 60, 0),
    }));
    const list = await owner.query(api.feedSuggestions.list, {});
    expect(list.map((s) => s.feedId)).toEqual([ids.worse, ids.skipped]);
    expect(list[1]).toMatchObject({ offered: 40, opened: 1 });
  });

  it("never suggests another reader's feeds", async () => {
    const { t, owner, reader, readerLibraryId } =
      await secondReaderTest(modules);
    await t.run((ctx) => counted(ctx, readerLibraryId, "theirs", 50, 0));
    expect(await owner.query(api.feedSuggestions.list, {})).toEqual([]);
    expect(await reader.query(api.feedSuggestions.list, {})).toHaveLength(1);
  });

  it("is silenced for 90 days by Keep, and speaks again after", async () => {
    const { t, owner } = await secondReaderTest(modules);
    const feedId = await t.run((ctx) => counted(ctx, OWNER, "noisy", 40, 1));
    expect(await owner.query(api.feedSuggestions.list, {})).toHaveLength(1);

    await owner.mutation(api.feedSuggestions.keep, { feedId });
    expect(await owner.query(api.feedSuggestions.list, {})).toEqual([]);
    // Keeping twice only moves the end
    await owner.mutation(api.feedSuggestions.keep, { feedId });
    const kept = await t.run((ctx) =>
      ctx.db.query("suggestionKeeps").collect(),
    );
    expect(kept).toHaveLength(1);
    expect(kept[0]).toMatchObject({ kind: "feed", subject: feedId });

    // The sign-in session would lapse before 90 days, so the end is moved instead
    expect(KEEP_MS).toBe(90 * DAY);
    expect(kept[0].until).toBe(Date.now() + KEEP_MS);
    await t.run((ctx) => ctx.db.patch(kept[0]._id, { until: Date.now() + 1 }));
    expect(await owner.query(api.feedSuggestions.list, {})).toEqual([]);
    await t.run((ctx) => ctx.db.patch(kept[0]._id, { until: Date.now() - 1 }));
    expect(await owner.query(api.feedSuggestions.list, {})).toHaveLength(1);
  });

  it("keeps one feed's suggestion quiet without silencing another", async () => {
    const { t, owner } = await secondReaderTest(modules);
    const [a, b] = await t.run(async (ctx) => [
      await counted(ctx, OWNER, "a", 40, 1),
      await counted(ctx, OWNER, "b", 30, 0),
    ]);
    await owner.mutation(api.feedSuggestions.keep, { feedId: a });
    expect(
      (await owner.query(api.feedSuggestions.list, {})).map((s) => s.feedId),
    ).toEqual([b]);
  });

  it("will not keep a feed that belongs to someone else", async () => {
    const { t, owner, readerLibraryId } = await secondReaderTest(modules);
    const theirs = await t.run((ctx) =>
      counted(ctx, readerLibraryId, "theirs", 40, 0),
    );
    await expect(
      owner.mutation(api.feedSuggestions.keep, { feedId: theirs }),
    ).rejects.toThrow("Feed not found");
    expect(
      await t.run((ctx) => ctx.db.query("suggestionKeeps").collect()),
    ).toEqual([]);
  });

  it("changes nothing until the reader unsubscribes through the usual removal", async () => {
    const { t, owner } = await secondReaderTest(modules);
    const feedId = await t.run((ctx) => counted(ctx, OWNER, "noisy", 40, 0));
    await owner.query(api.feedSuggestions.list, {});
    expect(await t.run((ctx) => ctx.db.get(feedId))).not.toBeNull();

    await owner.mutation(api.feedSuggestions.keep, { feedId });
    await owner.mutation(api.feeds.remove, { feedId, articles: "keep" });
    expect(await t.run((ctx) => ctx.db.get(feedId))).toBeNull();
    // Its kept suggestion goes with it
    expect(
      await t.run((ctx) => ctx.db.query("suggestionKeeps").collect()),
    ).toEqual([]);
    expect(await owner.query(api.feedSuggestions.list, {})).toEqual([]);
  });
});
