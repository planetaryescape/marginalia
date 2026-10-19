/// <reference types="vite/client" />
import { appendFileSync } from "node:fs";
import { convexTest } from "convex-test";
import { expect, it, onTestFailed } from "vitest";
import { internal } from "./_generated/api";
import { metadataTriggers } from "./lib/metadataTriggers";
import {
  aliasState,
  migrateTagAliases,
  verifyAndActivateTagAliases,
} from "./lib/tagAliases";
import { purgeTagVocabulary } from "./lib/tagVocabulary";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const userId = "default_user";
const names = ["alpha", "beta", "gamma"];
function evidence(label: string, value: string) {
  const line = `${label} ${value}`;
  console.log(line);
  if (process.env.TAG_ASSIGNMENT_EVIDENCE)
    appendFileSync(process.env.TAG_ASSIGNMENT_EVIDENCE, `${line}\n`);
}

async function fixture(
  ready: boolean,
  maxReadBytes?: number,
  shortAliases = false,
) {
  const t = convexTest({
    schema,
    modules,
    transactionLimits: maxReadBytes ? { bytesRead: maxReadBytes } : true,
  });
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
          aliases: [
            `alias-${"x".repeat(15_500)}-${i}`,
            ...(shortAliases && i < 3 ? [`known${i}`] : []),
          ],
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
    evidence(
      "B12 installed migration maxima",
      JSON.stringify({ maxReadBytes, maxWriteBytes }),
    );
    expect(done).toBe(true);
  }
  if (shortAliases) {
    let done = false;
    for (let page = 0; page < 600 && !done; page++)
      done = (
        await t.run(async (ctx) => {
          const result = await migrateTagAliases(ctx, userId);
          const metrics = await ctx.meta.getTransactionMetrics();
          expect(metrics.bytesRead.used).toBeLessThan(1_000_000);
          return result;
        })
      ).done;
    expect(done).toBe(true);
    // Physical stress fixture, not the production activation endpoint: validate
    // all 540 sources one bounded transaction at a time under the same 1MB cap.
    // No concurrent writers run during fixture construction. Production's two
    // retained small libraries use verifyAndActivateTagAliases in ONE snapshot.
    const sources = await t.run((ctx) =>
      ctx.db.query("tagAliasSources").collect(),
    );
    expect(sources).toHaveLength(540);
    for (const source of sources)
      await t.run(async (ctx) => {
        const tag = await ctx.db.get(source.tagId);
        if (!tag) throw new Error("Missing canonical fixture tag");
        const rows = await ctx.db
          .query("tagAliases")
          .withIndex("by_tagId", (q) => q.eq("tagId", tag._id))
          .collect();
        const index = names.indexOf(tag.key);
        expect(rows.map((r) => r.alias)).toEqual(
          index < 0 ? [] : [`known${index}`],
        );
        for (const row of rows)
          expect(row).toMatchObject({
            key: tag.key,
            userId: tag.userId,
            sourceCreationTime: tag._creationTime,
          });
      });
    if (!maxReadBytes) {
      await t.run(async (ctx) => {
        expect(await verifyAndActivateTagAliases(ctx, userId)).toBe(true);
        evidence(
          "B12 alias production activation metrics",
          JSON.stringify(await ctx.meta.getTransactionMetrics()),
        );
      });
    } else
      await t.run(async (ctx) => {
        const state = await aliasState(ctx, userId);
        if (!state?.backfilled || state.overflow)
          throw new Error("Incomplete stress projection");
        expect(await ctx.db.query("tagAliases").collect()).toHaveLength(3);
        await ctx.db.patch(state._id, { ready: true });
      });
  }
  return { t, articleId };
}

async function measuredAssignment(
  f: Awaited<ReturnType<typeof fixture>>,
  phase: string,
  proposals = names.map((name) => ({ name })),
  bounded = false,
) {
  return f.t.run(async (ctx) => {
    const links = await ctx.runMutation(internal.tags.assign, {
      userId,
      articleId: f.articleId,
      proposals,
    });
    const metrics = await ctx.meta.getTransactionMetrics();
    if (bounded) {
      expect(metrics.bytesRead.used).toBeLessThan(1_000_000);
    }
    evidence(
      "B12 installed writer metrics",
      JSON.stringify({ phase, ...metrics }),
    );
    return links;
  });
}

it("assigns and replaces three existing active names under a native 1MB read limit", async () => {
  const current = await fixture(true, 1_000_000);
  const assigned = await measuredAssignment(
    current,
    "native 1MB exact",
    undefined,
    true,
  );
  expect(assigned).toHaveLength(3);
  expect(
    await measuredAssignment(
      current,
      "native 1MB three unlink/relinks",
      undefined,
      true,
    ),
  ).toEqual(assigned);
});

it("assigns/relinks three exact aliases with the SAME 540 vectors and 15.5KB raw alias payloads under native 1MB", async () => {
  const current = await fixture(true, 1_000_000, true);
  const proposals = names.map((_, i) => ({ name: `known${i}` }));
  const assigned = await measuredAssignment(
    current,
    "native 1MB exact aliases",
    proposals,
    true,
  );
  expect(assigned).toHaveLength(3);
  expect(
    await measuredAssignment(
      current,
      "native 1MB alias unlink/relinks",
      proposals,
      true,
    ),
  ).toEqual(assigned);
  expect(
    await measuredAssignment(
      current,
      "native 1MB alias to direct relink",
      undefined,
      true,
    ),
  ).toEqual(assigned);
});

it("activates the full 540-tag alias projection with bounded same-snapshot winner proof, then preserves near-limit unsupported fallback", async () => {
  const current = await fixture(true, undefined, true);
  const proposals = names.map((_, i) => ({ name: `known${i}` }));
  expect(
    await measuredAssignment(
      current,
      "production-gated alias exact",
      proposals,
      true,
    ),
  ).toHaveLength(3);
  expect(
    await measuredAssignment(
      current,
      "alias unsupported final proposal: no speculative vectors",
      [{ name: "known0" }, { name: "known1" }, { name: "absent" }],
    ),
  ).toHaveLength(2);
});

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
  expect(
    await measuredAssignment(current, phase, undefined, true),
  ).toHaveLength(3);
  phase = "maintained unlink + relink";
  expect(
    await measuredAssignment(current, phase, undefined, true),
  ).toHaveLength(3);
  phase = "legacy full scan: MAX3 with four proposals and three prior links";
  expect(
    await measuredAssignment(current, phase, [
      ...names.map((name) => ({ name })),
      { name: "ignored after MAX3" },
    ]),
  ).toHaveLength(3);
  phase = "unsupported final name: no speculative vector hydration";
  expect(
    await measuredAssignment(current, phase, [
      { name: "alpha" },
      { name: "beta" },
      { name: "absent" },
    ]),
  ).toHaveLength(2);
  phase = "restore exact links";
  expect(
    await measuredAssignment(current, phase, undefined, true),
  ).toHaveLength(3);
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
    evidence(
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
    evidence(
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
    evidence(
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
