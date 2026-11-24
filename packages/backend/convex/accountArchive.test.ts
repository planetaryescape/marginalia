import { makeFunctionReference } from "convex/server";
import { afterEach, expect, it, vi } from "vitest";
import { archiveFixture } from "../test/accountArchive";
import { ownerTest, readerTest } from "../test/owner";
import { archiveItem, parseAccountArchive } from "./lib/accountArchive";

const modules = import.meta.glob("./**/*.ts");
const origin = "https://destination.example.com";
const inspect = makeFunctionReference<
  "query",
  { expectedOrigin: string; payload: string }
>("accountArchive:inspect");
const importOne = makeFunctionReference<
  "mutation",
  { expectedOrigin: string; payload: string }
>("accountArchive:importOne");
const importPreferences = makeFunctionReference<
  "mutation",
  { expectedOrigin: string; payload: string }
>("accountArchive:importPreferences");
afterEach(() => vi.unstubAllEnvs());

function item() {
  const parsed = parseAccountArchive(archiveFixture(), "a".repeat(64));
  if (!parsed.ok) throw new Error("Fixture rejected");
  return parsed.items[0];
}
function input(value = item()) {
  return { expectedOrigin: origin, payload: JSON.stringify(value) };
}

it("dry runs without writes, then imports owned content and resumes atomically", async () => {
  vi.stubEnv("SITE_URL", origin);
  const t = await ownerTest(modules);
  expect(await t.query(inspect, input())).toMatchObject({
    status: "create",
    highlightsToCreate: 1,
  });
  expect(await t.run((ctx) => ctx.db.query("articles").collect())).toHaveLength(
    0,
  );
  const result = await t.mutation(importOne, input());
  expect(result.status).toBe("create");
  await t.run(async (ctx) => {
    const article = await ctx.db.query("articles").unique();
    expect(article).toMatchObject({
      userId: "default_user",
      content: item().article.content,
    });
    expect(article?._id).not.toBe("source-article");
    expect(await ctx.db.query("articleMetadata").unique()).toMatchObject({
      articleId: article?._id,
    });
    expect(await ctx.db.query("highlights").unique()).toMatchObject({
      articleId: article?._id,
      userId: "default_user",
    });
    expect(await ctx.db.query("articleInteractions").unique()).toMatchObject({
      articleId: article?._id,
      createdAt: 2000,
    });
    expect(await ctx.db.query("readingActivity").unique()).toMatchObject({
      articleId: article?._id,
      maxScrollPercent: 40,
      activeTimeMs: 0,
    });
    expect(await ctx.db.query("readingResumes").unique()).toMatchObject({
      articleId: article?._id,
      paragraphIndex: 2,
    });
    const scheduled = await ctx.db.system
      .query("_scheduled_functions")
      .collect();
    expect(
      scheduled.every((job) => job.name === "readingQueue:initialize"),
    ).toBe(true);
  });
  expect(await t.mutation(importOne, input())).toMatchObject({
    status: "replayed",
    highlightsToCreate: 0,
  });
  await t.run(async (ctx) => {
    expect(await ctx.db.query("articles").collect()).toHaveLength(1);
    expect(await ctx.db.query("highlights").collect()).toHaveLength(1);
    expect(await ctx.db.query("articleInteractions").collect()).toHaveLength(1);
    expect(await ctx.db.query("readingActivity").collect()).toHaveLength(1);
  });
});

it("preserves separate Reader documents that share a canonical URL", async () => {
  vi.stubEnv("SITE_URL", origin);
  const t = await ownerTest(modules);
  await t.mutation(importOne, input());
  const next = item();
  next.article._id = "different-source-article";
  next.article.guid = "reader:document-2";
  next.article.readerDocumentId = "document-2";
  next.article.content = "A different revision of the article.";
  next.highlights = [];
  next.interactions = [];
  await t.mutation(importOne, input(next));
  expect(await t.run((ctx) => ctx.db.query("articles").collect())).toHaveLength(
    2,
  );
});

it("refuses a conflicting existing body without modifying the article or adding marks", async () => {
  vi.stubEnv("SITE_URL", origin);
  const t = await ownerTest(modules);
  const { _id: _sourceId, userId: _userId, ...fields } = item().article;
  await t.run((ctx) =>
    ctx.db.insert("articles", {
      ...fields,
      userId: "default_user",
      content: "Destination content must remain",
    }),
  );
  expect(await t.query(inspect, input())).toMatchObject({ status: "conflict" });
  await expect(t.mutation(importOne, input())).rejects.toThrow("conflicts");
  expect(
    await t.run((ctx) => ctx.db.query("highlights").collect()),
  ).toHaveLength(0);
});

it("merges marks into an identical existing owner article without replacing its metadata", async () => {
  vi.stubEnv("SITE_URL", origin);
  const t = await ownerTest(modules);
  const { _id: _sourceId, userId: _userId, ...fields } = item().article;
  const id = await t.run((ctx) =>
    ctx.db.insert("articles", {
      ...fields,
      userId: "default_user",
      title: "My existing title",
      finishedAt: 5000,
    }),
  );
  expect(await t.mutation(importOne, input())).toMatchObject({
    status: "merge",
    articleId: id,
    highlightsToCreate: 1,
  });
  expect(await t.run((ctx) => ctx.db.get("articles", id))).toMatchObject({
    title: "My existing title",
    finishedAt: 5000,
  });
  expect(await t.run((ctx) => ctx.db.query("articles").collect())).toHaveLength(
    1,
  );
});

it("does not match or modify another reader's identical content", async () => {
  vi.stubEnv("SITE_URL", origin);
  const t = await ownerTest(modules);
  const { _id: _sourceId, userId: _userId, ...fields } = item().article;
  const foreignId = await t.run((ctx) =>
    ctx.db.insert("articles", { ...fields, userId: "another-library" }),
  );
  const before = await t.run((ctx) => ctx.db.get("articles", foreignId));
  expect(await t.mutation(importOne, input())).toMatchObject({
    status: "create",
  });
  expect(await t.run((ctx) => ctx.db.get("articles", foreignId))).toEqual(
    before,
  );
});

it("rejects wrong deployments, unclaimed targets and cross-library records", async () => {
  vi.stubEnv("SITE_URL", "https://wrong.example.com");
  const t = await ownerTest(modules);
  await expect(t.mutation(importOne, input())).rejects.toThrow("origin");
  vi.stubEnv("SITE_URL", origin);
  const empty = readerTest(modules);
  await expect(empty.mutation(importOne, input())).rejects.toThrow("owner");
  const invalid = archiveItem.parse(item());
  invalid.highlights[0].userId = "other-reader";
  await expect(t.mutation(importOne, input(invalid))).rejects.toThrow(
    "unrelated",
  );
});

it("copies only unset preferences and never replaces a destination choice or integration state", async () => {
  vi.stubEnv("SITE_URL", origin);
  const t = await ownerTest(modules);
  await t.run((ctx) =>
    ctx.db.insert("userSettings", {
      userId: "default_user",
      speechVoice: "destination-voice",
      readwiseSyncedAt: 123,
      updatedAt: 1,
    }),
  );
  const args = {
    expectedOrigin: origin,
    payload: JSON.stringify({
      speechVoice: "source-voice",
      bibleEnabled: false,
      bibleTranslation: "web",
      readingScope: "articles",
    }),
  };
  expect(await t.mutation(importPreferences, args)).toMatchObject({
    copied: ["bibleEnabled", "bibleTranslation", "readingScope"],
    preserved: ["speechVoice"],
  });
  expect(
    await t.run((ctx) => ctx.db.query("userSettings").unique()),
  ).toMatchObject({
    speechVoice: "destination-voice",
    readwiseSyncedAt: 123,
    bibleEnabled: false,
    bibleTranslation: "web",
    readingScope: "articles",
  });
  expect(await t.mutation(importPreferences, args)).toMatchObject({
    copied: [],
  });
});
