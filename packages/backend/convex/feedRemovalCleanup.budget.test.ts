/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { proveArticleRemoval } from "../test/feedRemoval";
import { addReader } from "../test/owner";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import authSchema from "./betterAuth/schema";
import "./functions";
import { ReadBudget } from "./lib/ideaGraph";
import { articleFor, loadNode } from "./lib/ideaNodes";
import { connectionsOnArticle } from "./lib/ideaSignals";
import { metadataTriggers } from "./lib/metadataTriggers";
import { updateQueueStats } from "./readingQueue";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const LARGE = "界".repeat(330_000);
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

async function fixture() {
  const t = convexTest({ schema, modules, transactionLimits: true });
  t.registerComponent(
    "betterAuth",
    authSchema,
    import.meta.glob("./betterAuth/**/*.ts"),
  );
  const { client, libraryId } = await addReader(t, {
    email: "removal-native@example.com",
  });
  const feedId = await t.run((ctx) =>
    ctx.db.insert("feeds", {
      userId: libraryId,
      title: "Feed",
      url: "https://example.com/feed",
      description: LARGE,
      isActive: false,
      articleCount: 1,
      createdAt: 1,
    }),
  );
  const articleId = await t.run(async (ctx) => {
    const db = metadataTriggers.wrapDB(ctx).db;
    const id = await db.insert("articles", {
      userId: libraryId,
      feedId,
      title: "Article",
      url: "https://example.com/article",
      guid: "fixture",
      content: LARGE,
      extractionStatus: "extracted",
      annotationStatus: "annotated",
      estimatedReadMinutes: 4,
      createdAt: 1,
    });
    const article = await db.get(id);
    if (article) await updateQueueStats({ ...ctx, db }, null, article);
    return id;
  });
  const reflection = (userResponse?: string, classified = false) =>
    t.run(async (ctx) => {
      const fields = {
        articleId,
        userId: libraryId,
        strongestPoint: LARGE,
        weakestAssumption: "",
        credibleCounterview: "",
        questionForYou: "",
        userResponse,
        createdAt: 1,
      };
      return classified
        ? metadataTriggers.wrapDB(ctx).db.insert("reflections", fields)
        : ctx.db.insert("reflections", fields);
    });
  const args = { userId: libraryId, feedId, choice: "all" as const };
  const remove = () =>
    t.run(async (ctx) => {
      await ctx.runMutation(internal.feeds.removeArticles, args);
      return ctx.meta.getTransactionMetrics();
    });
  const source = () => t.run((ctx) => ctx.db.get(articleId));
  const job = () =>
    t.run((ctx) =>
      ctx.db
        .query("feedArticleCleanup")
        .withIndex("by_articleId", (q) => q.eq("articleId", articleId))
        .first(),
    );
  const finish = () => t.finishAllScheduledFunctions(vi.runAllTimers);
  const prove = () => proveArticleRemoval(t, articleId);
  return {
    t,
    client,
    libraryId,
    feedId,
    articleId,
    reflection,
    args,
    remove,
    source,
    finish,
    job,
    prove,
  };
}

describe("actual feed removal native budgets and protection", () => {
  it("fences retained generated rows in graph fallback and annotation RPCs until owned cleanup finishes", async () => {
    const f = await fixture();
    const annotationId = await f.t.run(async (ctx) => {
      const target = await ctx.db.insert("articles", {
        userId: f.libraryId,
        guid: "target",
        title: "Target",
        url: "https://example.com/target",
        extractionStatus: "extracted",
        annotationStatus: "annotated",
        createdAt: 1,
      });
      await ctx.db.insert("summaries", {
        userId: f.libraryId,
        articleId: f.articleId,
        gist: "must not escape cleanup",
        model: "fixture",
        createdAt: 1,
      });
      return ctx.db.insert("annotations", {
        userId: f.libraryId,
        articleId: f.articleId,
        articleRefId: target,
        type: "cross_reference",
        anchorText: "a",
        anchorStartOffset: 0,
        anchorEndOffset: 1,
        content: "generated",
        notePath: "fixture.md",
        relevanceScore: 1,
        wasViewed: false,
        wasDismissed: false,
        createdAt: 1,
      });
    });
    await f.reflection();
    await f.remove();
    expect(
      await f.t.run((ctx) =>
        loadNode(
          ctx,
          f.libraryId,
          `article:${f.articleId}`,
          new ReadBudget(100, 0),
          true,
        ),
      ),
    ).not.toBeNull();
    await f.prove();
    expect(await f.source()).toBeNull();
    expect(
      await f.t.run((ctx) => ctx.db.query("summaries").first()),
    ).toMatchObject({ gist: "must not escape cleanup" });
    expect(
      await f.t.run((ctx) =>
        loadNode(
          ctx,
          f.libraryId,
          `article:${f.articleId}`,
          new ReadBudget(100, 0),
          true,
        ),
      ),
    ).toBeNull();
    expect(
      await f.t.run((ctx) =>
        connectionsOnArticle(ctx, f.libraryId, f.articleId),
      ),
    ).toEqual([]);
    expect(
      await f.t.run((ctx) =>
        articleFor(ctx, f.libraryId, {
          kind: "vault",
          key: "vault:fixture.md",
          id: "fixture.md",
          filePath: "fixture.md",
          label: "Fixture",
          text: "",
          createdAt: 1,
        }),
      ),
    ).toBeNull();
    expect(
      await f.client.query(api.annotations.referencedArticle, { annotationId }),
    ).toBeNull();
    await expect(
      f.client.mutation(api.annotations.markViewed, { annotationId }),
    ).rejects.toThrow("Annotation not found");
    await expect(
      f.client.mutation(api.annotations.markDismissed, { annotationId }),
    ).rejects.toThrow("Annotation not found");
    await f.finish();
    expect(await f.job()).toBeNull();
    expect(
      await f.t.run((ctx) => ctx.db.query("feedArticleCleanup").first()),
    ).toBeNull();
  });
  it("commits source removal and bounded cleanup with >16 MiB of each generated child kind and large tag aliases", async () => {
    const f = await fixture();
    for (let i = 0; i < 18; i++) {
      await f.reflection(undefined, true);
      await f.t.run((ctx) =>
        ctx.db.insert("annotations", {
          articleId: f.articleId,
          userId: f.libraryId,
          type: "context",
          anchorText: "a",
          anchorStartOffset: 0,
          anchorEndOffset: 1,
          content: LARGE,
          relevanceScore: 1,
          wasViewed: false,
          wasDismissed: false,
          createdAt: 1,
        }),
      );
      await f.t.run((ctx) =>
        ctx.db.insert("summaries", {
          articleId: f.articleId,
          userId: f.libraryId,
          gist: LARGE,
          model: "fixture",
          createdAt: 1,
        }),
      );
    }
    const tagIds: Id<"tags">[] = [];
    for (let i = 0; i < 3; i++)
      tagIds.push(
        await f.t.run(async (ctx) => {
          const db = metadataTriggers.wrapDB(ctx).db;
          const tagId = await db.insert("tags", {
            userId: f.libraryId,
            name: `Topic ${i}`,
            key: `topic-${i}`,
            aliases: [LARGE],
            count: 1,
            status: "active",
            createdAt: 1,
          });
          await db.insert("articleTags", {
            userId: f.libraryId,
            articleId: f.articleId,
            tagId,
            createdAt: 1,
          });
          return tagId;
        }),
      );
    await f.t.run(async (ctx) => {
      const db = metadataTriggers.wrapDB(ctx).db;
      await db.insert("savedArticles", {
        userId: f.libraryId,
        articleId: f.articleId,
        savedAt: 1,
      });
      await db.insert("lovedArticles", {
        userId: f.libraryId,
        articleId: f.articleId,
        lovedAt: 1,
        reviewIndex: 0,
        nextReviewAt: 2,
        reviewCount: 0,
      });
      await db.insert("readingActivity", {
        userId: f.libraryId,
        articleId: f.articleId,
        day: "2026-10-18",
        visitId: "fixture",
        startedAt: 1,
        updatedAt: 1,
        activeTimeMs: 12_000,
        visibleTimeMs: 12_000,
        timeSpentMs: 12_000,
        maxScrollPercent: 50,
        annotationsOpened: [],
      });
    });
    for (const table of ["annotations", "summaries", "reflections"] as const)
      await expect(
        f.t.run((ctx) => ctx.db.query(table).collect()),
      ).rejects.toThrow("Read too much data");
    await f.remove();
    const metrics = await f.prove();
    if (!metrics) throw new Error("Missing completed proof metrics");
    expect(await f.source()).toBeNull();
    expect(metrics.bytesRead.used).toBeLessThan(12 * 1024 * 1024);
    // Exercise the actual cleanup mutation directly to expose its physical
    // cost; the queued replay must subsequently be harmless, not double count.
    const logged = new Set<string>();
    while (true) {
      const job = await f.job();
      if (!job) break;
      const measured = await f.t.run(async (ctx) => {
        await ctx.runMutation(internal.feedRemovalCleanup.discard, {
          jobId: job._id,
        });
        return ctx.meta.getTransactionMetrics();
      });
      expect(measured.bytesRead.used).toBeLessThan(6 * 1024 * 1024);
      if (!logged.has(job.phase))
        process.stdout.write(
          `${JSON.stringify({ label: "feed-removal-native-cleanup", phase: job.phase, measured })}\n`,
        );
      logged.add(job.phase);
    }
    await f.finish();
    expect(await f.job()).toBeNull();
    for (const table of [
      "annotations",
      "summaries",
      "reflections",
      "savedArticles",
      "lovedArticles",
      "articleTags",
    ] as const)
      expect(await f.t.run((ctx) => ctx.db.query(table).first())).toBeNull();
    expect(
      await f.t.run((ctx) => ctx.db.query("readingActivity").first()),
    ).toMatchObject({ articleId: f.articleId, activeTimeMs: 12_000 });
    expect(
      await f.t.run((ctx) => ctx.db.query("readingQueueStats").unique()),
    ).toMatchObject({ waiting: 0, annotated: 0 });
    expect(
      await f.t.run((ctx) => ctx.db.query("shelfCounts").unique()),
    ).toMatchObject({ saved: 0, loved: 0 });
    expect((await f.t.run((ctx) => ctx.db.get(f.feedId)))?.articleCount).toBe(
      0,
    );
    for (const id of tagIds)
      expect((await f.t.run((ctx) => ctx.db.get(id)))?.count).toBe(0);
    process.stdout.write(
      `${JSON.stringify({ label: "feed-removal-native-source", metrics })}\n`,
    );
  });

  it("never treats a partial legacy scan as absence, including a final empty response", async () => {
    const f = await fixture();
    const ids: Id<"reflections">[] = [];
    for (let i = 0; i < 18; i++) ids.push(await f.reflection());
    const answered = await f.reflection("");
    expect((await f.remove()).bytesRead.used).toBeLessThan(4 * 1024 * 1024);
    expect(await f.source()).not.toBeNull();
    await f.finish();
    expect(await f.source()).not.toBeNull();
    expect(await f.t.run((ctx) => ctx.db.get(answered))).toMatchObject({
      userResponse: "",
    });
    for (const id of ids)
      expect(await f.t.run((ctx) => ctx.db.get(id))).not.toBeNull();
  });

  it("scans unanswered fanout resumably and then removes, without a global ready baseline", async () => {
    const f = await fixture();
    for (let i = 0; i < 18; i++) await f.reflection();
    await f.remove();
    expect(await f.source()).not.toBeNull();
    const job = await f.job();
    if (job?.phase !== "checking") throw new Error("Missing checking proof");
    const classify = await f.t.run(async (ctx) => {
      await ctx.runMutation(internal.feedRemovalCleanup.prepare, {
        jobId: job._id,
      });
      return ctx.meta.getTransactionMetrics();
    });
    expect(classify.bytesRead.used).toBeLessThan(6 * 1024 * 1024);
    await f.finish();
    expect(await f.source()).toBeNull();
    expect(
      await f.t.run((ctx) => ctx.db.query("reflections").first()),
    ).toBeNull();
    process.stdout.write(
      `${JSON.stringify({ label: "feed-removal-native-classification", metrics: classify })}\n`,
    );
  });

  it("rechecks an empty response committed after classification and rejects saves committed after removal", async () => {
    const f = await fixture();
    const id = await f.reflection(undefined, true);
    await f.client.mutation(api.reflections.saveResponse, {
      reflectionId: id,
      userResponse: "",
    });
    await f.remove();
    await f.finish();
    expect(await f.source()).not.toBeNull();
    expect((await f.t.run((ctx) => ctx.db.get(id)))?.userResponse).toBe("");
    await f.t.mutation(internal.reflections.deleteByArticle, {
      articleId: f.articleId,
    });
    expect((await f.t.run((ctx) => ctx.db.get(id)))?.userResponse).toBe("");

    const g = await fixture();
    const late = await g.reflection(undefined, true);
    await g.remove();
    await g.prove();
    await expect(
      g.client.mutation(api.reflections.saveResponse, {
        reflectionId: late,
        userResponse: "must not be accepted",
      }),
    ).rejects.toThrow("Article not found");
    await expect(
      g.t.mutation(internal.reflections.insert, {
        articleId: g.articleId,
        userId: g.libraryId,
        strongestPoint: "late",
        weakestAssumption: "",
        credibleCounterview: "",
        questionForYou: "",
      }),
    ).rejects.toThrow("Article unavailable");
    await expect(
      g.t.mutation(internal.annotations.replaceForArticle, {
        articleId: g.articleId,
        userId: g.libraryId,
        notes: [],
        reflection: {
          strongestPoint: "late",
          weakestAssumption: "",
          credibleCounterview: "",
          questionForYou: "",
        },
      }),
    ).rejects.toThrow("Article not found");
    await expect(
      g.t.mutation(internal.summaries.saveOverview, {
        articleId: g.articleId,
        userId: g.libraryId,
        thesis: "late",
        gist: "late",
        model: "fixture",
      }),
    ).rejects.toThrow("Article not found");
    expect(
      await g.t.mutation(internal.summaries.save, {
        articleId: g.articleId,
        userId: g.libraryId,
        gist: "late",
        thesis: "late",
        ideas: [],
        links: [],
        flow: "late",
        model: "fixture",
      }),
    ).toBeNull();
    // Legacy clear callbacks see the missing source before collecting children.
    await g.t.mutation(internal.reflections.deleteByArticle, {
      articleId: g.articleId,
    });
    await g.t.mutation(internal.annotations.deleteByArticle, {
      articleId: g.articleId,
    });
    expect(
      await g.client.query(api.reflections.getByArticle, {
        articleId: g.articleId,
      }),
    ).toBeNull();
    await g.finish();
    expect(
      await g.t.run((ctx) => ctx.db.query("reflections").first()),
    ).toBeNull();
  });

  it("an old cleanup token cannot touch a reimport of the same URL under a new source identity", async () => {
    const f = await fixture();
    await f.reflection(undefined, true);
    await f.remove();
    await f.prove();
    const oldJob = await f.job();
    if (!oldJob) throw new Error("Missing cleanup claim");
    const replacement = await f.t.run(async (ctx) => {
      const db = metadataTriggers.wrapDB(ctx).db;
      const articleId = await db.insert("articles", {
        userId: f.libraryId,
        title: "Reimport",
        guid: "fixture",
        url: "https://example.com/article",
        extractionStatus: "extracted",
        annotationStatus: "annotated",
        createdAt: 2,
      });
      const reflectionId = await db.insert("reflections", {
        articleId,
        userId: f.libraryId,
        strongestPoint: "new",
        weakestAssumption: "",
        credibleCounterview: "",
        questionForYou: "",
        userResponse: "private",
        createdAt: 2,
      });
      return { articleId, reflectionId };
    });
    await f.finish();
    await f.t.mutation(internal.feedRemovalCleanup.discard, {
      jobId: oldJob._id,
    });
    expect(await f.job()).toBeNull();
    expect(
      await f.t.run((ctx) => ctx.db.get(replacement.articleId)),
    ).not.toBeNull();
    expect(
      await f.t.run((ctx) => ctx.db.get(replacement.reflectionId)),
    ).toMatchObject({ userResponse: "private" });
  });

  it("observes a new personal mark and never cleans up a retained or transferred parent", async () => {
    const f = await fixture();
    await f.reflection();
    await f.remove();
    const mark = await f.client.mutation(api.highlights.create, {
      articleId: f.articleId,
      kind: "highlight",
      text: "mine",
    });
    await f.finish();
    expect(await f.source()).not.toBeNull();
    expect(await f.t.run((ctx) => ctx.db.get(mark))).toMatchObject({
      text: "mine",
    });
    const jobId = await f.t.run((ctx) =>
      ctx.db.insert("feedArticleCleanup", {
        userId: f.libraryId,
        articleId: f.articleId,
        phase: "reflections",
      }),
    );
    await f.t.mutation(internal.feedRemovalCleanup.discard, { jobId });
    expect(
      await f.t.run((ctx) => ctx.db.query("reflections").first()),
    ).not.toBeNull();
    await f.t.run((ctx) =>
      metadataTriggers
        .wrapDB(ctx)
        .db.patch(f.articleId, { userId: "other-library" }),
    );
    await f.t.mutation(internal.feedRemovalCleanup.prepare, {
      jobId,
    });
    await f.finish();
    expect((await f.source())?.userId).toBe("other-library");
    await f.t.mutation(internal.feedRemovalCleanup.discard, { jobId });
    expect(
      await f.t.run((ctx) => ctx.db.query("reflections").first()),
    ).not.toBeNull();
  });

  it("generic insert/patch/replace never add eligibility fields or create proof rows for stable sources", async () => {
    const f = await fixture();
    const id = await f.reflection("", true);
    for (const userResponse of ["", undefined, "private"] as const) {
      await f.t.run((ctx) =>
        metadataTriggers.wrapDB(ctx).db.patch(id, {
          userResponse,
        }),
      );
      const row = await f.t.run((ctx) => ctx.db.get(id));
      expect(row?.userResponse).toBe(userResponse);
      expect(row).not.toHaveProperty("responsePresent");
      expect(await f.job()).toBeNull();
    }
    await f.t.run(async (ctx) => {
      const row = await ctx.db.get(id);
      if (!row) throw new Error("Missing fixture reflection");
      const { _id, _creationTime, ...fields } = row;
      await metadataTriggers
        .wrapDB(ctx)
        .db.replace(_id, { ...fields, userResponse: "" });
    });
    expect((await f.t.run((ctx) => ctx.db.get(id)))?.userResponse).toBe("");
    expect(await f.job()).toBeNull();
    expect(
      await f.t.run((ctx) => ctx.db.query("feedArticleCleanup").first()),
    ).toBeNull();
  });

  it("finds a final empty response beyond 4,000 compact unanswered rows without a scan cap", async () => {
    const f = await fixture();
    for (let batch = 0; batch < 8; batch++)
      await f.t.run(async (ctx) => {
        const db = metadataTriggers.wrapDB(ctx).db;
        for (let i = 0; i < 500; i++)
          await db.insert("reflections", {
            articleId: f.articleId,
            userId: f.libraryId,
            strongestPoint: "",
            weakestAssumption: "",
            credibleCounterview: "",
            questionForYou: "",
            createdAt: 1,
          });
      });
    const last = await f.reflection("", true);
    await f.remove();
    const metrics = await f.prove();
    if (!metrics) throw new Error("Missing completed proof metrics");
    expect(metrics.documentsRead.used).toBeLessThan(100);
    expect(await f.source()).not.toBeNull();
    expect((await f.t.run((ctx) => ctx.db.get(last)))?.userResponse).toBe("");
  });

  it("retains old queued cursor/count arguments, exact Reader order and 3500 ms increments without making a Reader call", async () => {
    const f = await fixture();
    await f.t.run((ctx) =>
      metadataTriggers
        .wrapDB(ctx)
        .db.patch(f.articleId, { readerDocumentId: "reader-1" }),
    );
    for (const readerDocumentId of ["reader-2", "reader-3"])
      await f.t.run(async (ctx) => {
        const articleId = await metadataTriggers
          .wrapDB(ctx)
          .db.insert("articles", {
            userId: f.libraryId,
            feedId: f.feedId,
            guid: readerDocumentId,
            title: readerDocumentId,
            url: `https://example.com/${readerDocumentId}`,
            readerDocumentId,
            extractionStatus: "extracted",
            annotationStatus: "annotated",
            createdAt: 1,
          });
        await ctx.db.insert("reflections", {
          articleId,
          userId: f.libraryId,
          strongestPoint: "Reader question",
          weakestAssumption: "",
          credibleCounterview: "",
          questionForYou: "",
          createdAt: 1,
        });
      });
    // Force the old argument shape through the new lazy-classification seam.
    await f.reflection();
    const old = { ...f.args, readerDeletes: 2 };
    await f.t.mutation(internal.feeds.removeArticles, old);
    // Duplicate legacy delivery joins the same owned proof.
    await f.t.mutation(internal.feeds.removeArticles, old);
    await f.prove();
    for (let count = 3; count <= 4; count++) {
      const jobs = await f.t.run((ctx) =>
        ctx.db.system.query("_scheduled_functions").take(100),
      );
      const job = jobs.find(
        (job) =>
          job.name === "feeds:removeArticles" &&
          job.args[0]?.readerDeletes === count,
      );
      const queued = z
        .object({ cursor: z.string(), readerDeletes: z.literal(count) })
        .parse(job?.args[0]);
      await f.t.mutation(internal.feeds.removeArticles, { ...old, ...queued });
      const proof = (
        await f.t.run((ctx) => ctx.db.query("feedArticleCleanup").take(10))
      ).find((row) => row.phase === "checking");
      if (!proof) throw new Error("Missing next source proof");
      await proveArticleRemoval(f.t, proof.articleId);
    }
    // Replaying old callbacks cannot schedule another delete for an absent ID.
    await f.t.mutation(internal.feeds.removeArticles, old);
    const jobs = await f.t.run((ctx) =>
      ctx.db.system.query("_scheduled_functions").take(100),
    );
    const deletes = jobs.filter(
      (job) => job.name === "actions/readwiseSync:deleteReaderDocument",
    );
    expect(deletes.map((job) => job.args[0])).toEqual([
      { userId: f.libraryId, readerDocumentId: "reader-1" },
      { userId: f.libraryId, readerDocumentId: "reader-2" },
      { userId: f.libraryId, readerDocumentId: "reader-3" },
    ]);
    expect(deletes.map((job) => job.scheduledTime - Date.now())).toEqual([
      7_000, 10_500, 14_000,
    ]);
    // Do not drain: these are intentionally only inspected scheduler records.
  });
});
