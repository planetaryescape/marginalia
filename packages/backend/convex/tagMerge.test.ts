/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { drain } from "../test/drain";
import { secondReaderTest } from "../test/owner";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { findMergePairs, LINK_BATCH, MAX_SUGGESTIONS } from "./tagMerge";

const modules = import.meta.glob("./**/*.ts");
const OWNER = "default_user";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

/** A unit vector at this angle; the cosine of two is the cosine of the angle between. */
const at = (degrees: number) => [
  Math.cos((degrees * Math.PI) / 180),
  Math.sin((degrees * Math.PI) / 180),
  0,
];
// Angles whose cosines are about 0.95, 0.85 and 0.70
const CLOSE = 18;
const NEAR = 32;
const FAR = 46;

let seq = 0;
const tag = (
  ctx: MutationCtx,
  userId: string,
  name: string,
  more: Partial<Doc<"tags">> = {},
) =>
  ctx.db.insert("tags", {
    userId,
    name,
    key: name.replace(/\s+/g, ""),
    status: "active",
    count: 0,
    aliases: [],
    createdAt: Date.now() + seq++,
    ...more,
  });

const suggestions = (
  t: { run: (f: (ctx: MutationCtx) => Promise<unknown>) => Promise<unknown> },
  userId: string,
) =>
  t.run((ctx) =>
    ctx.db
      .query("tagMergeSuggestions")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect(),
  ) as Promise<Doc<"tagMergeSuggestions">[]>;

describe("finding tags that look like one topic", () => {
  const doc = (name: string, more: Partial<Doc<"tags">> = {}) =>
    ({
      _id: name as Id<"tags">,
      userId: OWNER,
      name,
      key: name.replace(/\s+/g, ""),
      status: "active",
      count: 1,
      aliases: [],
      createdAt: 0,
      _creationTime: 0,
      ...more,
    }) as Doc<"tags">;

  it("treats names that normalise alike as the same topic outright", () => {
    const pairs = findMergePairs([
      doc("Machine learning", { key: "machinelearning" }),
      doc("ml", { key: "ml", aliases: ["machinelearning"] }),
    ]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toMatchObject({ strength: "strong", similarity: 1 });
  });

  it("separates a strong suggestion from a suggestion and from no suggestion", () => {
    const strong = findMergePairs([
      doc("a", { embedding: at(0) }),
      doc("b", { embedding: at(CLOSE) }),
    ]);
    expect(strong[0].strength).toBe("strong");
    const near = findMergePairs([
      doc("a", { embedding: at(0) }),
      doc("b", { embedding: at(NEAR) }),
    ]);
    expect(near[0].strength).toBe("suggested");
    expect(
      findMergePairs([
        doc("a", { embedding: at(0) }),
        doc("b", { embedding: at(FAR) }),
      ]),
    ).toEqual([]);
  });

  it("keeps the tag more articles carry", () => {
    const [pair] = findMergePairs([
      doc("few", { count: 2, embedding: at(0) }),
      doc("many", { count: 9, embedding: at(CLOSE) }),
    ]);
    expect(pair.into).toBe("many");
    expect(pair.from).toBe("few");
  });

  it("puts a tag in at most one pair, strongest first", () => {
    const pairs = findMergePairs([
      doc("a", { embedding: at(0), count: 5 }),
      doc("b", { embedding: at(10), count: 4 }),
      doc("c", { embedding: at(20), count: 3 }),
    ]);
    expect(pairs).toHaveLength(1);
  });

  it("cannot compare tags with no embedding", () => {
    expect(findMergePairs([doc("a"), doc("b")])).toEqual([]);
  });
});

describe("tag merge suggestions", () => {
  it("stores suggestions for active tags only, and a rerun adds nothing", async () => {
    const { t } = await secondReaderTest(modules);
    await t.run(async (ctx) => {
      await tag(ctx, OWNER, "llm", { embedding: at(0), count: 3 });
      await tag(ctx, OWNER, "language models", {
        embedding: at(CLOSE),
        count: 1,
      });
      await tag(ctx, OWNER, "hidden", {
        embedding: at(1),
        status: "candidate",
      });
      await tag(ctx, OWNER, "cooking", { embedding: at(90) });
    });
    expect(await t.mutation(internal.tagMerge.compute, { userId: OWNER })).toBe(
      1,
    );
    const [first] = await suggestions(t, OWNER);
    expect(first).toMatchObject({ strength: "strong" });
    await t.mutation(internal.tagMerge.compute, { userId: OWNER });
    const again = await suggestions(t, OWNER);
    expect(again).toHaveLength(1);
    expect(again[0]._id).toBe(first._id);
  });

  it("changes no tag and no link by itself", async () => {
    const { t } = await secondReaderTest(modules);
    const before = await t.run(async (ctx) => {
      await tag(ctx, OWNER, "llm", { embedding: at(0) });
      await tag(ctx, OWNER, "llms", { embedding: at(CLOSE) });
      return ctx.db.query("tags").collect();
    });
    await t.mutation(internal.tagMerge.compute, { userId: OWNER });
    expect(await t.run((ctx) => ctx.db.query("tags").collect())).toEqual(
      before,
    );
  });

  it("holds at most the strongest few", async () => {
    const { t } = await secondReaderTest(modules);
    await t.run(async (ctx) => {
      for (let i = 0; i < MAX_SUGGESTIONS + 5; i++) {
        // Pairs far apart from each other (around the circle), close within a pair
        await tag(ctx, OWNER, `topic ${i}`, {
          embedding: [Math.cos(i), Math.sin(i), i * 3],
        });
        await tag(ctx, OWNER, `topic ${i} again`, {
          embedding: [Math.cos(i), Math.sin(i), i * 3 + 0.01],
        });
      }
    });
    await t.mutation(internal.tagMerge.compute, { userId: OWNER });
    expect((await suggestions(t, OWNER)).length).toBeLessThanOrEqual(
      MAX_SUGGESTIONS,
    );
  });

  it("drops a suggestion once its tags no longer look alike", async () => {
    const { t } = await secondReaderTest(modules);
    const [a] = await t.run(async (ctx) => [
      await tag(ctx, OWNER, "language models", { embedding: at(0) }),
      await tag(ctx, OWNER, "llm", { embedding: at(CLOSE) }),
    ]);
    await t.mutation(internal.tagMerge.compute, { userId: OWNER });
    expect(await suggestions(t, OWNER)).toHaveLength(1);
    await t.run((ctx) => ctx.db.patch(a, { embedding: at(80) }));
    await t.mutation(internal.tagMerge.compute, { userId: OWNER });
    expect(await suggestions(t, OWNER)).toEqual([]);
  });

  it("lists names for the reader's room, and nobody else's", async () => {
    const { t, owner, reader, readerLibraryId } =
      await secondReaderTest(modules);
    await t.run(async (ctx) => {
      await tag(ctx, OWNER, "llm", { embedding: at(0), count: 3 });
      await tag(ctx, OWNER, "llms", { embedding: at(CLOSE), count: 1 });
    });
    await t.mutation(internal.tagMerge.compute, { userId: OWNER });
    expect(await owner.query(api.tagMerge.pending, {})).toEqual([
      expect.objectContaining({
        into: "llm",
        from: "llms",
        strong: true,
        merging: false,
      }),
    ]);
    expect(await reader.query(api.tagMerge.pending, {})).toEqual([]);
    expect(readerLibraryId).not.toBe(OWNER);
  });

  it("does nothing for a library being deleted", async () => {
    const { t, readerLibraryId } = await secondReaderTest(modules);
    await t.run(async (ctx) => {
      await tag(ctx, readerLibraryId, "llm", { embedding: at(0) });
      await tag(ctx, readerLibraryId, "llms", { embedding: at(CLOSE) });
      const row = await ctx.db
        .query("readers")
        .withIndex("by_libraryId", (q) => q.eq("libraryId", readerLibraryId))
        .first();
      if (row)
        await ctx.db.patch(row._id, {
          status: "disabled",
          deletingAt: Date.now(),
        });
    });
    expect(
      await t.mutation(internal.tagMerge.compute, { userId: readerLibraryId }),
    ).toBe(0);
    expect(await suggestions(t, readerLibraryId)).toEqual([]);
  });
});

describe("Keep both", () => {
  async function pair() {
    const fixture = await secondReaderTest(modules);
    const ids = await fixture.t.run(async (ctx) => ({
      llm: await tag(ctx, OWNER, "llm", { embedding: at(0), count: 3 }),
      llms: await tag(ctx, OWNER, "llms", { embedding: at(CLOSE), count: 1 }),
    }));
    await fixture.t.mutation(internal.tagMerge.compute, { userId: OWNER });
    return { ...fixture, ids };
  }

  it("is remembered: the pair is never suggested again, whatever the order", async () => {
    const { t, owner } = await pair();
    const [s] = await suggestions(t, OWNER);
    await owner.mutation(api.tagMerge.keepBoth, { suggestionId: s._id });
    expect(await suggestions(t, OWNER)).toEqual([]);
    for (let i = 0; i < 3; i++)
      await t.mutation(internal.tagMerge.compute, { userId: OWNER });
    expect(await suggestions(t, OWNER)).toEqual([]);
    const kept = await t.run((ctx) =>
      ctx.db.query("suggestionKeeps").collect(),
    );
    expect(kept).toHaveLength(1);
    expect(kept[0].until).toBeUndefined();
    // Both tags and all their links stay
    expect(await t.run((ctx) => ctx.db.query("tags").collect())).toHaveLength(
      2,
    );
  });

  it("still suggests other pairs", async () => {
    const { t, owner } = await pair();
    await t.run(async (ctx) => {
      await tag(ctx, OWNER, "cooking", { embedding: at(100) });
      await tag(ctx, OWNER, "cookery", { embedding: at(100 + CLOSE) });
    });
    await t.mutation(internal.tagMerge.compute, { userId: OWNER });
    const first = (await suggestions(t, OWNER)).find(
      (s) => s.strength === "strong" && s.similarity < 1,
    );
    expect(await suggestions(t, OWNER)).toHaveLength(2);
    if (first)
      await owner.mutation(api.tagMerge.keepBoth, { suggestionId: first._id });
    await t.mutation(internal.tagMerge.compute, { userId: OWNER });
    expect(await suggestions(t, OWNER)).toHaveLength(1);
  });

  it("cannot be pressed on another reader's suggestion", async () => {
    const { t, reader } = await pair();
    const [s] = await suggestions(t, OWNER);
    await reader.mutation(api.tagMerge.keepBoth, { suggestionId: s._id });
    expect(await suggestions(t, OWNER)).toHaveLength(1);
    expect(
      await t.run((ctx) => ctx.db.query("suggestionKeeps").collect()),
    ).toEqual([]);
  });
});

describe("accepting a merge", () => {
  const handlers = { "tagMerge:moveLinks": internal.tagMerge.moveLinks };

  async function manyLinks(links: number, both: number) {
    const fixture = await secondReaderTest(modules);
    const { t } = fixture;
    const ids = await t.run(async (ctx) => {
      // The kept tag is the one more articles carry
      const intoCount = links + 30;
      const into = await tag(ctx, OWNER, "llm", {
        embedding: at(0),
        count: intoCount,
        aliases: ["gpt"],
      });
      const from = await tag(ctx, OWNER, "llms", {
        embedding: at(CLOSE),
        count: links,
        aliases: ["largelanguagemodel"],
      });
      const articles: Id<"articles">[] = [];
      for (let i = 0; i < links; i++) {
        const article = await ctx.db.insert("articles", {
          userId: OWNER,
          guid: `g${i}`,
          url: `https://example.com/${i}`,
          title: `a${i}`,
          extractionStatus: "extracted",
          annotationStatus: "annotated",
          createdAt: Date.now(),
        });
        articles.push(article);
        await ctx.db.insert("articleTags", {
          userId: OWNER,
          articleId: article,
          tagId: from,
          createdAt: Date.now(),
        });
        // The first `both` articles carry both tags already
        if (i < both)
          await ctx.db.insert("articleTags", {
            userId: OWNER,
            articleId: article,
            tagId: into,
            createdAt: Date.now(),
          });
      }
      return { into, from, articles, intoCount };
    });
    await t.mutation(internal.tagMerge.compute, { userId: OWNER });
    return { ...fixture, ...ids };
  }

  it("moves every link in batches, drops duplicates, aliases the old name and removes the old tag", async () => {
    const links = LINK_BATCH * 2 + 20;
    const { t, owner, into, from, articles, intoCount } = await manyLinks(
      links,
      10,
    );
    const [s] = await suggestions(t, OWNER);
    expect(s).toMatchObject({ into, from });
    await owner.mutation(api.tagMerge.accept, { suggestionId: s._id });
    // Nothing moves in the pressing transaction itself
    expect(await t.run((ctx) => ctx.db.get(from))).not.toBeNull();
    expect((await owner.query(api.tagMerge.pending, {}))[0].merging).toBe(true);

    await drain(t, handlers);

    const batches = (
      await t.run((ctx) =>
        ctx.db.system.query("_scheduled_functions").take(500),
      )
    ).filter((j) => j.name === "tagMerge:moveLinks");
    // 120 links at 50 a batch: three batches, plus the one the press scheduled
    expect(batches.length).toBe(3);
    expect(await t.run((ctx) => ctx.db.get(from))).toBeNull();
    const kept = await t.run((ctx) => ctx.db.get(into));
    expect(kept?.count).toBe(intoCount + links - 10);
    expect(kept?.aliases.sort()).toEqual(["gpt", "largelanguagemodel", "llms"]);
    const linked = await t.run((ctx) =>
      ctx.db
        .query("articleTags")
        .withIndex("by_tag", (q) => q.eq("tagId", into))
        .collect(),
    );
    // Every article that had either tag has exactly one link to the kept tag
    expect(linked).toHaveLength(links);
    expect(new Set(linked.map((l) => l.articleId)).size).toBe(links);
    expect(linked.map((l) => l.articleId).sort()).toEqual([...articles].sort());
    expect(
      await t.run((ctx) =>
        ctx.db
          .query("articleTags")
          .withIndex("by_tag", (q) => q.eq("tagId", from))
          .collect(),
      ),
    ).toEqual([]);
    expect(await suggestions(t, OWNER)).toEqual([]);
  });

  it("makes a tag proposed under the old name land on the kept tag", async () => {
    const { t, owner, into } = await manyLinks(3, 0);
    const [s] = await suggestions(t, OWNER);
    await owner.mutation(api.tagMerge.accept, { suggestionId: s._id });
    await drain(t, handlers);
    const article = await t.run((ctx) =>
      ctx.db.insert("articles", {
        userId: OWNER,
        guid: "new",
        url: "https://example.com/new",
        title: "new",
        extractionStatus: "extracted",
        annotationStatus: "annotated",
        createdAt: Date.now(),
      }),
    );
    const assigned = await t.mutation(internal.tags.assign, {
      userId: OWNER,
      articleId: article,
      proposals: [{ name: "llms" }],
    });
    expect(assigned).toEqual([into]);
  });

  it("leaves another reader's tags and links alone", async () => {
    const { t, owner, readerLibraryId } = await manyLinks(4, 1);
    const theirs = await t.run(async (ctx) => {
      const a = await tag(ctx, readerLibraryId, "llm", { count: 2 });
      const b = await tag(ctx, readerLibraryId, "llms", { count: 2 });
      return { a, b };
    });
    const [s] = await suggestions(t, OWNER);
    await owner.mutation(api.tagMerge.accept, { suggestionId: s._id });
    await drain(t, handlers);
    expect((await t.run((ctx) => ctx.db.get(theirs.a)))?.count).toBe(2);
    expect((await t.run((ctx) => ctx.db.get(theirs.b)))?.count).toBe(2);
  });

  it("cannot be started by another reader", async () => {
    const { t, reader } = await manyLinks(2, 0);
    const [s] = await suggestions(t, OWNER);
    await reader.mutation(api.tagMerge.accept, { suggestionId: s._id });
    expect((await suggestions(t, OWNER))[0].merging).toBeUndefined();
    const jobs = (
      await t.run((ctx) =>
        ctx.db.system.query("_scheduled_functions").take(500),
      )
    ).filter((j) => j.name === "tagMerge:moveLinks");
    expect(jobs).toEqual([]);
  });

  it("stops quietly if the tags changed under it", async () => {
    const { t, owner, from } = await manyLinks(2, 0);
    const [s] = await suggestions(t, OWNER);
    await owner.mutation(api.tagMerge.accept, { suggestionId: s._id });
    await t.run((ctx) => ctx.db.delete(from));
    await drain(t, handlers);
    expect(await suggestions(t, OWNER)).toEqual([]);
  });
});
