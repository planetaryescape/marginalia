/// <reference types="vite/client" />

import { getConvexSize, getDocumentSize, jsonToConvex } from "convex/values";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { finishArticleRemoval, proveArticleRemoval } from "../test/feedRemoval";
import { addReader } from "../test/owner";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import authSchema from "./betterAuth/schema";
import "./functions";
import { metadataTriggers } from "./lib/metadataTriggers";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const DOCUMENT_LIMIT = 1024 * 1024;
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// Test-only runtime boundary, matching the installed SDK's syscall contract.
// This adds individual-document checking that convex-test does NOT provide.
declare const Convex: {
  asyncSyscall(op: string, args: string): Promise<string>;
};
function documentCapGuard() {
  const original = Convex.asyncSyscall;
  const writes: { id: string; bytes: number }[] = [];
  vi.spyOn(Convex, "asyncSyscall").mockImplementation(async (op, raw) => {
    const result = await original(op, raw);
    if (
      op === "1.0/insert" ||
      op === "1.0/shallowMerge" ||
      op === "1.0/replace"
    ) {
      const id =
        op === "1.0/insert"
          ? z.object({ _id: z.string() }).parse(JSON.parse(result))._id
          : z.object({ id: z.string() }).parse(JSON.parse(raw)).id;
      const stored = jsonToConvex(
        JSON.parse(await original("1.0/get", JSON.stringify({ id }))),
      );
      const bytes = getConvexSize(stored);
      writes.push({ id, bytes });
      if (bytes > DOCUMENT_LIMIT)
        throw new Error(
          `Test-only document cap: ${bytes} > ${DOCUMENT_LIMIT}; not native/server enforcement`,
        );
    }
    return result;
  });
  return writes;
}

async function fixture() {
  const t = convexTest({ schema, modules, transactionLimits: true });
  t.registerComponent(
    "betterAuth",
    authSchema,
    import.meta.glob("./betterAuth/**/*.ts"),
  );
  const { client, libraryId } = await addReader(t, {
    email: "offrow-boundary@example.com",
  });
  const feedId = await t.run((ctx) =>
    ctx.db.insert("feeds", {
      userId: libraryId,
      title: "Proof",
      url: "https://example.com/feed",
      isActive: false,
      createdAt: 1,
    }),
  );
  const articleId = await t.run((ctx) =>
    metadataTriggers.wrapDB(ctx).db.insert("articles", {
      userId: libraryId,
      feedId,
      title: "Proof",
      guid: "proof",
      url: "https://example.com/proof",
      extractionStatus: "extracted",
      annotationStatus: "annotated",
      createdAt: 1,
    }),
  );
  const reflection = (
    userResponse?: string,
    targetBytes?: number,
    owner = articleId,
  ) =>
    t.run(async (ctx) => {
      // Deliberate legacy construction: no eligibility fields or backfill.
      const id = await ctx.db.insert("reflections", {
        userId: libraryId,
        articleId: owner,
        strongestPoint: "",
        weakestAssumption: "",
        credibleCounterview: "",
        questionForYou: "",
        createdAt: 1,
        userResponse,
        respondedAt: userResponse !== undefined ? 1 : undefined,
      });
      if (targetBytes !== undefined) {
        const row = await ctx.db.get(id);
        if (!row) throw new Error("Missing fixture row");
        await ctx.db.patch(id, {
          strongestPoint: "R".repeat(targetBytes - getDocumentSize(row)),
        });
      }
      return id;
    });
  const seed = async (count = 70) => {
    const ids: Id<"reflections">[] = [];
    for (let i = 0; i < count; i++) ids.push(await reflection());
    return ids;
  };
  const args = { userId: libraryId, feedId, choice: "all" as const };
  const job = () =>
    t.run((ctx) =>
      ctx.db
        .query("feedArticleCleanup")
        .withIndex("by_articleId", (q) => q.eq("articleId", articleId))
        .unique(),
    );
  const begin = async () => {
    await t.mutation(internal.feeds.removeArticles, args);
    const proof = await job();
    if (proof?.phase !== "checking") throw new Error("Missing checking proof");
    return proof;
  };
  const step = async () => {
    const proof = await job();
    if (proof?.phase !== "checking") throw new Error("Missing checking proof");
    return t.run(async (ctx) => {
      await ctx.runMutation(internal.feedRemovalCleanup.prepare, {
        jobId: proof._id,
      });
      return ctx.meta.getTransactionMetrics();
    });
  };
  const source = () => t.run((ctx) => ctx.db.get(articleId));
  const prove = () => proveArticleRemoval(t, articleId);
  return {
    t,
    client,
    libraryId,
    feedId,
    articleId,
    reflection,
    seed,
    args,
    job,
    begin,
    step,
    source,
    prove,
  };
}

describe("transient off-row removal proof: document cap and revisions", () => {
  it("calibrates the explicit test-only document guard, without claiming native individual-cap enforcement", async () => {
    const f = await fixture();
    const oversized = await f.reflection(undefined, DOCUMENT_LIMIT + 1);
    expect(
      getDocumentSize((await f.t.run((ctx) => ctx.db.get(oversized))) ?? {}),
    ).toBe(DOCUMENT_LIMIT + 1);
    const id = await f.reflection(undefined, DOCUMENT_LIMIT);
    const before = await f.t.run((ctx) => ctx.db.get(id));
    if (!before) throw new Error("Missing cap fixture");
    await f.t.run(async () => {
      documentCapGuard();
    });
    await expect(
      f.t.run((ctx) =>
        ctx.db.patch(id, { strongestPoint: `${before.strongestPoint}R` }),
      ),
    ).rejects.toThrow(
      `Test-only document cap: ${DOCUMENT_LIMIT + 1} > ${DOCUMENT_LIMIT}`,
    );
    expect(await f.t.run((ctx) => ctx.db.get(id))).toEqual(before);
  });

  for (const answered of [false, true]) {
    it(`makes complete, no-growth ${answered ? "protection" : "removal"} progress on a maximal valid legacy reflection under an explicit test-only write cap`, async () => {
      const f = await fixture();
      const id = await f.reflection(answered ? "" : undefined, DOCUMENT_LIMIT);
      const before = await f.t.run((ctx) => ctx.db.get(id));
      if (!before) throw new Error("Missing maximal reflection");
      expect(getDocumentSize(before)).toBe(DOCUMENT_LIMIT);
      let writes: ReturnType<typeof documentCapGuard> = [];
      await f.t.run(async () => {
        writes = documentCapGuard();
      });
      const proof = await f.begin();
      // A generic legacy no-op edit invalidates the proof, not the full row.
      await f.t.run((ctx) =>
        metadataTriggers
          .wrapDB(ctx)
          .db.patch(id, { createdAt: before.createdAt }),
      );
      expect((await f.job())?.phase).toBe("checking");
      await f.prove();
      expect(!!(await f.source())).toBe(answered);
      const after = await f.t.run((ctx) => ctx.db.get(id));
      expect(after).toEqual(before);
      expect(getDocumentSize(after ?? {})).toBe(DOCUMENT_LIMIT);
      expect(after).not.toHaveProperty("responsePresent");
      if (answered) {
        await f.client.mutation(api.reflections.saveResponse, {
          reflectionId: id,
          userResponse: "",
        });
        expect(await f.t.run((ctx) => ctx.db.get(id))).toEqual(before);
        expect(await f.job()).toBeNull();
      } else {
        const cleanup = await f.job();
        expect(cleanup?.phase).toBe("annotations");
        expect(cleanup?._id).toBe(proof._id);
        await expect(
          f.client.mutation(api.reflections.saveResponse, {
            reflectionId: id,
            userResponse: "late private",
          }),
        ).rejects.toThrow("Article not found");
      }
      // No completed/stale proof token can reset cleanup or recreate a job.
      await f.t.mutation(internal.feedRemovalCleanup.prepare, {
        jobId: proof._id,
      });
      expect((await f.job())?.phase).toBe(answered ? undefined : "annotations");
      expect(writes.every((write) => write.bytes <= DOCUMENT_LIMIT)).toBe(true);
      process.stdout.write(
        `${JSON.stringify({ label: "offrow-max-document", answered, beforeBytes: getDocumentSize(before), afterBytes: getDocumentSize(after ?? {}), eligibilityGrowthBytes: 0, guardedWrites: writes.length, largestGuardedWrite: Math.max(...writes.map((write) => write.bytes)), sourceRetained: answered, guard: "test-only; native convex-test does not enforce individual document cap" })}\n`,
      );
    });
  }

  for (const operation of [
    "save",
    "insert",
    "patch",
    "replace",
    "delete",
  ] as const) {
    it(`invalidates and restarts after an intermediate page on generic ${operation}`, async () => {
      const f = await fixture();
      const ids = await f.seed();
      const proof = await f.begin();
      await f.step();
      const scanned = await f.job();
      if (scanned?.phase !== "checking")
        throw new Error("Scan finished prematurely");
      expect(scanned.cursor).toBeDefined();
      expect(scanned.revision).toBe(0);
      if (operation === "save")
        await f.client.mutation(api.reflections.saveResponse, {
          reflectionId: ids[0],
          userResponse: "",
        });
      if (operation === "insert")
        await f.t.run((ctx) =>
          metadataTriggers.wrapDB(ctx).db.insert("reflections", {
            userId: f.libraryId,
            articleId: f.articleId,
            strongestPoint: "late",
            weakestAssumption: "",
            credibleCounterview: "",
            questionForYou: "",
            userResponse: "",
            createdAt: 2,
          }),
        );
      if (operation === "patch")
        await f.t.run((ctx) =>
          metadataTriggers
            .wrapDB(ctx)
            .db.patch(ids[0], { strongestPoint: "edited behind cursor" }),
        );
      if (operation === "replace")
        await f.t.run(async (ctx) => {
          const row = await ctx.db.get(ids[0]);
          if (!row) throw new Error("Missing replace row");
          const { _id, _creationTime, ...body } = row;
          await metadataTriggers
            .wrapDB(ctx)
            .db.replace(_id, { ...body, userResponse: "" });
        });
      if (operation === "delete")
        await f.t.run((ctx) => metadataTriggers.wrapDB(ctx).db.delete(ids[0]));
      const invalidated = await f.job();
      expect(invalidated).toMatchObject({ phase: "checking", revision: 1 });
      if (invalidated?.phase !== "checking")
        throw new Error("Lost checking proof");
      expect(invalidated.cursor).toBeUndefined();
      await f.prove();
      const protectedCase =
        operation === "save" ||
        operation === "insert" ||
        operation === "replace";
      expect(!!(await f.source())).toBe(protectedCase);
      if (protectedCase) {
        expect(await f.job()).toBeNull();
        expect(
          await f.t.run((ctx) =>
            ctx.db
              .query("reflections")
              .withIndex("by_article", (q) => q.eq("articleId", f.articleId))
              .take(100),
          ),
        ).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ userResponse: "" }),
          ]),
        );
      }
      await f.t.mutation(internal.feedRemovalCleanup.prepare, {
        jobId: proof._id,
      });
      expect(!!(await f.source())).toBe(protectedCase);
    });
  }

  it("a maximal empty response saved after an intermediate page resets the proof without growing private content", async () => {
    const f = await fixture();
    await f.seed();
    const id = await f.reflection("", DOCUMENT_LIMIT);
    const before = await f.t.run((ctx) => ctx.db.get(id));
    if (!before) throw new Error("Missing maximal response");
    await f.begin();
    await f.step();
    const scanned = await f.job();
    if (scanned?.phase !== "checking")
      throw new Error("Missing intermediate proof");
    expect(scanned.cursor).toBeDefined();
    await f.t.run(async () => {
      documentCapGuard();
    });
    await f.client.mutation(api.reflections.saveResponse, {
      reflectionId: id,
      userResponse: "",
    });
    expect(await f.job()).toMatchObject({ phase: "checking", revision: 1 });
    await f.prove();
    expect(await f.source()).not.toBeNull();
    expect(await f.job()).toBeNull();
    expect(await f.t.run((ctx) => ctx.db.get(id))).toEqual(before);
    expect(getDocumentSize(before)).toBe(DOCUMENT_LIMIT);
  });

  it("an insert then delete invalidates twice rather than permanently treating a no-longer-present response as protection", async () => {
    const f = await fixture();
    await f.seed();
    await f.begin();
    await f.step();
    const id = await f.t.run((ctx) =>
      metadataTriggers.wrapDB(ctx).db.insert("reflections", {
        articleId: f.articleId,
        userId: f.libraryId,
        strongestPoint: "temporary",
        weakestAssumption: "",
        credibleCounterview: "",
        questionForYou: "",
        userResponse: "",
        createdAt: 1,
      }),
    );
    await f.t.run((ctx) => metadataTriggers.wrapDB(ctx).db.delete(id));
    expect(await f.job()).toMatchObject({ phase: "checking", revision: 2 });
    await f.prove();
    expect(await f.source()).toBeNull();
  });

  it("a genuinely empty restarted page is consumed once and transitions atomically to cleanup", async () => {
    const f = await fixture();
    const ids = await f.seed();
    const proof = await f.begin();
    await f.step();
    await f.t.run(async (ctx) => {
      const db = metadataTriggers.wrapDB(ctx).db;
      for (const id of ids) await db.delete(id);
    });
    expect(await f.job()).toMatchObject({ phase: "checking", revision: 70 });
    await f.step();
    expect(await f.source()).toBeNull();
    expect(await f.job()).toMatchObject({
      _id: proof._id,
      phase: "annotations",
    });
  });

  it("invalidates both article-local proofs when an older reflection moves behind another article's cursor", async () => {
    const f = await fixture();
    const ids = await f.seed();
    const otherFeed = await f.t.run((ctx) =>
      ctx.db.insert("feeds", {
        userId: f.libraryId,
        title: "Other",
        url: "https://example.com/other",
        isActive: false,
        createdAt: 1,
      }),
    );
    const other = await f.t.run((ctx) =>
      metadataTriggers.wrapDB(ctx).db.insert("articles", {
        userId: f.libraryId,
        feedId: otherFeed,
        title: "Other",
        guid: "other",
        url: "https://example.com/other",
        extractionStatus: "extracted",
        annotationStatus: "annotated",
        createdAt: 1,
      }),
    );
    for (let i = 0; i < 70; i++)
      await f.reflection(undefined, undefined, other);
    const first = await f.begin();
    await f.step();
    await f.t.mutation(internal.feeds.removeArticles, {
      ...f.args,
      feedId: otherFeed,
    });
    const second = await f.t.run((ctx) =>
      ctx.db
        .query("feedArticleCleanup")
        .withIndex("by_articleId", (q) => q.eq("articleId", other))
        .unique(),
    );
    if (second?.phase !== "checking") throw new Error("Missing second proof");
    await f.t.mutation(internal.feedRemovalCleanup.prepare, {
      jobId: second._id,
    });
    await f.t.run((ctx) =>
      metadataTriggers
        .wrapDB(ctx)
        .db.patch(ids[0], { articleId: other, userResponse: "" }),
    );
    for (const id of [first._id, second._id]) {
      const job = await f.t.run((ctx) => ctx.db.get(id));
      expect(job).toMatchObject({ phase: "checking", revision: 1 });
      if (job?.phase !== "checking") throw new Error("Lost moved proof");
      expect(job.cursor).toBeUndefined();
    }
    await proveArticleRemoval(f.t, other);
    expect(await f.t.run((ctx) => ctx.db.get(other))).not.toBeNull();
    expect(await f.t.run((ctx) => ctx.db.get(ids[0]))).toMatchObject({
      articleId: other,
      userResponse: "",
    });
    await f.prove();
    expect(await f.source()).toBeNull();
  });

  for (const boundary of ["owner", "feed", "delete"] as const) {
    it(`cancels only a checking proof at the source ${boundary} boundary; stale tokens stay inert`, async () => {
      const f = await fixture();
      await f.seed();
      const proof = await f.begin();
      await f.step();
      await f.t.run(async (ctx) => {
        const db = metadataTriggers.wrapDB(ctx).db;
        if (boundary === "owner")
          await db.patch(f.articleId, { userId: "another-library" });
        if (boundary === "feed")
          await db.patch(f.articleId, { feedId: undefined });
        if (boundary === "delete") await db.delete(f.articleId);
      });
      expect(await f.job()).toBeNull();
      await f.t.mutation(internal.feedRemovalCleanup.prepare, {
        jobId: proof._id,
      });
      expect(await f.job()).toBeNull();
      expect(!!(await f.source())).toBe(boundary !== "delete");
    });
  }

  it("source cancellation resumes the same legacy source cursor without deleting the transferred source", async () => {
    const f = await fixture();
    await f.seed();
    const next = await f.t.run((ctx) =>
      metadataTriggers.wrapDB(ctx).db.insert("articles", {
        userId: f.libraryId,
        feedId: f.feedId,
        title: "Next",
        guid: "next",
        url: "https://example.com/next",
        extractionStatus: "extracted",
        annotationStatus: "annotated",
        createdAt: 2,
      }),
    );
    await f.begin();
    await f.step();
    await f.t.run((ctx) =>
      metadataTriggers
        .wrapDB(ctx)
        .db.patch(f.articleId, { userId: "another-library" }),
    );
    const jobs = await f.t.run((ctx) =>
      ctx.db.system.query("_scheduled_functions").take(100),
    );
    const nextJob = jobs.find((job) => job.name === "feeds:removeArticles");
    const queued = z
      .object({ cursor: z.string(), readerDeletes: z.number() })
      .parse(nextJob?.args[0]);
    await f.t.mutation(internal.feeds.removeArticles, { ...f.args, ...queued });
    expect((await f.source())?.userId).toBe("another-library");
    expect(await f.t.run((ctx) => ctx.db.get(next))).toBeNull();
  });

  it("the actual account metadata step prunes only its own compact cleanup claims, preserving step order and stale-token safety", async () => {
    const f = await fixture();
    await f.reflection();
    const proof = await f.begin();
    await f.prove();
    expect(await f.job()).toMatchObject({ phase: "annotations" });
    const second = await addReader(f.t, { email: "offrow-other@example.com" });
    const otherJob = await f.t.run(async (ctx) => {
      const other = await ctx.db.insert("articles", {
        userId: second.libraryId,
        title: "Other",
        guid: "other",
        url: "https://example.com/other",
        extractionStatus: "extracted",
        annotationStatus: "annotated",
        createdAt: 2,
      });
      await ctx.db.delete(other);
      return ctx.db.insert("feedArticleCleanup", {
        userId: second.libraryId,
        articleId: other,
        phase: "annotations",
      });
    });
    const unrelated = await f.t.run((ctx) => ctx.db.get(otherJob));
    await f.client.mutation(api.account.deleteMine, { confirmation: "DELETE" });
    while (await f.job()) {
      const scheduled = await f.t.run((ctx) =>
        ctx.db.system.query("_scheduled_functions").take(200),
      );
      const latest = scheduled
        .filter((job) => job.name === "account:purge")
        .at(-1);
      const args = z
        .object({
          userId: z.string(),
          authId: z.string(),
          email: z.string().optional(),
          step: z.number(),
        })
        .parse(latest?.args[0]);
      await f.t.mutation(internal.account.purge, args);
    }
    expect(await f.t.run((ctx) => ctx.db.get(otherJob))).toEqual(unrelated);
    await f.t.mutation(internal.feedRemovalCleanup.prepare, {
      jobId: proof._id,
    });
    await f.t.mutation(internal.feedRemovalCleanup.discard, {
      jobId: proof._id,
    });
    expect(await f.job()).toBeNull();
  });

  it("rechecks unread-history and personal protection in the final transaction, not just at scan admission", async () => {
    const f = await fixture();
    await f.seed();
    await f.t.mutation(internal.feeds.removeArticles, {
      ...f.args,
      choice: "unread",
    });
    await f.step();
    await f.client.mutation(api.savedArticles.save, { articleId: f.articleId });
    await f.prove();
    expect(await f.source()).not.toBeNull();
    expect(await f.job()).toBeNull();
    expect(
      await f.t.run((ctx) => ctx.db.query("savedArticles").first()),
    ).toMatchObject({ articleId: f.articleId });
  });

  it("duplicate scan and legacy source callbacks share a current proof without resetting progress or duplicating cleanup", async () => {
    const f = await fixture();
    await f.seed();
    const proof = await f.begin();
    await f.step();
    const scanned = await f.job();
    await f.t.mutation(internal.feeds.removeArticles, f.args);
    expect(await f.job()).toEqual(scanned);
    await f.t.mutation(internal.feedRemovalCleanup.prepare, {
      jobId: proof._id,
    });
    await f.t.mutation(internal.feedRemovalCleanup.prepare, {
      jobId: proof._id,
    });
    expect(await f.source()).toBeNull();
    expect(await f.job()).toMatchObject({
      _id: proof._id,
      phase: "annotations",
    });
    expect(
      await f.t.run((ctx) => ctx.db.query("feedArticleCleanup").take(10)),
    ).toHaveLength(1);
  });

  it("a stale legacy source continuation cannot reset Reader pacing between two owned proofs", async () => {
    const f = await fixture();
    await f.reflection();
    await f.t.run((ctx) =>
      metadataTriggers
        .wrapDB(ctx)
        .db.patch(f.articleId, { readerDocumentId: "first" }),
    );
    const next = await f.t.run((ctx) =>
      metadataTriggers.wrapDB(ctx).db.insert("articles", {
        userId: f.libraryId,
        feedId: f.feedId,
        title: "Next",
        guid: "next",
        url: "https://example.com/next",
        readerDocumentId: "next",
        extractionStatus: "extracted",
        annotationStatus: "annotated",
        createdAt: 2,
      }),
    );
    await f.reflection(undefined, undefined, next);
    const legacy = { ...f.args, readerDeletes: 2 };
    await f.t.mutation(internal.feeds.removeArticles, legacy);
    await f.prove();
    await finishArticleRemoval(f.t, f.articleId);
    expect(await f.job()).toBeNull();
    // Deliver the stale original shape before the newly queued count=3 RPC.
    await f.t.mutation(internal.feeds.removeArticles, legacy);
    await proveArticleRemoval(f.t, next);
    const jobs = await f.t.run((ctx) =>
      ctx.db.system.query("_scheduled_functions").take(100),
    );
    const deletes = jobs.filter(
      (job) => job.name === "actions/readwiseSync:deleteReaderDocument",
    );
    expect(deletes.map((job) => job.scheduledTime - Date.now())).toEqual([
      7_000, 10_500,
    ]);
    expect(deletes.map((job) => job.args[0])).toEqual([
      { userId: f.libraryId, readerDocumentId: "first" },
      { userId: f.libraryId, readerDocumentId: "next" },
    ]);
  });

  it("a lost run cannot be recreated or consumed by its stale checking token", async () => {
    const f = await fixture();
    await f.seed();
    const proof = await f.begin();
    await f.step();
    await f.t.run((ctx) => ctx.db.delete(proof.runId));
    await f.t.mutation(internal.feedRemovalCleanup.prepare, {
      jobId: proof._id,
    });
    expect(await f.source()).not.toBeNull();
    expect(await f.job()).toBeNull();
    expect(
      await f.t.run((ctx) => ctx.db.query("feedArticleCleanup").first()),
    ).toBeNull();
  });
});
