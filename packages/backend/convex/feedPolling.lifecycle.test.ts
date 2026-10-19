/// <reference types="vite/client" />
import { expect, it } from "vitest";
import { metadataContext } from "../test/metadata";
import { ownerTest, secondReaderTest } from "../test/owner";
import { api, internal } from "./_generated/api";
import { purgeFeedPolls } from "./lib/feedPollLifecycle";

const modules = import.meta.glob("./**/*.ts");

it("generic feed replacement and public removal use the installed hook without releasing a started reservation", async () => {
  const t = await ownerTest(modules);
  const feedId = await t.mutation(api.feeds.add, {
    url: "https://feed.example/rss",
    title: "Feed",
  });
  await t.mutation(internal.feedPolling.begin, { userId: "default_user" });
  await t.mutation(internal.feedPolling.dispatch, {});
  const state = await t.run((ctx) => ctx.db.query("feedPollStates").first());
  if (!state) throw new Error("Missing claim");
  const claim = { stateId: state._id, generation: state.generation };
  expect(
    await t.mutation(internal.feedPolling.takePayload, claim),
  ).not.toBeNull();
  await t.run(async (raw) => {
    const ctx = metadataContext(raw);
    const feed = await ctx.db.get(feedId);
    if (!feed) throw new Error("Missing feed");
    const { _id, _creationTime, ...fields } = feed;
    await ctx.db.replace(feedId, {
      ...fields,
      url: "https://changed.example/rss",
    });
  });
  const changed = await t.run((ctx) => ctx.db.get(state._id));
  expect(changed).toMatchObject({ generation: state.generation + 1 });
  expect(changed?.leaseUntil).toBeUndefined();
  const pool = await t.run((ctx) => ctx.db.query("feedPollPool").first());
  expect(pool?.slots).toMatchObject([{ ...claim, started: true }]);
  expect(
    await t.mutation(internal.feedPolling.commitItems, {
      ...claim,
      batch: 0,
      items: [],
    }),
  ).toBe(false);
  await t.mutation(api.feeds.remove, { feedId });
  expect(await t.run((ctx) => ctx.db.get(state._id))).toBeNull();
  expect(
    (await t.run((ctx) => ctx.db.query("feedPollPool").first()))?.slots,
  ).toMatchObject([{ ...claim, started: true }]);
  await t.mutation(internal.feedPolling.settle, claim);
  expect(
    (await t.run((ctx) => ctx.db.query("feedPollPool").first()))?.slots,
  ).toEqual([]);
});

it("purges deleting-library publication state in positive batches but keeps network ownership until settlement", async () => {
  const { t, readerLibraryId } = await secondReaderTest(modules);
  await t.run((ctx) =>
    ctx.db.insert("feeds", {
      userId: readerLibraryId,
      url: "https://reader.example/rss",
      title: "Reader",
      isActive: true,
      createdAt: 0,
    }),
  );
  await t.mutation(internal.feedPolling.begin, { userId: readerLibraryId });
  await t.mutation(internal.feedPolling.dispatch, {});
  const state = await t.run((ctx) => ctx.db.query("feedPollStates").first());
  if (!state) throw new Error("Missing claim");
  const claim = { stateId: state._id, generation: state.generation };
  await t.mutation(internal.feedPolling.takePayload, claim);
  await expect(
    t.run((ctx) => purgeFeedPolls(ctx, readerLibraryId)),
  ).rejects.toThrow("retained");
  await t.run(async (ctx) => {
    const reader = await ctx.db.query("readers").first();
    if (!reader) throw new Error("Missing reader");
    await ctx.db.patch(reader._id, { deletingAt: 1 });
  });
  expect(await t.run((ctx) => purgeFeedPolls(ctx, readerLibraryId))).toBe(1);
  expect(await t.run((ctx) => purgeFeedPolls(ctx, readerLibraryId))).toBe(1);
  expect(await t.run((ctx) => purgeFeedPolls(ctx, readerLibraryId))).toBe(0);
  expect(
    (await t.run((ctx) => ctx.db.query("feedPollPool").first()))?.slots,
  ).toMatchObject([{ ...claim, started: true }]);
  await t.mutation(internal.feedPolling.begin, { userId: readerLibraryId });
  expect(await t.run((ctx) => ctx.db.query("feedPollRuns").collect())).toEqual(
    [],
  );
  await t.mutation(internal.feedPolling.settle, claim);
  expect(
    (await t.run((ctx) => ctx.db.query("feedPollPool").first()))?.slots,
  ).toEqual([]);
});
