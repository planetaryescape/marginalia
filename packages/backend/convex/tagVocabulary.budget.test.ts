/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, it, onTestFailed } from "vitest";
import { internal } from "./_generated/api";
import { metadataTriggers } from "./lib/metadataTriggers";
import { purgeTagVocabulary } from "./lib/tagVocabulary";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const userId = "default_user";
const names = ["alpha", "beta", "gamma"];

async function fixture(ready: boolean) {
  const t = convexTest({ schema, modules, transactionLimits: true });
  const articleId = await t.run((ctx) =>
    ctx.db.insert("articles", {
      userId,
      guid: "large-tags",
      url: "https://example.com/large-tags",
      title: "Fixture",
      extractionStatus: "extracted",
      annotationStatus: "annotated",
      createdAt: 0,
    }),
  );
  for (let start = 0; start < 540; start += 20)
    await t.run(async (ctx) => {
      for (let i = start; i < start + 20; i++) {
        const name = names[i] ?? `topic ${i}`;
        await ctx.db.insert("tags", {
          userId,
          name,
          key: name,
          aliases: [`alias-${"x".repeat(15_500)}-${i}`],
          count: 0,
          status: "active",
          createdAt: i,
          embedding: Array.from({ length: 1536 }, () => 0.125),
        });
      }
    });
  if (ready) {
    let done = false;
    let maxReadBytes = 0;
    let maxWriteBytes = 0;
    for (let page = 0; page < 600 && !done; page++) {
      const measured = await t.run(async (ctx) => {
        const result = await ctx.runMutation(internal.tags.migrateVocabulary, {
          userId,
        });
        return { result, metrics: await ctx.meta.getTransactionMetrics() };
      });
      done = measured.result.done;
      maxReadBytes = Math.max(maxReadBytes, measured.metrics.bytesRead.used);
      maxWriteBytes = Math.max(
        maxWriteBytes,
        measured.metrics.bytesWritten.used,
      );
    }
    console.log(
      "B12 installed migration maxima",
      JSON.stringify({ maxReadBytes, maxWriteBytes }),
    );
    expect(done).toBe(true);
  }
  return { t, articleId };
}

async function measuredAssignment(
  f: Awaited<ReturnType<typeof fixture>>,
  phase: string,
) {
  return f.t.run(async (ctx) => {
    const links = await ctx.runMutation(internal.tags.assign, {
      userId,
      articleId: f.articleId,
      proposals: names.map((name) => ({ name })),
    });
    console.log(
      "B12 installed writer metrics",
      JSON.stringify({ phase, ...(await ctx.meta.getTransactionMetrics()) }),
    );
    return links;
  });
}

it("keeps a previously valid near-limit assignment valid with installed vocabulary maintenance", async () => {
  let phase = "baseline setup";
  onTestFailed(() => console.error("Tag writer budget phase:", phase));
  const registered = metadataTriggers.registered.tags;
  expect(registered?.length).toBeGreaterThan(0);
  const baseline = await fixture(false);
  try {
    // The canonical assignment algorithm is unchanged. Disable only the new
    // tag projection to measure the previously deployed writer's read budget.
    delete metadataTriggers.registered.tags;
    phase = "baseline assignment";
    expect(await measuredAssignment(baseline, phase)).toHaveLength(3);
    phase = "baseline unlink + relink";
    expect(await measuredAssignment(baseline, phase)).toHaveLength(3);
  } finally {
    metadataTriggers.registered.tags = registered;
  }
  phase = "ready metadata setup";
  const current = await fixture(true);
  phase = "maintained assignment";
  expect(await measuredAssignment(current, phase)).toHaveLength(3);
  phase = "maintained unlink + relink";
  expect(await measuredAssignment(current, phase)).toHaveLength(3);
  const tags = await current.t.run((ctx) => ctx.db.query("tags").collect());
  expect(
    tags
      .filter((tag) => tag.count === 1)
      .map((tag) => tag.name)
      .sort(),
  ).toEqual(names);
  expect(tags).toHaveLength(540);
  const state = await current.t.run((ctx) =>
    ctx.db.query("tagVocabularyState").unique(),
  );
  expect(state).toMatchObject({ ready: true, overflow: 0 });
  const expected = tags
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
    .slice(0, 150)
    .map(({ name, key, aliases }) => ({ name, key, aliases }));
  expect(await current.t.query(internal.tags.vocabulary, { userId })).toEqual(
    expected,
  );
  expect(
    await current.t.query(internal.tags.missingEmbeddings, { userId }),
  ).toEqual([]);
  await current.t.run(async (ctx) => {
    const prompt = await ctx.runQuery(internal.tags.vocabulary, { userId });
    console.log(
      "B12 installed prompt metrics",
      JSON.stringify({
        count: prompt.length,
        ...(await ctx.meta.getTransactionMetrics()),
      }),
    );
  });
  phase = "generic replace / delete / ownership transfer";
  await current.t.run(async (raw) => {
    const { db } = metadataTriggers.wrapDB(raw);
    const alpha = tags.find((tag) => tag.name === "alpha");
    const beta = tags.find((tag) => tag.name === "beta");
    const gamma = tags.find((tag) => tag.name === "gamma");
    if (!alpha || !beta || !gamma) throw new Error("Missing fixture tags");
    await db.insert("readers", {
      authId: "budget-other-reader",
      libraryId: "budget-other-library",
      status: "disabled",
      createdAt: 1,
    });
    await db.replace(alpha._id, {
      userId,
      key: "renamedalpha",
      name: "renamed alpha",
      aliases: alpha.aliases,
      count: alpha.count,
      status: alpha.status,
      createdAt: alpha.createdAt,
      embedding: alpha.embedding,
    });
    await db.delete(beta._id);
    await db.patch(gamma._id, { userId: "budget-other-library" });
    console.log(
      "B12 installed generic writer metrics",
      JSON.stringify(await raw.meta.getTransactionMetrics()),
    );
  });
  const nodes = await current.t.run((ctx) =>
    ctx.db.query("tagVocabulary").collect(),
  );
  const payloads = await current.t.run((ctx) =>
    ctx.db.query("tagVocabularyPayloads").collect(),
  );
  expect(nodes).toHaveLength(539);
  expect(payloads).toHaveLength(539);
  expect(nodes.filter((row) => row.userId === userId)).toHaveLength(538);
  expect(payloads.filter((row) => row.userId === userId)).toHaveLength(538);
  expect(
    await current.t.query(internal.tags.vocabulary, {
      userId: "budget-other-library",
    }),
  ).toEqual([
    {
      name: "gamma",
      key: "gamma",
      aliases: tags.find((tag) => tag.name === "gamma")?.aliases,
    },
  ]);
  const afterGeneric = await current.t.query(internal.tags.vocabulary, {
    userId,
  });
  expect(afterGeneric[0]).toMatchObject({
    name: "renamed alpha",
    key: "renamedalpha",
  });
  expect(
    afterGeneric.some((row) => row.key === "beta" || row.key === "gamma"),
  ).toBe(false);
  phase = "purge and late canonical write";
  await current.t.run(async (raw) => {
    const reader = await raw.db
      .query("readers")
      .withIndex("by_libraryId", (q) =>
        q.eq("libraryId", "budget-other-library"),
      )
      .unique();
    const gamma = tags.find((tag) => tag.name === "gamma");
    if (!reader || !gamma) throw new Error("Missing transferred fixture");
    await raw.db.patch(reader._id, { deletingAt: 1 });
    expect(await purgeTagVocabulary(raw, "budget-other-library")).toBe(1);
    const { db } = metadataTriggers.wrapDB(raw);
    await db.patch(gamma._id, { count: 2 });
    console.log(
      "B12 installed purge/late-write metrics",
      JSON.stringify(await raw.meta.getTransactionMetrics()),
    );
  });
  await current.t.run(async (ctx) => {
    expect(await purgeTagVocabulary(ctx, "budget-other-library")).toBe(1);
    expect(await purgeTagVocabulary(ctx, "budget-other-library")).toBe(0);
  });
  expect(
    await current.t.query(internal.tags.vocabulary, {
      userId: "budget-other-library",
    }),
  ).toEqual([]);
  expect(
    await current.t.run((ctx) =>
      ctx.db
        .query("tagVocabularyPayloads")
        .withIndex("by_userId", (q) => q.eq("userId", "budget-other-library"))
        .collect(),
    ),
  ).toEqual([]);
});
