/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ownerTest, secondReaderTest } from "../test/owner";
import { api, internal } from "./_generated/api";
import { readFeedBody, selectFeedItems } from "./actions/pollFeeds";
import { invalidateFeedPoll, purgeFeedPolls } from "./lib/feedPollLifecycle";
import {
  FEED_BODY_BYTES,
  FEED_LEASE_MS,
  OPML_BATCH_BYTES,
  utf8Bytes,
} from "./lib/feedPollProtocol";

const modules = import.meta.glob("./**/*.ts");
const OWNER = "default_user";
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
const xml = (id = "one") =>
  `<rss version="2.0"><channel><title>Fixture</title><item><guid>${id}</guid><link>https://posts.example/${id}</link><title>${id}</title></item></channel></rss>`;
const entry = (guid = "one") => ({
  guid,
  url: `https://posts.example/${guid}`,
  title: guid,
});

async function fixture(count = 1) {
  const t = await ownerTest(modules);
  const ids = await t.run(async (ctx) => {
    const ids = [];
    for (let n = 0; n < count; n++)
      ids.push(
        await ctx.db.insert("feeds", {
          userId: OWNER,
          url: `https://feed${n}.example/rss`,
          title: `Feed ${n}`,
          isActive: true,
          createdAt: Date.now(),
        }),
      );
    return ids;
  });
  const dispatch = () => t.mutation(internal.feedPolling.dispatch, {});
  const begin = async () => {
    await t.mutation(internal.feedPolling.begin, { userId: OWNER });
    await dispatch();
  };
  const states = () => t.run((ctx) => ctx.db.query("feedPollStates").collect());
  await begin();
  const first = (await states())[0];
  const claim = { stateId: first._id, generation: first.generation };
  return { t, ids, dispatch, begin, states, claim };
}

describe("durable global feed pool", () => {
  it.each([
    "pause",
    "remove",
    "url",
    "expired-run",
  ])("holds the global network reservation through %s until its actual action settles", async (change) => {
    const f = await fixture(8);
    const releases: Array<() => void> = [];
    let initialStarted = () => {};
    let extraStarted = () => {};
    let laterStarted = () => {};
    const initial = new Promise<void>((resolve) => {
      initialStarted = resolve;
    });
    const extra = new Promise<void>((resolve) => {
      extraStarted = resolve;
    });
    const later = new Promise<void>((resolve) => {
      laterStarted = resolve;
    });
    let active = 0;
    let maximum = 0;
    const network = vi.fn(async (url: string) => {
      active++;
      maximum = Math.max(maximum, active);
      const held = new Promise<void>((resolve) => {
        releases.push(resolve);
      });
      if (releases.length === 4) initialStarted();
      if (releases.length > 4) extraStarted();
      if (releases.length === 8) laterStarted();
      await held;
      active--;
      return new Response(xml(new URL(url).hostname));
    });
    vi.stubGlobal("fetch", network);
    const first = (await f.states()).map((s) => ({
      stateId: s._id,
      generation: s.generation,
    }));
    const pending = first.map((claim) =>
      f.t.action(internal.actions.pollFeeds.pollClaimedFeed, claim),
    );
    try {
      await initial;
      // A duplicate delivery must not release the original delivery's slot.
      await f.t.action(internal.actions.pollFeeds.pollClaimedFeed, first[0]);
      for (const feedId of f.ids.slice(0, 4)) {
        const before = await f.t.run((ctx) => ctx.db.get(feedId));
        if (!before) throw new Error("Missing feed");
        if (change === "pause")
          await f.t.mutation(api.feeds.toggleActive, { feedId });
        else if (change === "remove")
          await f.t.mutation(api.feeds.remove, { feedId });
        else if (change === "url")
          await f.t.run(async (ctx) => {
            if (!before) throw new Error("Missing feed");
            const after = { ...before, url: "https://changed.example/rss" };
            await ctx.db.patch(before._id, { url: after.url });
            await invalidateFeedPoll(ctx, before, after);
          });
        else
          await f.t.run(async (ctx) => {
            const run = await ctx.db.query("feedPollRuns").first();
            if (!run) throw new Error("Missing run");
            await ctx.db.patch(run._id, { deadline: Date.now() - 1 });
          });
        // Public mutations explicitly invalidate today. Simulate the shared
        // registry calling the hook again: neither call owns network settlement.
        if (change !== "expired-run")
          await f.t.run(async (ctx) => {
            await invalidateFeedPoll(ctx, before, await ctx.db.get(feedId));
          });
        await f.dispatch();
        const ready = (await f.states()).filter(
          (s) => s.leaseUntil && !s.started,
        );
        pending.push(
          ...ready.map((s) =>
            f.t.action(internal.actions.pollFeeds.pollClaimedFeed, {
              stateId: s._id,
              generation: s.generation,
            }),
          ),
        );
        if (ready.length) await extra;
        expect(maximum).toBe(4);
        expect(active).toBe(4);
        expect(network).toHaveBeenCalledTimes(4);
      }
    } finally {
      for (const release of releases) release();
      await Promise.all(pending);
    }
    expect(
      await f.t.run((ctx) => ctx.db.query("articles").collect()),
    ).toHaveLength(0);
    if (change === "expired-run") await f.begin();
    else await f.dispatch();
    const ready = (await f.states()).filter((s) => s.leaseUntil && !s.started);
    const finishing = ready.map((s) =>
      f.t.action(internal.actions.pollFeeds.pollClaimedFeed, {
        stateId: s._id,
        generation: s.generation,
      }),
    );
    try {
      await later;
      expect(active).toBe(4);
      expect(maximum).toBe(4);
    } finally {
      for (const release of releases.slice(4)) release();
      await Promise.all(finishing);
    }
    await f.dispatch();
    expect(
      await f.t.run((ctx) => ctx.db.query("articles").collect()),
    ).toHaveLength(4);
    expect(
      (await f.t.run((ctx) => ctx.db.query("feedPollRuns").first()))?.active,
    ).toBe(false);
  });

  it("bounds late-starting network work by the reservation expiry before a lost-claim retry", async () => {
    const f = await fixture(8);
    const claims = (await f.states()).map((s) => ({
      stateId: s._id,
      generation: s.generation,
    }));
    const until = (await f.states())[0].leaseUntil;
    if (!until) throw new Error("Missing lease");
    vi.setSystemTime(until - 20);
    const timeout = vi
      .spyOn(AbortSignal, "timeout")
      .mockImplementation((ms) => {
        const controller = new AbortController();
        setTimeout(
          () => controller.abort(new Error("Fixture network deadline")),
          ms,
        );
        return controller.signal;
      });
    let starting = () => {};
    const started = new Promise<void>((resolve) => {
      starting = resolve;
    });
    let active = 0;
    const network = vi.fn(
      (_url: string, options: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          active++;
          options.signal?.addEventListener(
            "abort",
            () => {
              active--;
              reject(options.signal?.reason);
            },
            { once: true },
          );
          if (active === 4) starting();
        }),
    );
    vi.stubGlobal("fetch", network);
    const actions = claims.map((claim) =>
      f.t.action(internal.actions.pollFeeds.pollClaimedFeed, claim),
    );
    await started;
    expect(timeout.mock.calls.map(([ms]) => ms)).toEqual([20, 20, 20, 20]);
    // Advance only the provider timers, not independently queued fixture jobs.
    await f.t.run(async (ctx) => {
      for (const job of await ctx.db.system
        .query("_scheduled_functions")
        .collect())
        if (job.state.kind === "pending") await ctx.scheduler.cancel(job._id);
    });
    await vi.advanceTimersByTimeAsync(20);
    await Promise.all(actions);
    expect(active).toBe(0);
    await f.dispatch();
    expect((await f.states()).map((s) => s.attempts)).toEqual([2, 2, 2, 2]);
    for (const claim of claims)
      expect(await f.t.mutation(internal.feedPolling.settle, claim)).toBe(
        false,
      );
    expect(
      (await f.t.run((ctx) => ctx.db.query("feedPollPool").first()))?.slots,
    ).toHaveLength(4);
    expect(network).toHaveBeenCalledTimes(4);
  });

  it("keeps a deleted-state reservation bounded when its owning action is lost", async () => {
    const f = await fixture(8);
    expect(
      await f.t.mutation(internal.feedPolling.takePayload, f.claim),
    ).toBeTruthy();
    await f.t.mutation(api.feeds.remove, { feedId: f.ids[0] });
    await f.dispatch();
    expect(
      (await f.states()).filter((s) => s.leaseUntil && !s.started),
    ).toHaveLength(3);
    vi.setSystemTime(Date.now() + FEED_LEASE_MS + 1);
    await f.dispatch();
    const p = await f.t.run((ctx) => ctx.db.query("feedPollPool").first());
    expect(p?.slots).toHaveLength(4);
    expect(p?.slots.some((s) => s.stateId === f.claim.stateId)).toBe(false);
    expect(await f.t.mutation(internal.feedPolling.settle, f.claim)).toBe(
      false,
    );
  });

  it("shares held network reservations with another library after the source library is invalidated", async () => {
    const { t, owner, readerLibraryId } = await secondReaderTest(modules);
    const ownerIds = await t.run(async (ctx) => {
      const ids = [];
      for (const userId of [OWNER, readerLibraryId])
        for (let n = 0; n < 4; n++) {
          const id = await ctx.db.insert("feeds", {
            userId,
            url: `https://${userId === OWNER ? "owner" : "reader"}${n}.example/rss`,
            title: "Fixture",
            isActive: true,
            createdAt: Date.now(),
          });
          if (userId === OWNER) ids.push(id);
        }
      return ids;
    });
    await t.mutation(internal.feedPolling.begin, { userId: OWNER });
    await t.mutation(internal.feedPolling.dispatch, {});
    const claims = await t.run((ctx) =>
      ctx.db.query("feedPollStates").collect(),
    );
    const releases: Array<() => void> = [];
    let ownerStarting = () => {};
    let readerStarting = () => {};
    const ownerStarted = new Promise<void>((resolve) => {
      ownerStarting = resolve;
    });
    const readerStarted = new Promise<void>((resolve) => {
      readerStarting = resolve;
    });
    let active = 0;
    let maximum = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        active++;
        maximum = Math.max(maximum, active);
        const held = new Promise<void>((resolve) => {
          releases.push(resolve);
        });
        if (releases.length === 4) ownerStarting();
        if (releases.length === 5) readerStarting();
        await held;
        active--;
        return new Response(xml(new URL(url).hostname));
      }),
    );
    const actions = claims.map((s) =>
      t.action(internal.actions.pollFeeds.pollClaimedFeed, {
        stateId: s._id,
        generation: s.generation,
      }),
    );
    try {
      await ownerStarted;
      for (const feedId of ownerIds)
        await owner.mutation(api.feeds.remove, { feedId });
      await t.mutation(internal.feedPolling.begin, { userId: readerLibraryId });
      await t.mutation(internal.feedPolling.dispatch, {});
      expect(
        await t.run((ctx) => ctx.db.query("feedPollStates").collect()),
      ).toHaveLength(0);
      expect(active).toBe(4);
      releases[0]();
      await actions[0];
      await t.mutation(internal.feedPolling.dispatch, {});
      const [next] = await t.run((ctx) =>
        ctx.db.query("feedPollStates").collect(),
      );
      expect(next.userId).toBe(readerLibraryId);
      actions.push(
        t.action(internal.actions.pollFeeds.pollClaimedFeed, {
          stateId: next._id,
          generation: next.generation,
        }),
      );
      await readerStarted;
      expect(active).toBe(4);
      expect(maximum).toBe(4);
    } finally {
      for (const release of releases) release();
      await Promise.all(actions);
    }
    expect(
      (await t.run((ctx) => ctx.db.query("articles").collect())).map(
        (a) => a.userId,
      ),
    ).toEqual([readerLibraryId]);
  });

  it("a settled older generation cannot release or publish into a newer reservation", async () => {
    const f = await fixture(2);
    const releases: Array<() => void> = [];
    let oldStarting = () => {};
    let newStarting = () => {};
    const oldStarted = new Promise<void>((resolve) => {
      oldStarting = resolve;
    });
    const newStarted = new Promise<void>((resolve) => {
      newStarting = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const held = new Promise<void>((resolve) => {
          releases.push(resolve);
        });
        if (releases.length === 1) oldStarting();
        if (releases.length === 2) newStarting();
        await held;
        return new Response(
          xml(url.includes("changed") ? "new-generation" : "old-generation"),
        );
      }),
    );
    const oldAction = f.t.action(
      internal.actions.pollFeeds.pollClaimedFeed,
      f.claim,
    );
    const actions = [oldAction];
    try {
      await oldStarted;
      await f.t.run(async (ctx) => {
        const before = await ctx.db.get(f.ids[0]);
        const run = await ctx.db.query("feedPollRuns").first();
        if (!before || !run) throw new Error("Missing fixture state");
        const after = { ...before, url: "https://changed.example/rss" };
        await ctx.db.patch(before._id, { url: after.url });
        await invalidateFeedPoll(ctx, before, after);
        await ctx.db.patch(run._id, { active: false, exhausted: true });
      });
      await f.begin();
      const next = (await f.states()).find((s) => s.feedId === f.ids[0]);
      if (!next) throw new Error("Missing newer claim");
      actions.push(
        f.t.action(internal.actions.pollFeeds.pollClaimedFeed, {
          stateId: next._id,
          generation: next.generation,
        }),
      );
      await newStarted;
      releases[0]();
      await oldAction;
      expect(await f.t.mutation(internal.feedPolling.settle, f.claim)).toBe(
        false,
      );
      const p = await f.t.run((ctx) => ctx.db.query("feedPollPool").first());
      expect(
        p?.slots.some(
          (s) =>
            s.stateId === next._id &&
            s.generation === next.generation &&
            s.started,
        ),
      ).toBe(true);
      expect((await f.t.run((ctx) => ctx.db.get(next._id)))?.leaseUntil).toBe(
        next.leaseUntil,
      );
      expect(
        await f.t.run((ctx) => ctx.db.query("articles").collect()),
      ).toHaveLength(0);
    } finally {
      for (const release of releases) release();
      await Promise.all(actions);
    }
    expect(
      (await f.t.run((ctx) => ctx.db.query("articles").collect())).map(
        (a) => a.guid,
      ),
    ).toEqual(["new-generation"]);
  });

  it("invalidates URL-revision state and provides bounded, non-resurrecting purge hooks", async () => {
    const f = await fixture();
    await f.t.mutation(internal.feedPolling.finish, {
      ...f.claim,
      batches: 0,
      etag: '"old"',
      importAfter: 1,
    });
    await f.t.run(async (ctx) => {
      const before = await ctx.db.get(f.ids[0]);
      if (!before) throw new Error("missing feed");
      const after = { ...before, url: "https://new.example/rss" };
      await ctx.db.patch(before._id, { url: after.url });
      await invalidateFeedPoll(ctx, before, after);
    });
    expect((await f.states())[0].etag).toBeUndefined();
    expect(
      (await f.t.run((ctx) => ctx.db.get(f.ids[0])))?.lastFetchedAt,
    ).toBeUndefined();
    await f.t.run(async (ctx) => {
      const template = await ctx.db.query("feedPollStates").first();
      if (!template) throw new Error("missing state");
      const { _id, _creationTime, ...value } = template;
      for (let n = 0; n < 30; n++) {
        const feedId = await ctx.db.insert("feeds", {
          userId: OWNER,
          url: `https://purge${n}.example/rss`,
          title: "Purge",
          isActive: false,
          createdAt: Date.now(),
        });
        await ctx.db.insert("feedPollStates", { ...value, feedId });
      }
      await ctx.db.insert("feedPollStates", {
        ...value,
        userId: "retained-other",
      });
    });
    await expect(f.t.run((ctx) => purgeFeedPolls(ctx, OWNER))).rejects.toThrow(
      "retained",
    );
    const removed = "removed-library";
    await f.t.run(async (ctx) => {
      for (const row of await ctx.db.query("feedPollStates").collect())
        if (row.userId === OWNER)
          await ctx.db.patch(row._id, { userId: removed });
      const run = await ctx.db.query("feedPollRuns").first();
      if (run) await ctx.db.patch(run._id, { userId: removed });
    });
    expect(await f.t.run((ctx) => purgeFeedPolls(ctx, removed))).toBe(25);
    expect((await f.states()).filter((s) => s.userId === removed)).toHaveLength(
      6,
    );
    expect(await f.t.run((ctx) => purgeFeedPolls(ctx, removed))).toBe(6);
    expect(await f.t.run((ctx) => purgeFeedPolls(ctx, removed))).toBe(1);
    expect(await f.t.run((ctx) => purgeFeedPolls(ctx, removed))).toBe(0);
    expect((await f.states()).map((s) => s.userId)).toEqual(["retained-other"]);
    expect(
      await f.t.mutation(internal.feedPolling.commitItems, {
        ...f.claim,
        batch: 0,
        items: [entry()],
      }),
    ).toBe(false);
  });
  it("keeps later feeds moving around one held source; overlapping requests cannot allocate another pool", async () => {
    const f = await fixture(8);
    let release = () => {};
    let started = () => {};
    const starting = new Promise<void>((resolve) => {
      started = resolve;
    });
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let active = 0;
    let maximum = 0;
    const done: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        active++;
        maximum = Math.max(maximum, active);
        if (url.includes("feed0.")) {
          started();
          await held;
        }
        active--;
        done.push(url);
        return new Response(xml(url.split("//")[1].split(".")[0]));
      }),
    );
    const slow = f.t.action(
      internal.actions.pollFeeds.pollClaimedFeed,
      f.claim,
    );
    await starting;
    expect(active).toBe(1);
    await f.begin();
    for (let n = 0; n < 4; n++) {
      const ready = (await f.states()).filter(
        (s) => s.leaseUntil && !s.started && s._id !== f.claim.stateId,
      );
      await Promise.all(
        ready.map((s) =>
          f.t.action(internal.actions.pollFeeds.pollClaimedFeed, {
            stateId: s._id,
            generation: s.generation,
          }),
        ),
      );
      await f.dispatch();
    }
    expect(done).toHaveLength(7);
    expect(maximum).toBeLessThanOrEqual(4);
    expect(
      await f.t.run((ctx) => ctx.db.query("feedPollPool").collect()),
    ).toHaveLength(1);
    release();
    await slow;
    await f.dispatch();
    expect(
      await f.t.run((ctx) => ctx.db.query("articles").collect()),
    ).toHaveLength(8);
    expect(
      (await f.t.run((ctx) => ctx.db.query("feedPollRuns").first()))?.active,
    ).toBe(false);
  });

  it("claims each scheduled action delivery once", async () => {
    const f = await fixture();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(xml())),
    );
    await Promise.all([
      f.t.action(internal.actions.pollFeeds.pollClaimedFeed, f.claim),
      f.t.action(internal.actions.pollFeeds.pollClaimedFeed, f.claim),
    ]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("shares the same four slots across independent libraries", async () => {
    const { t, readerLibraryId } = await secondReaderTest(modules);
    await t.run(async (ctx) => {
      for (const userId of [OWNER, readerLibraryId])
        for (let n = 0; n < 5; n++)
          await ctx.db.insert("feeds", {
            userId,
            url: `https://f${n}.example/rss`,
            title: "Fixture",
            isActive: true,
            createdAt: Date.now(),
          });
    });
    for (const userId of [OWNER, readerLibraryId])
      await t.mutation(internal.feedPolling.begin, { userId });
    for (let n = 0; n < 4; n++)
      await t.mutation(internal.feedPolling.dispatch, {});
    expect(
      (await t.run((ctx) => ctx.db.query("feedPollPool").first()))?.slots,
    ).toHaveLength(4);
    expect(
      await t.run((ctx) => ctx.db.query("feedPollStates").collect()),
    ).toHaveLength(4);
  });

  it("old unfenced status writers cannot clear a durable claim", async () => {
    const f = await fixture();
    await f.t.mutation(internal.feeds.updateError, {
      feedId: f.ids[0],
      error: "stale",
    });
    await f.t.mutation(internal.feeds.updateLastFetched, { feedId: f.ids[0] });
    const feed = await f.t.run((ctx) => ctx.db.get(f.ids[0]));
    expect(feed?.checkingSince).toBeDefined();
    expect(feed?.lastFetchedAt).toBeUndefined();
    expect(feed?.lastError).toBeUndefined();
  });

  it("reconciles a byte-safe pair of near-limit saved bodies without replacing text or source identity", async () => {
    const f = await fixture();
    await f.t.run(async (ctx) => {
      for (const id of ["one", "two"])
        await ctx.db.insert("articles", {
          userId: OWNER,
          guid: `saved-${id}`,
          url: `https://posts.example/${id}`,
          title: "Saved",
          content: "x".repeat(900_000),
          extractionStatus: "extracted",
          annotationStatus: "annotated",
          createdAt: Date.now(),
        });
    });
    await f.t.mutation(internal.feedPolling.commitItems, {
      ...f.claim,
      batch: 0,
      items: [entry(), entry("two")],
    });
    const articles = await f.t.run((ctx) => ctx.db.query("articles").collect());
    expect(articles.map((a) => a.guid).sort()).toEqual([
      "saved-one",
      "saved-two",
    ]);
    expect(
      articles.every(
        (a) => a.content?.length === 900_000 && a.feedId === f.ids[0],
      ),
    ).toBe(true);
    await expect(
      f.t.mutation(internal.feedPolling.commitItems, {
        ...f.claim,
        batch: 1,
        items: [entry("three"), entry("four"), entry("five")],
      }),
    ).rejects.toThrow("exceeds budget");
  });

  it("reclaims a lost action once, fences its stale results, then terminates", async () => {
    vi.useFakeTimers();
    const f = await fixture();
    // Simulate missing deliveries without executing any provider/extractor jobs.
    vi.setSystemTime(Date.now() + FEED_LEASE_MS + 1);
    await f.dispatch();
    const [retry] = await f.states();
    expect(retry.attempts).toBe(2);
    expect(retry.generation).toBeGreaterThan(f.claim.generation);
    expect(
      await f.t.mutation(internal.feedPolling.commitItems, {
        ...f.claim,
        batch: 0,
        items: [entry()],
      }),
    ).toBe(false);
    expect(
      await f.t.mutation(internal.feedPolling.finish, {
        ...f.claim,
        error: "old failure",
      }),
    ).toBe(false);
    expect(
      (await f.t.run((ctx) => ctx.db.get(f.ids[0])))?.checkingSince,
    ).toBeDefined();
    vi.setSystemTime(Date.now() + FEED_LEASE_MS + 1);
    await f.dispatch();
    expect((await f.states())[0].leaseUntil).toBeUndefined();
    expect((await f.t.run((ctx) => ctx.db.get(f.ids[0])))?.lastError).toContain(
      "interrupted",
    );
    expect(
      (await f.t.run((ctx) => ctx.db.query("feedPollRuns").first()))?.active,
    ).toBe(false);
  });

  it("commits each pending import's durable extraction wake before feed completion, and rejects out-of-order completion", async () => {
    const f = await fixture();
    await expect(
      f.t.mutation(internal.feedPolling.commitItems, {
        ...f.claim,
        batch: 1,
        items: [entry()],
      }),
    ).rejects.toThrow("out of order");
    await f.t.mutation(internal.feedPolling.commitItems, {
      ...f.claim,
      batch: 0,
      items: [entry()],
    });
    await f.t.mutation(internal.feedPolling.commitItems, {
      ...f.claim,
      batch: 0,
      items: [entry()],
    });
    const rows = await f.t.run((ctx) => ctx.db.query("articles").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0].extractionStatus).toBe("pending");
    const jobs = await f.t.run((ctx) =>
      ctx.db.system.query("_scheduled_functions").collect(),
    );
    expect(
      jobs.filter((j) => j.name === "articleExtraction:start"),
    ).toHaveLength(1);
    await expect(
      f.t.mutation(internal.feedPolling.finish, {
        ...f.claim,
        batches: 2,
        etag: '"new"',
      }),
    ).rejects.toThrow("not fully committed");
    expect((await f.states())[0].etag).toBeUndefined();
    // Re-fetch after interruption still upserts by the deployed URL/GUID aliases.
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + FEED_LEASE_MS + 1);
    await f.dispatch();
    const [retry] = await f.states();
    const retryClaim = { stateId: retry._id, generation: retry.generation };
    await f.t.mutation(internal.feedPolling.commitItems, {
      ...retryClaim,
      batch: 0,
      items: [entry(), entry("two")],
    });
    await f.t.mutation(internal.feedPolling.finish, {
      ...retryClaim,
      batches: 1,
      etag: '"new"',
    });
    expect(
      await f.t.run((ctx) => ctx.db.query("articles").collect()),
    ).toHaveLength(2);
    expect((await f.states())[0].etag).toBe('"new"');
  });

  it("never sends a response validator from an interrupted first-poll batch", async () => {
    const f = await fixture();
    await f.t.mutation(internal.feedPolling.commitItems, {
      ...f.claim,
      batch: 0,
      items: [entry()],
    });
    await f.t.mutation(internal.feedPolling.finish, {
      ...f.claim,
      error: "interrupted after item commit",
    });
    await f.dispatch();
    await f.begin();
    const [next] = await f.states();
    const network = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response(xml("two"), { headers: { etag: '"committed"' } }),
    );
    vi.stubGlobal("fetch", network);
    await f.t.action(internal.actions.pollFeeds.pollClaimedFeed, {
      stateId: next._id,
      generation: next.generation,
    });
    expect(network.mock.calls[0][1]?.headers).not.toHaveProperty(
      "If-None-Match",
    );
    expect(
      await f.t.run((ctx) => ctx.db.query("articles").collect()),
    ).toHaveLength(2);
    expect((await f.states())[0].etag).toBe('"committed"');
  });

  it.each([
    "pause",
    "remove",
    "url",
    "foreign",
  ])("fences item/error publication after %s", async (change) => {
    const f = await fixture();
    if (change === "pause")
      await f.t.mutation(api.feeds.toggleActive, { feedId: f.ids[0] });
    else if (change === "remove")
      await f.t.mutation(api.feeds.remove, { feedId: f.ids[0] });
    else
      await f.t.run((ctx) =>
        ctx.db.patch(
          f.ids[0],
          change === "url"
            ? { url: "https://other.example/rss" }
            : { userId: "foreign" },
        ),
      );
    expect(
      await f.t.mutation(internal.feedPolling.commitItems, {
        ...f.claim,
        batch: 0,
        items: [entry()],
      }),
    ).toBe(false);
    expect(
      await f.t.mutation(internal.feedPolling.finish, {
        ...f.claim,
        error: "old",
      }),
    ).toBe(false);
    expect(
      await f.t.run((ctx) => ctx.db.query("articles").collect()),
    ).toHaveLength(0);
  });

  it.each([
    "disabled",
    "deleting",
    "removed",
  ])("rejects a %s library at the private commit boundary", async (change) => {
    const { t, readerLibraryId } = await secondReaderTest(modules);
    await t.run((ctx) =>
      ctx.db.insert("feeds", {
        userId: readerLibraryId,
        url: "https://private.example/rss",
        title: "Private",
        isActive: true,
        createdAt: Date.now(),
      }),
    );
    await t.mutation(internal.feedPolling.begin, { userId: readerLibraryId });
    await t.mutation(internal.feedPolling.dispatch, {});
    const state = await t.run((ctx) => ctx.db.query("feedPollStates").first());
    if (!state) throw new Error("missing claim");
    await t.run(async (ctx) => {
      const reader = await ctx.db.query("readers").first();
      if (!reader) throw new Error("missing reader");
      if (change === "removed") await ctx.db.delete(reader._id);
      else
        await ctx.db.patch(
          reader._id,
          change === "disabled" ? { status: "disabled" } : { deletingAt: 0 },
        );
    });
    expect(
      await t.mutation(internal.feedPolling.commitItems, {
        stateId: state._id,
        generation: state.generation,
        batch: 0,
        items: [entry()],
      }),
    ).toBe(false);
  });
});

describe("conditional representation commits", () => {
  it("retains valid DOCTYPE feeds without requesting their external DTD", async () => {
    const f = await fixture();
    const network = vi.fn(
      async () =>
        new Response(
          `<!DOCTYPE rss SYSTEM "https://unused.invalid/rss.dtd">${xml()}`,
        ),
    );
    vi.stubGlobal("fetch", network);
    await f.t.action(internal.actions.pollFeeds.pollClaimedFeed, f.claim);
    expect(network).toHaveBeenCalledTimes(1);
    expect(
      await f.t.run((ctx) => ctx.db.query("articles").collect()),
    ).toHaveLength(1);
    expect(
      (await f.t.run((ctx) => ctx.db.get(f.ids[0])))?.lastError,
    ).toBeUndefined();
  });
  it("binds validators to the final representation URL, not a redirect or its replacement", async () => {
    const f = await fixture();
    const network = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: "https://cdn.example/v1" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(xml("one"), { headers: { etag: '"cdn-v1"' } }),
      )
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: "https://cdn.example/v2" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(xml("two"), { headers: { etag: '"cdn-v2"' } }),
      );
    vi.stubGlobal("fetch", network);
    await f.t.action(internal.actions.pollFeeds.pollClaimedFeed, f.claim);
    await f.dispatch();
    await f.begin();
    const [next] = await f.states();
    await f.t.action(internal.actions.pollFeeds.pollClaimedFeed, {
      stateId: next._id,
      generation: next.generation,
    });
    expect(network.mock.calls[2][1].headers).not.toHaveProperty(
      "If-None-Match",
    );
    expect(network.mock.calls[3][1].headers).not.toHaveProperty(
      "If-None-Match",
    );
    expect((await f.states())[0].representationUrl).toBe(
      "https://cdn.example/v2",
    );
    expect(
      await f.t.run((ctx) => ctx.db.query("articles").collect()),
    ).toHaveLength(2);
  });

  it("bounds redirect requests by the same network lease", async () => {
    const f = await fixture();
    const network = vi.fn(
      async () =>
        new Response(null, { status: 302, headers: { location: "/loop" } }),
    );
    vi.stubGlobal("fetch", network);
    await f.t.action(internal.actions.pollFeeds.pollClaimedFeed, f.claim);
    expect(network).toHaveBeenCalledTimes(4);
    expect((await f.t.run((ctx) => ctx.db.get(f.ids[0])))?.lastError).toContain(
      "three redirects",
    );
  });

  it("sends validators only after commit; 304 never parses a body or rewrites articles", async () => {
    const f = await fixture();
    const network = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(xml(), {
          headers: {
            etag: '"v1"',
            "last-modified": "Mon, 01 Jun 2026 00:00:00 GMT",
          },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 304 }));
    vi.stubGlobal("fetch", network);
    await f.t.action(internal.actions.pollFeeds.pollClaimedFeed, f.claim);
    await f.dispatch();
    const before = await f.t.run((ctx) => ctx.db.query("articles").collect());
    await f.begin();
    const [state] = await f.states();
    await f.t.action(internal.actions.pollFeeds.pollClaimedFeed, {
      stateId: state._id,
      generation: state.generation,
    });
    expect(network.mock.calls[1][1].headers).toMatchObject({
      "If-None-Match": '"v1"',
      "If-Modified-Since": "Mon, 01 Jun 2026 00:00:00 GMT",
    });
    expect(await f.t.run((ctx) => ctx.db.query("articles").collect())).toEqual(
      before,
    );
    expect(
      (await f.t.run((ctx) => ctx.db.get(f.ids[0])))?.lastError,
    ).toBeUndefined();
  });

  it("treats first-poll 304 as failure and never marks its archive fetched", async () => {
    const f = await fixture();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 304 })),
    );
    await f.t.action(internal.actions.pollFeeds.pollClaimedFeed, f.claim);
    const feed = await f.t.run((ctx) => ctx.db.get(f.ids[0]));
    expect(feed?.lastFetchedAt).toBeUndefined();
    expect(feed?.lastError).toBe("Unexpected first-poll 304");
  });

  it.each([
    "malformed",
    "oversized",
    "declarations",
    "too-many",
  ])("reports %s feeds without publishing validators", async (kind) => {
    const f = await fixture();
    const body =
      kind === "malformed"
        ? "<rss><broken>"
        : kind === "oversized"
          ? "x".repeat(FEED_BODY_BYTES + 1)
          : kind === "declarations"
            ? '<!DOCTYPE rss [<!ENTITY x "boom">]><rss/>'
            : `<rss version="2.0"><channel><title>x</title>${"<item><title>x</title></item>".repeat(201)}</channel></rss>`;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => new Response(body, { headers: { etag: "uncommitted" } }),
      ),
    );
    await f.t.action(internal.actions.pollFeeds.pollClaimedFeed, f.claim);
    expect(
      (await f.t.run((ctx) => ctx.db.get(f.ids[0])))?.lastError,
    ).toBeTruthy();
    expect((await f.states())[0].etag).toBeUndefined();
  });

  it("cancels a stalled streaming body at the shared network deadline", async () => {
    const controller = new AbortController();
    let cancelled = false;
    const response = new Response(
      new ReadableStream({
        cancel: () => {
          cancelled = true;
        },
      }),
    );
    const reading = readFeedBody(response, controller.signal);
    controller.abort();
    await expect(reading).rejects.toThrow();
    expect(cancelled).toBe(true);
  });

  it("accepts exactly the body-byte budget without allocating an unbounded chunk list", async () => {
    const body = " ".repeat(FEED_BODY_BYTES);
    expect(
      await readFeedBody(new Response(body), new AbortController().signal),
    ).toHaveLength(FEED_BODY_BYTES);
  });

  it("retains undated first-poll bounds and importAfter cutoff", () => {
    const items = Array.from({ length: 6 }, (_, n) => ({
      guid: `${n}`,
      title: `${n}`,
    }));
    expect(selectFeedItems(items, {}, Date.now()).entries).toHaveLength(3);
    expect(
      selectFeedItems(
        [{ guid: "old", pubDate: "2020-01-01" }, { guid: "new" }],
        { lastFetchedAt: 1, importAfter: Date.parse("2026-01-01") },
        Date.now(),
      ).entries.map((i) => i.guid),
    ).toEqual(["new"]);
  });
});

describe("OPML bounded acknowledgements", () => {
  it("returns per-entry outcomes, normalizes duplicate variants, and is replay-safe", async () => {
    const t = await ownerTest(modules);
    const entries = [
      { url: "https://EXAMPLE.com:443/rss#one", title: "One" },
      { url: "https://example.com/rss", title: "Again" },
      { url: "javascript:alert(1)", title: "Bad" },
    ];
    expect(
      (await t.mutation(api.feeds.addBatch, { entries })).map((o) => o.status),
    ).toEqual(["created", "duplicate", "invalid"]);
    expect(
      (await t.mutation(api.feeds.addBatch, { entries })).map((o) => o.status),
    ).toEqual(["duplicate", "duplicate", "invalid"]);
    expect(await t.query(api.feeds.list, {})).toHaveLength(1);
  });
  it("enforces exact count and UTF-8 aggregate budgets before any writes", async () => {
    const t = await ownerTest(modules);
    const entries = Array.from({ length: 10 }, (_, n) => ({
      url: `https://feed${n}.example/rss`,
      title: "x",
    }));
    expect(await t.mutation(api.feeds.addBatch, { entries })).toHaveLength(10);
    await expect(
      t.mutation(api.feeds.addBatch, { entries: [...entries, entries[0]] }),
    ).rejects.toThrow("at most 10");
    const oversized = entries.map((e) => ({ ...e, title: "é".repeat(2000) }));
    expect(utf8Bytes(oversized)).toBeGreaterThan(OPML_BATCH_BYTES);
    await expect(
      t.mutation(api.feeds.addBatch, { entries: oversized }),
    ).rejects.toThrow("32 KiB");
    expect(await t.query(api.feeds.list, {})).toHaveLength(10);
    const exact = Array.from({ length: 8 }, (_, n) => ({
      url: `https://exact${n}.example/rss`,
      title: "x",
      description: "",
    }));
    for (const e of exact)
      e.description = "x".repeat(
        Math.min(4000, OPML_BATCH_BYTES - utf8Bytes(exact)),
      );
    exact[0].description += "x".repeat(OPML_BATCH_BYTES - utf8Bytes(exact));
    expect(utf8Bytes(exact)).toBe(OPML_BATCH_BYTES);
    expect(
      (await t.mutation(api.feeds.addBatch, { entries: exact })).map(
        (o) => o.status,
      ),
    ).toEqual(Array(8).fill("created"));
    exact[0].description += "x";
    await expect(
      t.mutation(api.feeds.addBatch, { entries: exact }),
    ).rejects.toThrow("32 KiB");
  });
  it("authorizes each batch and keeps the same URL private to each reader", async () => {
    const { t, owner, reader } = await secondReaderTest(modules);
    const args = {
      entries: [{ url: "https://same.example/rss", title: "Same" }],
    };
    await expect(t.mutation(api.feeds.addBatch, args)).rejects.toThrow();
    expect((await owner.mutation(api.feeds.addBatch, args))[0].status).toBe(
      "created",
    );
    expect((await reader.mutation(api.feeds.addBatch, args))[0].status).toBe(
      "created",
    );
  });
});
