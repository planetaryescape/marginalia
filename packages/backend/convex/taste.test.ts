/// <reference types="vite/client" />
import type { PaginationResult } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { drain } from "../test/drain";
import { ownerTest, secondReaderTest } from "../test/owner";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { TASTE_MAX } from "./lib/taste";

const modules = import.meta.glob("./**/*.ts");
const OWNER = "default_user";

// Scheduled jobs stay queued until drained by hand, so no annotation runs
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

type T = Awaited<ReturnType<typeof ownerTest>>;
type Runner = Pick<T, "run" | "mutation">;

const taste = {
  "taste:recompute": internal.taste.recompute,
  "taste:accumulate": internal.taste.accumulate,
};
const drainTaste = (t: Runner) => drain(t, taste);

interface ArticleSeed {
  title: string;
  minutes: number;
  author?: string;
  feedId?: Id<"feeds">;
  status?: "annotated" | "deferred";
}

async function article(
  ctx: MutationCtx,
  userId: string,
  a: ArticleSeed,
  n: number,
) {
  return ctx.db.insert("articles", {
    userId,
    guid: `${userId}-${a.title}-${n}`,
    url: `https://example.com/${userId}/${n}`,
    title: a.title,
    author: a.author,
    feedId: a.feedId,
    extractionStatus: "extracted",
    annotationStatus: a.status ?? "annotated",
    estimatedReadMinutes: a.minutes,
    createdAt: Date.now(),
  });
}

const feed = (ctx: MutationCtx, userId: string, name: string) =>
  ctx.db.insert("feeds", {
    userId,
    url: `https://${name}.example/feed`,
    title: name,
    isActive: true,
    createdAt: Date.now(),
  });

const activeTag = (ctx: MutationCtx, userId: string, name: string) =>
  ctx.db.insert("tags", {
    userId,
    name,
    key: name,
    status: "active",
    count: 0,
    aliases: [],
    createdAt: Date.now(),
  });

const interact = (
  ctx: MutationCtx,
  userId: string,
  articleId: Id<"articles">,
  action: "opened" | "finished" | "skipped",
) =>
  ctx.db.insert("articleInteractions", {
    userId,
    articleId,
    action,
    createdAt: Date.now(),
  });

/** A reader who finishes Ada's pieces on attention and skips Bob's. */
async function seedHistory(ctx: MutationCtx, userId: string) {
  const loved = await feed(ctx, userId, `${userId}-loved`);
  const ignored = await feed(ctx, userId, `${userId}-ignored`);
  const attention = await activeTag(ctx, userId, "attention");
  const candidate = await ctx.db.insert("tags", {
    userId,
    name: "hidden",
    key: "hidden",
    status: "candidate",
    count: 0,
    aliases: [],
    createdAt: Date.now(),
  });
  for (let i = 0; i < 5; i++) {
    const good = await article(
      ctx,
      userId,
      {
        title: `good ${i}`,
        minutes: 10,
        author: "Ada Lovelace",
        feedId: loved,
      },
      i,
    );
    await interact(ctx, userId, good, "opened");
    await interact(ctx, userId, good, "finished");
    for (const tagId of [attention, candidate])
      await ctx.db.insert("articleTags", {
        userId,
        articleId: good,
        tagId,
        createdAt: Date.now(),
      });
    const bad = await article(
      ctx,
      userId,
      {
        title: `bad ${i}`,
        minutes: 10,
        author: "Bob Skipper",
        feedId: ignored,
      },
      100 + i,
    );
    await interact(ctx, userId, bad, "skipped");
  }
  await ctx.db.insert("feedStats", {
    userId,
    feedId: loved,
    offered: 20,
    opened: 15,
    finished: 12,
    skipped: 0,
    updatedAt: Date.now(),
  });
  await ctx.db.insert("feedStats", {
    userId,
    feedId: ignored,
    offered: 30,
    opened: 1,
    finished: 0,
    skipped: 20,
    updatedAt: Date.now(),
  });
  return { loved, ignored, attention, candidate };
}

const profileOf = (t: Runner, userId: string) =>
  t.run((ctx) =>
    ctx.db
      .query("tasteProfiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique(),
  );

describe("the taste profile", () => {
  it("learns who, what and where a reader finishes, and what they skip", async () => {
    const t = await ownerTest(modules);
    const seeded = await t.run((ctx) => seedHistory(ctx, OWNER));
    await t.mutation(internal.taste.recompute, { userId: OWNER });
    await drainTaste(t);

    const profile = await profileOf(t, OWNER);
    const at = (
      rows: { key: string; affinity: number }[] | undefined,
      key: string,
    ) => rows?.find((r) => r.key === key)?.affinity ?? 0;
    expect(at(profile?.authors, "ada lovelace")).toBeGreaterThan(0.4);
    expect(at(profile?.authors, "bob skipper")).toBeLessThan(-0.4);
    expect(at(profile?.feeds, seeded.loved)).toBeGreaterThan(0);
    expect(at(profile?.feeds, seeded.ignored)).toBeLessThan(0);
    expect(at(profile?.tags, seeded.attention)).toBeGreaterThan(0.4);
    // A candidate tag is not a topic yet
    expect(at(profile?.tags, seeded.candidate)).toBe(0);
    expect(profile?.evidence).toBe(10);
    expect(profile?.refreshQueuedAt).toBeUndefined();
  });

  it("reads many articles in pages, and keeps the row small", async () => {
    const t = await ownerTest(modules);
    await t.run(async (ctx) => {
      for (let i = 0; i < 60; i++) {
        const id = await article(
          ctx,
          OWNER,
          { title: `a${i}`, minutes: 5, author: `Writer ${i}` },
          i,
        );
        await interact(ctx, OWNER, id, "finished");
      }
    });
    await t.mutation(internal.taste.recompute, { userId: OWNER });
    await drainTaste(t);
    const profile = await profileOf(t, OWNER);
    expect(profile?.evidence).toBe(60);
    expect(profile?.authors.length).toBeLessThanOrEqual(40);
    const accumulate = (
      await t.run((ctx) =>
        ctx.db.system.query("_scheduled_functions").take(500),
      )
    ).filter((j) => j.name === "taste:accumulate");
    expect(accumulate.length).toBeGreaterThan(5);
  });

  it("uses loves and ratings as well as finishes", async () => {
    const t = await ownerTest(modules);
    await t.run(async (ctx) => {
      const loved = await article(
        ctx,
        OWNER,
        { title: "loved", minutes: 5, author: "Cleo" },
        1,
      );
      await ctx.db.insert("lovedArticles", {
        userId: OWNER,
        articleId: loved,
        lovedAt: Date.now(),
        reviewIndex: 0,
        nextReviewAt: Date.now(),
        reviewCount: 0,
      });
      const rated = await article(
        ctx,
        OWNER,
        { title: "rated", minutes: 5, author: "Dee" },
        2,
      );
      await ctx.db.insert("impressions", {
        userId: OWNER,
        articleId: rated,
        rating: 1,
        tags: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });
    await t.mutation(internal.taste.recompute, { userId: OWNER });
    await drainTaste(t);
    const profile = await profileOf(t, OWNER);
    expect(
      profile?.authors.find((a) => a.key === "cleo")?.affinity,
    ).toBeGreaterThan(0);
    expect(
      profile?.authors.find((a) => a.key === "dee")?.affinity,
    ).toBeLessThan(0);
  });

  it("handles authors whose names are not ASCII or look like object keys", async () => {
    const t = await ownerTest(modules);
    await t.run(async (ctx) => {
      for (const [i, author] of [
        "José García",
        "José García",
        "__proto__",
        "constructor",
        "李小龍",
      ].entries()) {
        const id = await article(
          ctx,
          OWNER,
          { title: `n${i}`, minutes: 5, author },
          i,
        );
        await interact(ctx, OWNER, id, "finished");
      }
      // More articles than one step reads, so the tally crosses transactions
      for (let i = 0; i < 12; i++) {
        const id = await article(
          ctx,
          OWNER,
          { title: `m${i}`, minutes: 5, author: "Zoë Müller" },
          50 + i,
        );
        await interact(ctx, OWNER, id, "finished");
      }
    });
    await t.mutation(internal.taste.recompute, { userId: OWNER });
    await drainTaste(t);
    const authors = (await profileOf(t, OWNER))?.authors ?? [];
    const keys = authors.map((a) => a.key);
    expect(keys).toEqual(
      expect.arrayContaining([
        "josé garcía",
        "__proto__",
        "constructor",
        "李小龍",
        "zoë müller",
      ]),
    );
    expect(authors.find((a) => a.key === "josé garcía")?.n).toBe(2);
  });

  it("keeps each reader's profile to their own history", async () => {
    const { t, readerLibraryId } = await secondReaderTest(modules);
    await t.run(async (ctx) => {
      await seedHistory(ctx, OWNER);
      // The other reader skips Ada and reads Bob
      const f = await feed(ctx, readerLibraryId, "theirs");
      for (let i = 0; i < 5; i++) {
        const ada = await article(
          ctx,
          readerLibraryId,
          { title: `ada ${i}`, minutes: 5, author: "Ada Lovelace", feedId: f },
          i,
        );
        await interact(ctx, readerLibraryId, ada, "skipped");
        const bob = await article(
          ctx,
          readerLibraryId,
          { title: `bob ${i}`, minutes: 5, author: "Bob Skipper", feedId: f },
          50 + i,
        );
        await interact(ctx, readerLibraryId, bob, "finished");
      }
    });
    for (const userId of [OWNER, readerLibraryId]) {
      await t.mutation(internal.taste.recompute, { userId });
    }
    await drainTaste(t);
    const mine = await profileOf(t, OWNER);
    const theirs = await profileOf(t, readerLibraryId);
    expect(
      mine?.authors.find((a) => a.key === "ada lovelace")?.affinity,
    ).toBeGreaterThan(0);
    expect(
      theirs?.authors.find((a) => a.key === "ada lovelace")?.affinity,
    ).toBeLessThan(0);
    expect(
      theirs?.authors.find((a) => a.key === "bob skipper")?.affinity,
    ).toBeGreaterThan(0);
    expect(JSON.stringify(theirs)).not.toContain(OWNER);
  });

  it("does not build a profile for a library being deleted", async () => {
    const { t, readerLibraryId } = await secondReaderTest(modules);
    await t.run(async (ctx) => {
      const reader = await ctx.db
        .query("readers")
        .withIndex("by_libraryId", (q) => q.eq("libraryId", readerLibraryId))
        .first();
      if (reader)
        await ctx.db.patch(reader._id, {
          status: "disabled",
          deletingAt: Date.now(),
        });
    });
    await t.mutation(internal.taste.recompute, { userId: readerLibraryId });
    await drainTaste(t);
    expect(await profileOf(t, readerLibraryId)).toBeNull();
  });

  it("queues one refresh after a run of finishes", async () => {
    const t = await ownerTest(modules);
    const ids = await t.run(async (ctx) => [
      await article(ctx, OWNER, { title: "one", minutes: 5 }, 1),
      await article(ctx, OWNER, { title: "two", minutes: 5 }, 2),
    ]);
    for (const articleId of ids)
      await t.mutation(api.sessions.recordInteraction, {
        articleId,
        action: "finished",
      });
    const queued = (
      await t.run((ctx) =>
        ctx.db.system.query("_scheduled_functions").take(500),
      )
    ).filter((j) => j.name === "taste:recompute");
    expect(queued).toHaveLength(1);
    const profile = await profileOf(t, OWNER);
    expect(profile?.refreshQueuedAt).toBeDefined();
    // The placeholder holds no taste, so the ranking ignores it
    expect(profile?.computedAt).toBe(0);
  });
});

async function library(t: T, rows: ArticleSeed[], userId = OWNER) {
  return t.run(async (ctx) => {
    const ids: Id<"articles">[] = [];
    for (const [i, a] of rows.entries())
      ids.push(await article(ctx, userId, a, i));
    return ids;
  });
}

const setProfile = (
  t: T,
  userId: string,
  profile: {
    feeds?: { key: string; affinity: number; n: number }[];
    authors?: { key: string; affinity: number; n: number }[];
    tags?: { key: string; affinity: number; n: number }[];
  },
) =>
  t.run((ctx) =>
    ctx.db.insert("tasteProfiles", {
      userId,
      feeds: profile.feeds ?? [],
      authors: profile.authors ?? [],
      tags: profile.tags ?? [],
      evidence: 10,
      computedAt: Date.now(),
    }),
  );

const deck = (t: T, requestedMinutes = 10) =>
  t.query(api.suggestions.forWindow, { requestedMinutes });

describe("taste in picks", () => {
  it("prefers the writer a reader finishes when two articles fit alike", async () => {
    const t = await ownerTest(modules);
    await library(t, [
      { title: "by a stranger", minutes: 10, author: "Zed" },
      { title: "by Ada", minutes: 10, author: "Ada Lovelace" },
    ]);
    // Without a profile, ties fall to the id (insertion order), so Ada's is second
    expect((await deck(t))[0].title).toBe("by a stranger");
    await setProfile(t, OWNER, {
      authors: [{ key: "ada lovelace", affinity: 0.8, n: 6 }],
    });
    const picks = await deck(t);
    expect(picks[0].title).toBe("by Ada");
    expect(picks[0].reason).toBe(
      "You usually finish pieces like this from this writer.",
    );
    // The stranger keeps the plain reason
    expect(picks[1].reason).toBe("Fits your 10-minute window");
  });

  it("names the topic when a tag is the strongest reason", async () => {
    const t = await ownerTest(modules);
    const [id] = await library(t, [{ title: "on attention", minutes: 10 }]);
    const tagId = await t.run(async (ctx) => {
      const tag = await activeTag(ctx, OWNER, "attention");
      await ctx.db.insert("articleTags", {
        userId: OWNER,
        articleId: id,
        tagId: tag,
        createdAt: Date.now(),
      });
      return tag;
    });
    await setProfile(t, OWNER, { tags: [{ key: tagId, affinity: 0.9, n: 8 }] });
    expect((await deck(t))[0].reason).toBe(
      "You often finish pieces on attention.",
    );
  });

  it("falls back to the length reason when taste has nothing to say, or only against", async () => {
    const t = await ownerTest(modules);
    await library(t, [{ title: "plain", minutes: 10, author: "Bob Skipper" }]);
    expect((await deck(t))[0].reason).toBe("Fits your 10-minute window");
    await setProfile(t, OWNER, {
      authors: [{ key: "bob skipper", affinity: -0.9, n: 6 }],
    });
    expect((await deck(t))[0].reason).toBe("Fits your 10-minute window");
  });

  it("never lets taste lift an article past one three minutes closer", async () => {
    const t = await ownerTest(modules);
    await library(t, [
      { title: "right length", minutes: 10, author: "Zed" },
      { title: "adored but short", minutes: 7, author: "Ada Lovelace" },
    ]);
    await setProfile(t, OWNER, {
      authors: [{ key: "ada lovelace", affinity: 1, n: 50 }],
      feeds: [],
    });
    expect((await deck(t)).map((p) => p.title)).toEqual([
      "right length",
      "adored but short",
    ]);
  });

  it("never lifts or sinks an article that does not fit the window", async () => {
    const t = await ownerTest(modules);
    await library(t, [
      { title: "too long, adored", minutes: 12, author: "Ada Lovelace" },
      { title: "too long, plain", minutes: 12, author: "Zed" },
    ]);
    await setProfile(t, OWNER, {
      authors: [{ key: "ada lovelace", affinity: 1, n: 50 }],
    });
    const picks = await deck(t);
    // The same score, so the id decides; and no taste reason is given
    expect(picks.map((p) => p.title)).toEqual([
      "too long, adored",
      "too long, plain",
    ]);
    expect(picks.every((p) => !p.reason.startsWith("You "))).toBe(true);
  });

  it("bounds the taste term by TASTE_MAX points", async () => {
    // A minute of fit is two points, so full taste is worth TASTE_MAX / 2 minutes
    expect(TASTE_MAX / 2).toBe(1);
    const t = await ownerTest(modules);
    await library(t, [
      { title: "nine", minutes: 9, author: "Zed" },
      { title: "ten", minutes: 10, author: "Zed" },
      { title: "eight, adored", minutes: 8, author: "Ada Lovelace" },
    ]);
    await setProfile(t, OWNER, {
      authors: [{ key: "ada lovelace", affinity: 1, n: 50 }],
    });
    // Full taste makes up one minute and no more: eight, adored, only ties
    // with nine (the id decides), and cannot catch ten
    expect((await deck(t)).map((p) => p.title)).toEqual([
      "ten",
      "nine",
      "eight, adored",
    ]);
  });

  it("applies each reader's own profile and no one else's", async () => {
    const { t, owner, reader, readerLibraryId } =
      await secondReaderTest(modules);
    const rows: ArticleSeed[] = [
      { title: "by a stranger", minutes: 10, author: "Zed" },
      { title: "by Ada", minutes: 10, author: "Ada Lovelace" },
    ];
    await t.run(async (ctx) => {
      for (const userId of [OWNER, readerLibraryId])
        for (const [i, a] of rows.entries()) await article(ctx, userId, a, i);
      await ctx.db.insert("tasteProfiles", {
        userId: readerLibraryId,
        feeds: [],
        authors: [{ key: "ada lovelace", affinity: 1, n: 50 }],
        tags: [],
        evidence: 10,
        computedAt: Date.now(),
      });
    });
    const top = async (client: typeof owner) =>
      (
        await client.query(api.suggestions.forWindow, { requestedMinutes: 10 })
      )[0];
    expect((await top(owner)).title).toBe("by a stranger");
    const theirs = await top(reader);
    expect(theirs.title).toBe("by Ada");
    expect(theirs.reason).toBe(
      "You usually finish pieces like this from this writer.",
    );
  });
});

describe("paged picks", () => {
  it("stay in index order whatever the taste profile, so paging cannot shift", async () => {
    const t = await ownerTest(modules);
    const rows: ArticleSeed[] = [];
    for (let i = 0; i < 12; i++)
      rows.push({
        title: `piece ${i}`,
        minutes: 10 - (i % 3),
        author: i % 4 === 0 ? "Ada Lovelace" : "Zed",
      });
    await library(t, rows);
    const all = async (numItems: number) => {
      const seen: { title: string; reason: string }[] = [];
      let cursor: string | null = null;
      for (let i = 0; i < 40; i++) {
        const page: PaginationResult<{ title: string; reason: string }> =
          await t.query(api.suggestions.moreForWindow, {
            requestedMinutes: 10,
            paginationOpts: { numItems, cursor },
          });
        seen.push(...page.page);
        if (page.isDone) break;
        cursor = page.continueCursor;
      }
      return seen;
    };
    const before = await all(4);
    await setProfile(t, OWNER, {
      authors: [{ key: "ada lovelace", affinity: 0.9, n: 9 }],
    });
    const after = await all(4);
    expect(after.map((p) => p.title)).toEqual(before.map((p) => p.title));
    // Nor does the page size change the order
    expect((await all(5)).map((p) => p.title)).toEqual(
      before.map((p) => p.title),
    );
    expect(after.every((p) => !p.reason.startsWith("You "))).toBe(true);
    expect(new Set(after.map((p) => p.title)).size).toBe(after.length);
  });
});
