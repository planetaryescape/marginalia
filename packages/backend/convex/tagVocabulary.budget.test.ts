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
import {
  equalEmbedding,
  migrateTagVectors,
  vectorState,
  verifyAndActivateTagVectors,
} from "./lib/tagVectors";
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

it("assigns actual candidate/semantic proposals and relinks with the unchanged 540 full payloads under native limits", async () => {
  const current = await fixture(true, undefined, true);
  let done = false;
  let migrationRead = 0;
  let migrationWrite = 0;
  for (let i = 0; i < 600 && !done; i++) {
    const measured = await current.t.run(async (ctx) => {
      const result = await migrateTagVectors(ctx, userId);
      return { result, metrics: await ctx.meta.getTransactionMetrics() };
    });
    done = measured.result.done;
    migrationRead = Math.max(migrationRead, measured.metrics.bytesRead.used);
    migrationWrite = Math.max(
      migrationWrite,
      measured.metrics.bytesWritten.used,
    );
  }
  expect(done).toBe(true);
  expect(migrationRead).toBeLessThan(1_000_000);
  expect(migrationWrite).toBeLessThan(1_000_000);
  evidence(
    "B12 vector migration maxima",
    JSON.stringify({ migrationRead, migrationWrite }),
  );
  // Test-only physical stress activation: production correctly refuses this
  // >8MB canonical baseline rather than claiming a partial page is complete.
  expect(
    await current.t.run((ctx) => verifyAndActivateTagVectors(ctx, userId)),
  ).toBe(false);
  const vectors = await current.t.run((ctx) =>
    ctx.db.query("tagVectors").collect(),
  );
  expect(vectors).toHaveLength(540);
  for (const row of vectors)
    await current.t.run(async (ctx) => {
      const canonical = await ctx.db.get(row.tagId);
      expect(canonical?.key).toBe(row.key);
      expect(canonical?._creationTime).toBe(row.sourceCreationTime);
      expect(equalEmbedding(canonical?.embedding, row.embedding)).toBe(true);
      expect(canonical?.aliases[0].length).toBeGreaterThan(15_500);
      expect(canonical?.embedding).toHaveLength(1536);
    });
  await current.t.run(async (ctx) => {
    const state = await vectorState(ctx, userId);
    if (!state?.backfilled || state.overflow)
      throw new Error("Incomplete stress vector index");
    evidence("B12 vector stress readiness", JSON.stringify(state));
    await ctx.db.patch(state._id, { ready: true });
  });
  const semantic = {
    name: "semantic synonym",
    embedding: Array(1536).fill(0.125),
  };
  const novel = {
    name: "novel candidate",
    embedding: Array.from({ length: 1536 }, (_, i) => (i % 2 ? 0.125 : -0.125)),
  };
  const proposals = [semantic, novel, { name: "novel candidate" }];
  let expected: string[] = [];
  for (const phase of [
    "native candidate+semantic",
    "native candidate+semantic unlink/relink",
  ]) {
    const result = await current.t.run(async (ctx) => {
      const ids = await ctx.runMutation(internal.tags.assign, {
        userId,
        articleId: current.articleId,
        proposals,
      });
      const metrics = await ctx.meta.getTransactionMetrics();
      expect(metrics.bytesRead.used).toBeLessThan(12_000_000);
      expect(metrics.bytesWritten.used).toBeLessThan(1_000_000);
      evidence(
        "B12 actual semantic assignment",
        JSON.stringify({ phase, ...metrics }),
      );
      return ids;
    });
    expect(result).toHaveLength(2);
    if (expected.length) expect(result).toEqual(expected);
    expected = result;
  }
  // A true .8-.9 near miss links both the candidate and its nearest tag.
  const near = Array.from(
    { length: 1536 },
    (_, i) => 0.85 + (i % 2 ? 1 : -1) * Math.sqrt(1 - 0.85 ** 2),
  );
  for (const phase of [
    "native near candidate",
    "native near candidate unlink/relink",
  ]) {
    await current.t.run(async (ctx) => {
      expect(
        await ctx.runMutation(internal.tags.assign, {
          userId,
          articleId: current.articleId,
          proposals: [{ name: "near candidate", embedding: near }],
        }),
      ).toHaveLength(2);
      const metrics = await ctx.meta.getTransactionMetrics();
      expect(metrics.bytesRead.used).toBeLessThan(12_000_000);
      expect(metrics.bytesWritten.used).toBeLessThan(1_000_000);
      evidence(
        "B12 actual near assignment",
        JSON.stringify({ phase, ...metrics }),
      );
    });
  }
  await current.t.run(async (ctx) => {
    const alpha = await ctx.db
      .query("tags")
      .withIndex("by_user_key", (q) =>
        q.eq("userId", userId).eq("key", "alpha"),
      )
      .unique();
    const beta = await ctx.db
      .query("tags")
      .withIndex("by_user_key", (q) => q.eq("userId", userId).eq("key", "beta"))
      .unique();
    if (!alpha || !beta) throw new Error("Missing large fixture candidate");
    await metadataTriggers.wrapDB(ctx).db.patch(alpha._id, {
      status: "candidate",
      count: 1,
      nearestTagId: beta._id,
    });
  });
  for (const phase of [
    "native full-payload exact candidate",
    "native full-payload exact candidate relink",
  ]) {
    await current.t.run(async (ctx) => {
      expect(
        await ctx.runMutation(internal.tags.assign, {
          userId,
          articleId: current.articleId,
          proposals: [{ name: "alpha" }, { name: "alpha" }],
        }),
      ).toHaveLength(2);
      const metrics = await ctx.meta.getTransactionMetrics();
      expect(metrics.bytesRead.used).toBeLessThan(12_000_000);
      expect(metrics.bytesWritten.used).toBeLessThan(1_000_000);
      evidence(
        "B12 actual exact candidate",
        JSON.stringify({ phase, ...metrics }),
      );
    });
  }
});

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
