import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internalMutation } from "./functions";
import {
  FEED_BATCH_BYTES,
  FEED_FETCH_SLOTS,
  FEED_ITEM_BATCH,
  FEED_LEASE_MS,
  FEED_RUN_MS,
  pollClaim,
  utf8Bytes,
  validFeedEntry,
} from "./lib/feedPollProtocol";
import { metadataLibraryActive } from "./lib/shelfCounts";

type Claim = { stateId: Id<"feedPollStates">; generation: number };

async function pool(ctx: Pick<QueryCtx, "db">) {
  return ctx.db
    .query("feedPollPool")
    .withIndex("by_key", (q) => q.eq("key", "global"))
    .unique();
}

async function current(ctx: Pick<QueryCtx, "db">, claim: Claim) {
  const state = await ctx.db.get(claim.stateId);
  if (
    !state ||
    state.generation !== claim.generation ||
    !state.leaseUntil ||
    state.leaseUntil <= Date.now()
  )
    return null;
  const feed = await ctx.db.get(state.feedId);
  const run = await ctx.db
    .query("feedPollRuns")
    .withIndex("by_userId", (q) => q.eq("userId", state.userId))
    .unique();
  if (
    feed?.userId !== state.userId ||
    !feed.isActive ||
    feed.url !== state.url ||
    !run?.active ||
    run.run !== state.run ||
    run.deadline <= Date.now() ||
    !(await metadataLibraryActive(ctx, state.userId))
  )
    return null;
  return { state, feed };
}

/** Compatible entry point for both old cron payloads and the manual action. */
export const begin = internalMutation({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    if (!(await metadataLibraryActive(ctx, userId))) return;
    const old = await ctx.db
      .query("feedPollRuns")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();
    if (!old?.active || old.deadline <= Date.now()) {
      const value = {
        userId,
        run: (old?.run ?? 0) + 1,
        active: true,
        // A time-bounded run resumes its unvisited tail at the next request.
        cursor: old && !old.exhausted ? old.cursor : undefined,
        scanned: 0,
        exhausted: false,
        deadline: Date.now() + FEED_RUN_MS,
      };
      if (old) await ctx.db.replace(old._id, value);
      else await ctx.db.insert("feedPollRuns", value);
      // A lost dispatcher has a finite recovery boundary, even with no slots.
      await ctx.scheduler.runAfter(
        FEED_RUN_MS,
        internal.feedPolling.dispatch,
        {},
      );
      // Retain the deployed bounded legacy wake, even if no feed adds a row.
      // The existing per-library extraction claims still cap workers at two.
      await ctx.scheduler.runAfter(
        0,
        internal.actions.extractArticle.extractPending,
        { userId },
      );
    }
    if (!(await pool(ctx)))
      await ctx.db.insert("feedPollPool", { key: "global", slots: [] });
    await ctx.scheduler.runAfter(0, internal.feedPolling.dispatch, {});
  },
});

async function launch(
  ctx: MutationCtx,
  state: Doc<"feedPollStates">,
  run: Doc<"feedPollRuns">,
) {
  const claim = { stateId: state._id, generation: state.generation };
  await ctx.scheduler.runAfter(
    0,
    internal.actions.pollFeeds.pollClaimedFeed,
    claim,
  );
  await ctx.scheduler.runAfter(
    FEED_LEASE_MS + 1,
    internal.feedPolling.dispatch,
    {},
  );
  return {
    ...claim,
    runId: run._id,
    run: run.run,
    started: false,
    leaseUntil: state.leaseUntil ?? Date.now() + FEED_LEASE_MS,
  };
}

/** The only allocator of network slots, shared across pages, libraries and runs. */
export const dispatch = internalMutation({
  args: {},
  handler: async (ctx) => {
    const p = await pool(ctx);
    if (!p) return;
    const slots: typeof p.slots = [];
    for (const slot of p.slots) {
      const state = await ctx.db.get(slot.stateId);
      if (slot.leaseUntil > Date.now()) {
        // Publication revocation is NOT network settlement. An action which
        // took this slot can still be fetching after its state was removed.
        if (slot.started || (await current(ctx, slot))) {
          slots.push(slot);
          continue;
        }
      }
      if (!state || state.generation !== slot.generation || !state.leaseUntil)
        continue;
      if (slot.leaseUntil <= Date.now()) {
        const feed = await ctx.db.get(state.feedId);
        const run = await ctx.db
          .query("feedPollRuns")
          .withIndex("by_userId", (q) => q.eq("userId", state.userId))
          .unique();
        if (
          state.attempts < 2 &&
          feed?.userId === state.userId &&
          feed.isActive &&
          feed.url === state.url &&
          run?.active &&
          run.run === state.run &&
          run.deadline > Date.now() &&
          (await metadataLibraryActive(ctx, state.userId))
        ) {
          const next = {
            ...state,
            attempts: state.attempts + 1,
            generation: state.generation + 1,
            nextBatch: 0,
            started: false,
            leaseUntil: Date.now() + FEED_LEASE_MS,
          };
          await ctx.db.patch(state._id, {
            attempts: next.attempts,
            generation: next.generation,
            nextBatch: 0,
            started: false,
            leaseUntil: next.leaseUntil,
          });
          await ctx.db.patch(state.feedId, { checkingSince: Date.now() });
          slots.push(await launch(ctx, next, run));
          continue;
        }
      }
      await ctx.db.patch(state._id, { leaseUntil: undefined });
      const feed = await ctx.db.get(state.feedId);
      if (feed?.userId === state.userId)
        await ctx.db.patch(feed._id, {
          checkingSince: undefined,
          lastError: "Feed check interrupted; try checking again.",
        });
    }

    // Bounded run selection and at most four source-row reads/transaction.
    const runs = await ctx.db
      .query("feedPollRuns")
      .withIndex("by_active", (q) => q.eq("active", true))
      .take(4);
    let progressed = false;
    let selected = false;
    for (const run of runs) {
      if (
        run.deadline <= Date.now() ||
        !(await metadataLibraryActive(ctx, run.userId))
      ) {
        await ctx.db.patch(run._id, { active: false });
        continue;
      }
      let cursor = run.cursor;
      let exhausted = run.exhausted;
      let scanned = run.scanned;
      if (!selected && !exhausted && slots.length < FEED_FETCH_SLOTS) {
        selected = true;
        // Convex permits one paginated query per transaction. Never consume
        // more rows than free slots, including paused feeds in this page.
        const page = await ctx.db
          .query("feeds")
          .withIndex("by_user", (q) => q.eq("userId", run.userId))
          .paginate({
            cursor: cursor ?? null,
            numItems: FEED_FETCH_SLOTS - slots.length,
            maximumBytesRead: 128 * 1024,
          });
        cursor = page.continueCursor;
        scanned += page.page.length;
        exhausted = page.isDone;
        progressed = true;
        for (const feed of page.page) {
          if (!feed?.isActive) continue;
          const invalid = validFeedEntry({ url: feed.url, title: "" });
          if (invalid) {
            await ctx.db.patch(feed._id, {
              checkingSince: undefined,
              lastError: invalid,
            });
            continue;
          }
          const prior = await ctx.db
            .query("feedPollStates")
            .withIndex("by_feedId", (q) => q.eq("feedId", feed._id))
            .unique();
          const value = {
            userId: run.userId,
            feedId: feed._id,
            url: feed.url,
            run: run.run,
            generation: (prior?.generation ?? 0) + 1,
            attempts: 1,
            nextBatch: 0,
            started: false,
            leaseUntil: Date.now() + FEED_LEASE_MS,
            etag: prior?.url === feed.url ? prior.etag : undefined,
            modified: prior?.url === feed.url ? prior.modified : undefined,
            representationUrl:
              prior?.url === feed.url ? prior.representationUrl : undefined,
          };
          const stateId =
            prior?._id ?? (await ctx.db.insert("feedPollStates", value));
          if (prior) await ctx.db.replace(stateId, value);
          await ctx.db.patch(feed._id, { checkingSince: Date.now() });
          slots.push(
            await launch(
              ctx,
              {
                ...value,
                _id: stateId,
                _creationTime: prior?._creationTime ?? Date.now(),
              },
              run,
            ),
          );
        }
      }
      // A run only retires after selection AND its claimed actions finish.
      const ownSlots = slots.some(
        (slot) => slot.runId === run._id && slot.run === run.run,
      );
      await ctx.db.patch(run._id, {
        cursor,
        scanned,
        exhausted,
        active: !exhausted || ownSlots,
      });
    }
    await ctx.db.patch(p._id, { slots });
    if (progressed && slots.length < FEED_FETCH_SLOTS)
      await ctx.scheduler.runAfter(0, internal.feedPolling.dispatch, {});
  },
});

export const takePayload = internalMutation({
  args: pollClaim,
  handler: async (ctx, claim) => {
    const p = await pool(ctx);
    const slot = p?.slots.find(
      (s) => s.stateId === claim.stateId && s.generation === claim.generation,
    );
    if (!p || !slot || slot.started || slot.leaseUntil <= Date.now())
      return null;
    const value = await current(ctx, claim);
    if (!value || value.state.started) return null;
    const { feed, state } = value;
    if (feed.url.length > 4096) return null;
    await ctx.db.patch(state._id, { started: true });
    await ctx.db.patch(p._id, {
      slots: p.slots.map((s) => (s === slot ? { ...s, started: true } : s)),
    });
    return {
      feedId: feed._id,
      url: feed.url,
      lastFetchedAt: feed.lastFetchedAt,
      importAfter: feed.importAfter,
      etag: feed.lastFetchedAt !== undefined ? state.etag : undefined,
      modified: feed.lastFetchedAt !== undefined ? state.modified : undefined,
      representationUrl: state.representationUrl,
      reservationUntil: slot.leaseUntil,
    };
  },
});

/** Called only by the delivery which atomically took the reservation, after
 * its network/body work has settled. Duplicate deliveries never own this right. */
export const settle = internalMutation({
  args: pollClaim,
  handler: async (ctx, claim) => {
    const p = await pool(ctx);
    const slot = p?.slots.find(
      (s) => s.stateId === claim.stateId && s.generation === claim.generation,
    );
    if (!p || !slot?.started) return false;
    const state = await ctx.db.get(claim.stateId);
    if (
      state?.generation === claim.generation &&
      state.leaseUntil !== undefined
    ) {
      // An RPC failure/early exit before finish must retain bounded recovery,
      // but the settled network no longer needs to occupy its original lease.
      await ctx.db.patch(state._id, { leaseUntil: Date.now() });
      await ctx.db.patch(p._id, {
        slots: p.slots.map((s) =>
          s === slot ? { ...s, leaseUntil: Date.now() } : s,
        ),
      });
    } else {
      await ctx.db.patch(p._id, { slots: p.slots.filter((s) => s !== slot) });
    }
    await ctx.scheduler.runAfter(0, internal.feedPolling.dispatch, {});
    return true;
  },
});

const item = v.object({
  guid: v.string(),
  url: v.string(),
  title: v.string(),
  author: v.optional(v.string()),
  publishedAt: v.optional(v.number()),
  excerpt: v.optional(v.string()),
  imageUrl: v.optional(v.string()),
});

/** Guard + existing transactional upsert + extraction wake commit atomically. */
export const commitItems = internalMutation({
  args: { ...pollClaim, batch: v.number(), items: v.array(item) },
  handler: async (ctx, args): Promise<boolean> => {
    if (
      args.items.length > FEED_ITEM_BATCH ||
      utf8Bytes(args.items) > FEED_BATCH_BYTES
    )
      throw new Error("Feed item batch exceeds budget");
    const value = await current(ctx, args);
    if (!value) return false;
    if (args.batch < value.state.nextBatch) return true;
    if (args.batch !== value.state.nextBatch)
      throw new Error("Feed item batch out of order");
    for (const entry of args.items)
      await ctx.runMutation(internal.articles.upsertFeed, {
        ...entry,
        feedId: value.feed._id,
        userId: value.state.userId,
        extractionStatus: "pending",
        annotationStatus: "pending",
        createdAt: Date.now(),
      });
    await ctx.db.patch(value.state._id, { nextBatch: args.batch + 1 });
    return true;
  },
});

export const finish = internalMutation({
  args: {
    ...pollClaim,
    batches: v.optional(v.number()),
    unchanged: v.optional(v.boolean()),
    etag: v.optional(v.string()),
    modified: v.optional(v.string()),
    representationUrl: v.optional(v.string()),
    importAfter: v.optional(v.number()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const value = await current(ctx, args);
    if (!value) return false;
    const { state, feed } = value;
    if (!args.error) {
      if (
        args.unchanged &&
        (feed.lastFetchedAt === undefined ||
          (!state.etag && !state.modified) ||
          (args.representationUrl ?? feed.url) !==
            (state.representationUrl ?? state.url))
      )
        throw new Error("Unexpected first-poll 304");
      if (!args.unchanged && args.batches !== state.nextBatch)
        throw new Error("Feed items not fully committed");
      if (
        (args.etag?.length ?? 0) > 2048 ||
        (args.modified?.length ?? 0) > 2048 ||
        (args.representationUrl?.length ?? 0) > 4096
      )
        throw new Error("Feed validator exceeds budget");
      await ctx.db.patch(state._id, {
        etag: args.unchanged ? state.etag : args.etag,
        modified: args.unchanged ? state.modified : args.modified,
        representationUrl: args.unchanged
          ? state.representationUrl
          : (args.representationUrl ?? feed.url),
      });
      const patch: Partial<Doc<"feeds">> = {
        checkingSince: undefined,
        lastError: undefined,
        lastFetchedAt: Date.now(),
      };
      if (!args.unchanged) patch.importAfter = args.importAfter;
      await ctx.db.patch(feed._id, patch);
    } else
      await ctx.db.patch(feed._id, {
        checkingSince: undefined,
        lastError: args.error.slice(0, 500),
      });
    await ctx.db.patch(state._id, { leaseUntil: undefined });
    const p = await pool(ctx);
    if (p)
      await ctx.db.patch(p._id, {
        slots: p.slots.filter(
          (s) =>
            s.stateId !== state._id ||
            s.generation !== args.generation ||
            s.started,
        ),
      });
    await ctx.scheduler.runAfter(0, internal.feedPolling.dispatch, {});
    return true;
  },
});
