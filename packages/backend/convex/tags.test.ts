/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { finishArticleRemoval } from "../test/feedRemoval";
import {
  runScheduled,
  saveTestCredential,
  secondReaderTest,
  TEST_ENCRYPTION_KEY,
} from "../test/owner";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { deleteArticle } from "./lib/feedRemoval";
import { metadataTriggers } from "./lib/metadataTriggers";

const modules = import.meta.glob("./**/*.ts");
const OWNER = "default_user";

beforeEach(() => {
  vi.stubEnv("PROVIDER_KEYS_ENCRYPTION_KEY", TEST_ENCRYPTION_KEY);
  vi.stubEnv("OPENROUTER_API_KEY", "");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

/** A unit vector whose cosine to [1, 0] is `similarity`. */
const similarTo = (similarity: number) => [
  similarity,
  Math.sqrt(1 - similarity * similarity),
];

function addArticle(ctx: MutationCtx, userId: string, guid: string) {
  return ctx.db.insert("articles", {
    userId,
    guid,
    url: `https://example.com/${guid}`,
    title: `Article ${guid}`,
    extractionStatus: "extracted",
    annotationStatus: "annotated",
    createdAt: Date.now(),
  });
}

function addTag(
  ctx: MutationCtx,
  userId: string,
  key: string,
  fields: Partial<{
    status: "candidate" | "active";
    count: number;
    aliases: string[];
    embedding: number[];
  }> = {},
) {
  return metadataTriggers.wrapDB(ctx).db.insert("tags", {
    userId,
    name: key,
    key,
    status: fields.status ?? "active",
    count: fields.count ?? 0,
    aliases: fields.aliases ?? [],
    embedding: fields.embedding,
    createdAt: Date.now(),
  });
}

async function setup() {
  const fixture = await secondReaderTest(modules);
  await fixture.t.mutation(internal.tags.migrateVocabulary, { userId: OWNER });
  const articleId = await fixture.t.run((ctx) => addArticle(ctx, OWNER, "one"));
  return { ...fixture, articleId };
}

type Fixture = Awaited<ReturnType<typeof setup>>;

const assign = (
  { t }: Pick<Fixture, "t">,
  articleId: Id<"articles">,
  proposals: {
    name: string;
    description?: string;
    embedding?: number[];
  }[],
  userId = OWNER,
) => t.mutation(internal.tags.assign, { userId, articleId, proposals });

const allTags = ({ t }: Pick<Fixture, "t">) =>
  t.run((ctx) => ctx.db.query("tags").collect());
const linksOf = ({ t }: Pick<Fixture, "t">, articleId: Id<"articles">) =>
  t.run((ctx) =>
    ctx.db
      .query("articleTags")
      .withIndex("by_article", (q) => q.eq("articleId", articleId))
      .collect(),
  );

describe("tags.assign", () => {
  it("links an exact match and counts the article", async () => {
    const f = await setup();
    const tagId = await f.t.run((ctx) => addTag(ctx, OWNER, "hiring"));
    await assign(f, f.articleId, [{ name: "Hiring" }]);
    expect(await f.t.run((ctx) => ctx.db.get(tagId))).toMatchObject({
      count: 1,
      status: "active",
    });
    expect(await linksOf(f, f.articleId)).toHaveLength(1);
  });

  it("matches an alias, whatever the spelling", async () => {
    const f = await setup();
    const tagId = await f.t.run((ctx) =>
      addTag(ctx, OWNER, "hiring", { aliases: ["recruiting"] }),
    );
    await assign(f, f.articleId, [{ name: "#Recruiting" }]);
    expect((await linksOf(f, f.articleId))[0].tagId).toBe(tagId);
    expect(await allTags(f)).toHaveLength(1);
  });

  it("merges at or above 0.90 and records the new name as an alias", async () => {
    const f = await setup();
    const tagId = await f.t.run((ctx) =>
      addTag(ctx, OWNER, "hiring", { embedding: [1, 0] }),
    );
    await assign(f, f.articleId, [
      { name: "interviewing", embedding: similarTo(0.92) },
    ]);
    expect(await allTags(f)).toHaveLength(1);
    expect(await f.t.run((ctx) => ctx.db.get(tagId))).toMatchObject({
      aliases: ["interviewing"],
      count: 1,
    });
  });

  it("makes a candidate between 0.80 and 0.90 and also links the nearest tag", async () => {
    const f = await setup();
    const nearest = await f.t.run((ctx) =>
      addTag(ctx, OWNER, "hiring", { embedding: [1, 0] }),
    );
    await assign(f, f.articleId, [
      { name: "talent scouting", embedding: similarTo(0.85) },
    ]);
    const tags = await allTags(f);
    const candidate = tags.find((tag) => tag.key === "talentscouting");
    expect(candidate).toMatchObject({
      status: "candidate",
      count: 1,
      nearestTagId: nearest,
    });
    const linked = (await linksOf(f, f.articleId)).map((l) => l.tagId);
    expect(new Set(linked)).toEqual(new Set([nearest, candidate?._id]));
    // Only the active tag is visible meanwhile
    expect(
      await f.owner.query(api.tags.forArticle, { articleId: f.articleId }),
    ).toMatchObject([{ _id: nearest }]);
  });

  it("makes a plain new candidate below 0.80, linked to nothing else", async () => {
    const f = await setup();
    await f.t.run((ctx) => addTag(ctx, OWNER, "hiring", { embedding: [1, 0] }));
    await assign(f, f.articleId, [
      { name: "gardening", embedding: similarTo(0.5) },
    ]);
    const links = await linksOf(f, f.articleId);
    expect(links).toHaveLength(1);
    const gardening = (await allTags(f)).find((tag) => tag.key === "gardening");
    expect(gardening).toMatchObject({ status: "candidate", count: 1 });
    expect(gardening?.nearestTagId).toBeUndefined();
  });

  it("promotes a candidate after it recurs on three articles", async () => {
    const f = await setup();
    const more = await f.t.run(async (ctx) => [
      await addArticle(ctx, OWNER, "two"),
      await addArticle(ctx, OWNER, "three"),
    ]);
    const embedding = [0, 1];
    const [a, b, c] = [f.articleId, ...more];
    await assign(f, a, [{ name: "gardening", embedding }]);
    await assign(f, b, [{ name: "gardening" }]);
    const statusAfter = async () => (await allTags(f))[0].status;
    expect(await statusAfter()).toBe("candidate");
    expect(await f.owner.query(api.tags.forArticle, { articleId: b })).toEqual(
      [],
    );
    await assign(f, c, [{ name: "gardening" }]);
    expect(await statusAfter()).toBe("active");
    expect(await allTags(f)).toHaveLength(1);
    expect(
      await f.t.query(internal.tags.vocabulary, { userId: OWNER }),
    ).toEqual([{ name: "gardening", key: "gardening", aliases: [] }]);
    expect(
      await f.owner.query(api.tags.forArticle, { articleId: c }),
    ).toMatchObject([{ name: "gardening" }]);
  });

  it("adds nothing it cannot compare, and an article may end up with no tags", async () => {
    const f = await setup();
    await f.t.run((ctx) => addTag(ctx, OWNER, "hiring", { embedding: [1, 0] }));
    // No embedding (the library has no key) and no known name
    await assign(f, f.articleId, [{ name: "gardening" }]);
    expect(await allTags(f)).toHaveLength(1);
    expect(await linksOf(f, f.articleId)).toEqual([]);
    expect(
      await f.owner.query(api.tags.forArticle, { articleId: f.articleId }),
    ).toEqual([]);
    // An article with an empty list, or a name with nothing left after cleaning
    await assign(f, f.articleId, [{ name: "  #/ " }]);
    expect(await linksOf(f, f.articleId)).toEqual([]);
  });

  it("starts an empty vocabulary with a candidate", async () => {
    const f = await setup();
    await assign(f, f.articleId, [{ name: "gardening", embedding: [1, 0] }]);
    expect(await allTags(f)).toHaveLength(1);
  });

  it("replaces an article's tags and keeps counts true when it runs twice", async () => {
    const f = await setup();
    const tagId = await f.t.run((ctx) => addTag(ctx, OWNER, "hiring"));
    const other = await f.t.run((ctx) => addTag(ctx, OWNER, "market"));
    await assign(f, f.articleId, [{ name: "hiring" }]);
    await assign(f, f.articleId, [{ name: "hiring" }]);
    expect((await f.t.run((ctx) => ctx.db.get(tagId)))?.count).toBe(1);
    await assign(f, f.articleId, [{ name: "markets" }]);
    expect((await f.t.run((ctx) => ctx.db.get(tagId)))?.count).toBe(0);
    expect((await f.t.run((ctx) => ctx.db.get(other)))?.count).toBe(1);
    expect(await linksOf(f, f.articleId)).toHaveLength(1);
  });

  it("keeps the nearest visible tag when the same assignment is repeated", async () => {
    const f = await setup();
    const nearest = await f.t.run((ctx) =>
      addTag(ctx, OWNER, "hiring", { embedding: [1, 0] }),
    );
    const proposal = [{ name: "talent scouting", embedding: similarTo(0.85) }];
    for (let i = 0; i < 3; i++) {
      await assign(f, f.articleId, proposal);
      const linked = (await linksOf(f, f.articleId)).map((l) => l.tagId);
      expect(linked).toHaveLength(2);
      expect(linked).toContain(nearest);
      expect(
        await f.owner.query(api.tags.forArticle, { articleId: f.articleId }),
      ).toMatchObject([{ _id: nearest }]);
    }
    // Counts are per article, not per call
    expect(
      (await allTags(f)).map((tag) => [tag.key, tag.count]).sort(),
    ).toEqual([
      ["hiring", 1],
      ["talentscouting", 1],
    ]);
  });

  it("gives an article at most three tags, once each", async () => {
    const f = await setup();
    await f.t.run(async (ctx) => {
      for (const key of ["a1", "b1", "c1", "d1"]) await addTag(ctx, OWNER, key);
    });
    await assign(f, f.articleId, [
      { name: "a1" },
      { name: "#A1" },
      { name: "b1" },
      { name: "c1" },
      { name: "d1" },
    ]);
    expect(await linksOf(f, f.articleId)).toHaveLength(3);
  });

  it("treats names like constructor as ordinary tags", async () => {
    const f = await setup();
    await assign(f, f.articleId, [
      { name: "constructor", embedding: [1, 0] },
      { name: "__proto__", embedding: [0, 1] },
    ]);
    const keys = (await allTags(f)).map((tag) => tag.key).sort();
    expect(keys).toEqual(["constructor", "proto"]);
    await assign(f, f.articleId, [{ name: "Constructor" }]);
    expect(await allTags(f)).toHaveLength(2);
  });

  it("keeps counts true when two imports propose the same new tag at once", async () => {
    const f = await setup();
    const second = await f.t.run((ctx) => addArticle(ctx, OWNER, "two"));
    await Promise.all([
      assign(f, f.articleId, [{ name: "gardening", embedding: [1, 0] }]),
      assign(f, second, [{ name: "gardening", embedding: [1, 0] }]),
    ]);
    const tags = await allTags(f);
    expect(tags).toHaveLength(1);
    expect(tags[0].count).toBe(2);
  });

  it("never matches or links across libraries", async () => {
    const f = await setup();
    const theirs = await f.t.run((ctx) =>
      addArticle(ctx, f.readerLibraryId, "theirs"),
    );
    await f.t.run((ctx) => addTag(ctx, OWNER, "hiring"));
    // The reader's article cannot be tagged on behalf of the owner, or the reverse
    await expect(
      assign(f, theirs, [{ name: "hiring" }], OWNER),
    ).rejects.toThrow("Article not found");
    // The same name in another library is a separate tag
    await assign(
      f,
      theirs,
      [{ name: "hiring", embedding: [1, 0] }],
      f.readerLibraryId,
    );
    const tags = await allTags(f);
    expect(tags).toHaveLength(2);
    expect(new Set(tags.map((tag) => tag.userId))).toEqual(
      new Set([OWNER, f.readerLibraryId]),
    );
    // And the owner's session cannot read the reader's chips
    expect(
      await f.owner.query(api.tags.forArticle, { articleId: theirs }),
    ).toEqual([]);
  });
});

describe("removing an article", () => {
  it("takes its tag links and counts with it", async () => {
    const f = await setup();
    const tagId = await f.t.run((ctx) => addTag(ctx, OWNER, "hiring"));
    await assign(f, f.articleId, [{ name: "hiring" }]);
    await f.t.run(async (ctx) => {
      const article = await ctx.db.get(f.articleId);
      if (article) await deleteArticle(ctx, article);
    });
    await finishArticleRemoval(f.t, f.articleId);
    expect((await f.t.run((ctx) => ctx.db.get(tagId)))?.count).toBe(0);
    expect(
      await f.t.run((ctx) => ctx.db.query("articleTags").collect()),
    ).toEqual([]);
  });
});

describe("tags.vocabulary", () => {
  it("lists only this library's active tags, most used first, with no dependence on storage order", async () => {
    const f = await setup();
    await f.t.run(async (ctx) => {
      await addTag(ctx, OWNER, "zeta", { count: 1 });
      await addTag(ctx, OWNER, "alpha", { count: 1 });
      await addTag(ctx, OWNER, "popular", { count: 9 });
      await addTag(ctx, OWNER, "hidden", { status: "candidate", count: 2 });
      await addTag(ctx, f.readerLibraryId, "theirs", { count: 50 });
    });
    const vocabulary = await f.t.query(internal.tags.vocabulary, {
      userId: OWNER,
    });
    expect(vocabulary.map((tag) => tag.name)).toEqual([
      "popular",
      "alpha",
      "zeta",
    ]);
  });
});

describe("tags.seedFromVault", () => {
  const chunk = (userId: string, filePath: string, tags: string[], i = 0) => ({
    userId,
    filePath,
    fileName: filePath,
    chunkIndex: i,
    content: "text",
    tags,
    embedding: Array.from({ length: 1536 }, () => 0.1),
    fileHash: filePath,
    indexedAt: 1,
  });

  it("seeds normalised topic tags, drops vault structure, and can be run again", async () => {
    vi.useFakeTimers();
    const f = await setup();
    await f.t.run(async (ctx) => {
      await ctx.db.insert(
        "noteChunks",
        chunk(OWNER, "a.md", [
          "#Knowledge-Management",
          "areas/knowledgemanagement",
          "resources/LLMs",
          "llm",
          "projects",
          "daily",
          "#",
          "constructor",
        ]),
      );
      await ctx.db.insert(
        "noteChunks",
        chunk(f.readerLibraryId, "b.md", ["theirs-only"]),
      );
      await ctx.db.insert("noteChunks", chunk(OWNER, "c.md", []));
    });
    await f.t.mutation(internal.tags.seedFromVault, { userId: OWNER });
    await runScheduled(f.t);
    const keys = (await allTags(f)).map((tag) => tag.key).sort();
    expect(keys).toEqual(["constructor", "knowledgemanagement", "llm"]);
    expect((await allTags(f)).every((tag) => tag.status === "active")).toBe(
      true,
    );
    expect((await allTags(f)).every((tag) => tag.count === 0)).toBe(true);

    // Again: nothing added or duplicated
    await f.t.mutation(internal.tags.seedFromVault, { userId: OWNER });
    await runScheduled(f.t);
    expect(await allTags(f)).toHaveLength(3);
  });

  it("pages through a large vault", async () => {
    vi.useFakeTimers();
    const f = await setup();
    await f.t.run(async (ctx) => {
      for (let i = 0; i < 120; i++)
        await ctx.db.insert(
          "noteChunks",
          chunk(OWNER, `n${i}.md`, [`topic-${i % 60}`], i),
        );
    });
    await f.t.mutation(internal.tags.seedFromVault, { userId: OWNER });
    await runScheduled(f.t);
    expect(await allTags(f)).toHaveLength(60);
  });

  it("embeds the seeded names once the library has an embedding key", async () => {
    vi.useFakeTimers();
    const f = await setup();
    await saveTestCredential(
      f.t,
      OWNER,
      "openrouter",
      "sk-or-owner-fixture-0007",
    );
    const batches: string[][] = [];
    vi.stubGlobal(
      "fetch",
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        const request = JSON.parse(String(init?.body));
        batches.push(request.input);
        return Response.json({
          data: (request.input as string[]).map((_, index) => ({
            index,
            embedding: Array.from({ length: 1536 }, () => 0.2),
          })),
        });
      },
    );
    await f.t.run((ctx) =>
      ctx.db.insert("noteChunks", chunk(OWNER, "a.md", ["hiring", "markets"])),
    );
    await f.t.mutation(internal.tags.seedFromVault, { userId: OWNER });
    await runScheduled(f.t);
    expect(
      (await allTags(f)).every((tag) => tag.embedding?.length === 1536),
    ).toBe(true);
    expect(batches.flat().sort()).toEqual(["hiring", "markets"]);
  });

  it("leaves the tags unembedded, without failing, when there is no key", async () => {
    vi.useFakeTimers();
    const f = await setup();
    await f.t.run((ctx) =>
      ctx.db.insert("noteChunks", chunk(OWNER, "a.md", ["hiring"])),
    );
    await f.t.mutation(internal.tags.seedFromVault, { userId: OWNER });
    await runScheduled(f.t);
    expect((await allTags(f))[0].embedding).toBeUndefined();
  });
});
