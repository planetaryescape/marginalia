/// <reference types="vite/client" />
import { afterEach, describe, expect, it, vi } from "vitest";
import { secondReaderTest } from "../test/owner";
import { selection } from "../test/scriptureStudy";
import { api, internal } from "./_generated/api";
import * as aiModels from "./lib/aiModels";
import {
  detachKeepArticleReferences,
  purgeScriptureKeeps,
} from "./scriptureKeeps";

const modules = import.meta.glob("./**/*.ts");
const WEB_SOURCE = {
  id: "web",
  title: "World English Bible",
  revision: "fixture",
  rights: "Public domain",
  licenseUrl: "https://example.test/license",
  attribution: "World English Bible",
  url: "https://example.test/bible",
  capabilities: ["passage"],
};

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function fixture() {
  const { t, owner, reader, readerLibraryId } = await secondReaderTest(modules);
  await owner.mutation(api.bible.setPreferences, {
    enabled: true,
    scope: "bible",
  });
  const articleId = await owner.run((ctx) =>
    ctx.db.insert("articles", {
      userId: "default_user",
      guid: "keeps-source",
      url: "https://example.test/source",
      title: "John 1",
      content: "1:1 Public WEB verse one\n\n1:2 Public WEB verse two",
      extractionStatus: "extracted",
      annotationStatus: "annotated",
      bible: {
        reference: "John 1",
        translation: "web",
        copyright: "Public domain",
      },
      createdAt: Date.now(),
    }),
  );
  const annotationId = await owner.run((ctx) =>
    ctx.db.insert("annotations", {
      userId: "default_user",
      articleId,
      type: "cross_reference",
      anchorText: "verse one",
      anchorStartOffset: 0,
      anchorEndOffset: 9,
      content: "Compare Psalm 23 for comfort and rest.",
      relevanceScore: 1,
      wasViewed: false,
      wasDismissed: false,
      createdAt: Date.now(),
    }),
  );
  return { t, owner, reader, readerLibraryId, articleId, annotationId };
}

async function addPublishedStudy(
  owner: Awaited<ReturnType<typeof fixture>>["owner"],
  articleId: Awaited<ReturnType<typeof fixture>>["articleId"],
) {
  return owner.run(async (ctx) => {
    const studyId = await ctx.db.insert("scriptureStudies", {
      userId: "default_user",
      articleId,
      selection,
      scopeKey: "fixture-scope",
      sourceHash: "source-hash",
      modelPolicyHash: "policy-hash",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    const runId = await ctx.db.insert("scriptureStudyRuns", {
      userId: "default_user",
      articleId,
      studyId,
      requestKey: "fixture-run",
      status: "complete",
      leaseUntil: Date.now(),
      createdAt: Date.now(),
      finishedAt: Date.now(),
      sourceHash: "source-hash",
      modelPolicyHash: "policy-hash",
      credentialHash: "credential-hash",
      version: "fixture",
      sourcePolicy: "fixture",
      modelId: "fixture-model",
      outcome: "findings",
      evidence: [
        {
          evidenceId: "web-psalm-23",
          source: WEB_SOURCE,
          locator: "Psalms 23",
          referenceKey: "PSA.23",
          excerpt: "A public WEB passage.",
          contentHash: "evidence-hash",
          retrievedAt: Date.now(),
          limitations: [],
        },
      ],
    });
    await ctx.db.patch(studyId, { publishedRunId: runId });
    await ctx.db.insert("scriptureStudyFindings", {
      userId: "default_user",
      articleId,
      runId,
      order: 0,
      finding: {
        findingId: "rest-shepherd",
        lens: "literary",
        anchor: {
          verseId: "JHN.1.1",
          referenceKey: selection.referenceKey,
          quote: "Public WEB verse one",
        },
        observation: "A repeated image links the passage to another reading.",
        consequence: "Compare the image in its wider context.",
        interpretations: [],
        evidenceIds: ["web-psalm-23"],
        limitations: [],
        relatedPassages: [
          {
            evidenceId: "web-psalm-23",
            referenceKey: "PSA.23",
            relation: "thematic_parallel",
            explanation:
              "The shepherd image offers a related perspective on rest.",
          },
        ],
      },
    });
    return runId;
  });
}

describe("Scripture Keeps public lifecycle", () => {
  it("retains why-kept provenance through deduplication and cools down only presented passages", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-27T12:00:00Z"));
    const f = await fixture();
    await f.owner.run((ctx) =>
      ctx.db.patch(f.annotationId, {
        content:
          "Compare John 10:11, Matthew 5-7 and Psalms 23 for these connections.",
      }),
    );
    for (const referenceKey of ["JHN.10.11", "MAT.5-MAT.7", "PSA.23"]) {
      vi.setSystemTime(Date.now() + 1000);
      await f.owner.mutation(api.scriptureKeeps.keep, {
        annotationId: f.annotationId,
        referenceKey,
      });
    }
    const result = await f.owner.action(api.actions.bible.suggest, {
      question: "15 minutes",
    });
    expect(result.passages.map((item) => item.reference)).not.toContain(
      "John 10:11",
    );
    expect(
      result.passages.find((item) => item.reference === "Matthew 5-7")?.reason,
    ).toContain("You kept this while reading John 1");
    const hidden = await f.owner.run((ctx) =>
      ctx.db
        .query("scriptureKeeps")
        .withIndex("by_userId_and_referenceKey", (q) =>
          q.eq("userId", "default_user").eq("referenceKey", "JHN.10.11"),
        )
        .unique(),
    );
    expect(hidden?.lastOfferedAt).toBeUndefined();
  });
  it("keeps only owned verified WEB study citations, without provider calls, and is idempotent", async () => {
    const f = await fixture();
    const runId = await addPublishedStudy(f.owner, f.articleId);
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const generate = vi.spyOn(aiModels, "generateObjectWithFallback");
    const input = { runId, findingId: "rest-shepherd", referenceKey: "PSA.23" };
    const [a, b] = await Promise.all([
      f.owner.mutation(api.scriptureKeeps.keep, input),
      f.owner.mutation(api.scriptureKeeps.keep, input),
    ]);
    expect(a.keepId).toBe(b.keepId);
    expect(fetch).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    await expect(
      f.t.mutation(api.scriptureKeeps.keep, input),
    ).rejects.toThrow();
    expect(await f.owner.query(api.scriptureKeeps.count, {})).toBe(1);
    await expect(
      f.reader.mutation(api.scriptureKeeps.keep, input),
    ).rejects.toThrow();
    await expect(
      f.owner.mutation(api.scriptureKeeps.keep, {
        ...input,
        referenceKey: "JHN.2.3",
      }),
    ).rejects.toThrow("verified citation");
    await expect(
      f.owner.mutation(api.scriptureKeeps.keep, {
        ...input,
        referenceKey: "JHN.1.1-JHN.1.2",
      }),
    ).rejects.toThrow("verified citation");
    const page = await f.owner.query(api.scriptureKeeps.page, {
      paginationOpts: { numItems: 20, cursor: null },
    });
    expect(page.page[0].origins[0].reason).toContain(
      "related perspective on rest",
    );
    await f.owner.mutation(api.scriptureKeeps.remove, { keepId: a.keepId });
    const rekept = await f.owner.mutation(api.scriptureKeeps.keep, input);
    expect(rekept.keepId).not.toBe(a.keepId);
    const studyId = await f.owner.run(async (ctx) => {
      const run = await ctx.db.get(runId);
      if (!run) throw new Error("Study run fixture was not saved");
      return run.studyId;
    });
    await f.owner.run((ctx) =>
      ctx.db.patch(studyId, { publishedRunId: undefined }),
    );
    await expect(
      f.owner.mutation(api.scriptureKeeps.keep, input),
    ).rejects.toThrow("latest owned study");
  });

  it("accepts only an active owned margin citation and keeps the exact range as a distinct reference", async () => {
    const f = await fixture();
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const kept = await f.owner.mutation(api.scriptureKeeps.keep, {
      annotationId: f.annotationId,
      referenceKey: "PSA.23",
    });
    await expect(
      f.owner.mutation(api.scriptureKeeps.keep, {
        annotationId: f.annotationId,
        referenceKey: "PSA.24",
      }),
    ).rejects.toThrow("not cited");
    const rangeAnnotationId = await f.owner.run((ctx) =>
      ctx.db.insert("annotations", {
        userId: "default_user",
        articleId: f.articleId,
        type: "cross_reference",
        anchorText: "verse one",
        anchorStartOffset: 0,
        anchorEndOffset: 9,
        content: "Compare Psalm 23:1-2 for comfort.",
        relevanceScore: 1,
        wasViewed: false,
        wasDismissed: false,
        createdAt: Date.now(),
      }),
    );
    await f.owner.mutation(api.scriptureKeeps.keep, {
      annotationId: rangeAnnotationId,
      referenceKey: "PSA.23.1-PSA.23.2",
    });
    expect(await f.owner.query(api.scriptureKeeps.count, {})).toBe(2);
    expect(fetch).not.toHaveBeenCalled();
    expect(kept.kept).toBe(true);
  });

  it("offers a kept passage with its reason, honors cooldown and finished targets, and reopens through the ordinary action", async () => {
    vi.useFakeTimers();
    const f = await fixture();
    await f.owner.mutation(api.scriptureKeeps.keep, {
      annotationId: f.annotationId,
      referenceKey: "PSA.23",
    });
    const suggested = await f.owner.action(api.actions.bible.suggest, {
      question: "rest",
    });
    expect(suggested.passages[0]).toMatchObject({
      reference: "Psalms 23",
      reason: expect.stringContaining("kept this while reading John 1"),
    });
    expect(suggested.notice).toContain("Connect an AI provider");
    expect(
      await f.owner.action(api.actions.bible.suggest, {
        question: "Psalms 23",
      }),
    ).toMatchObject({
      passages: [{ reference: "Psalms 23", reason: "Open this Bible passage" }],
      notice: null,
    });
    await f.owner.run(async (ctx) => {
      const keep = await ctx.db
        .query("scriptureKeeps")
        .withIndex("by_userId_and_referenceKey", (q) =>
          q.eq("userId", "default_user").eq("referenceKey", "PSA.23"),
        )
        .unique();
      if (!keep) throw new Error("Keep fixture was not saved");
      await ctx.db.patch(keep._id, {
        lastOfferedAt: Date.now() - 2 * 24 * 60 * 60 * 1000,
      });
    });
    const timed = await f.owner.action(api.actions.bible.suggest, {
      question: "15 minutes",
    });
    expect(timed.passages[0]).toMatchObject({
      reference: "Psalms 23",
      reason: expect.stringContaining("kept this while reading John 1"),
    });
    const targetArticleId = await f.owner.run((ctx) =>
      ctx.db.insert("articles", {
        userId: "default_user",
        guid: "bible:web:Psalms 23",
        url: "https://bible-api.com/data/web/PSA/23",
        title: "Psalms 23",
        content: "23:1 text",
        estimatedReadMinutes: 2,
        extractionStatus: "extracted",
        annotationStatus: "annotated",
        bible: {
          reference: "Psalms 23",
          translation: "web",
          copyright: "Public domain",
        },
        createdAt: Date.now(),
      }),
    );
    const opened = await f.owner.action(api.actions.bible.openReading, {
      reference: "Psalms 23",
    });
    expect(opened).toBe(targetArticleId);
    expect(
      (
        await f.owner.query(internal.scriptureKeeps.candidates, {
          userId: "default_user",
          topic: "rest",
        })
      ).length,
    ).toBe(0);
    const alternativeEditionId = await f.owner.run(async (ctx) => {
      const keep = await ctx.db
        .query("scriptureKeeps")
        .withIndex("by_userId_and_referenceKey", (q) =>
          q.eq("userId", "default_user").eq("referenceKey", "PSA.23"),
        )
        .unique();
      if (!keep) throw new Error("Keep fixture was not saved");
      const elapsed = Date.now() - 8 * 24 * 60 * 60 * 1000;
      await ctx.db.patch(keep._id, {
        lastOpenedAt: elapsed,
        lastOfferedAt: elapsed,
      });
      return ctx.db.insert("articles", {
        userId: "default_user",
        guid: "bible:web:Psalms 23:display:111",
        url: "https://example.test/licensed-reading",
        title: "Psalms 23 (another edition)",
        content: "Private fixture body",
        extractionStatus: "extracted",
        annotationStatus: "annotated",
        bible: {
          reference: "Psalms 23",
          translation: "web",
          copyright: "Fixture",
          displayVersionId: 111,
        },
        finishedAt: Date.now(),
        createdAt: Date.now(),
      });
    });
    expect(
      (
        await f.owner.query(internal.scriptureKeeps.candidates, {
          userId: "default_user",
          topic: "rest",
        })
      ).length,
    ).toBe(0);
    await f.owner.mutation(api.articles.restore, {
      articleId: alternativeEditionId,
    });
    expect(
      (
        await f.owner.query(internal.scriptureKeeps.candidates, {
          userId: "default_user",
          topic: "rest",
        })
      ).length,
    ).toBe(1);
    const startedAt = Date.now() - 120_000;
    await f.owner.mutation(api.readingActivity.checkpoint, {
      articleId: targetArticleId,
      visitId: "170d1ba0-28c2-44b1-9d97-c9f9bc9e944e",
      day: new Date(startedAt).toISOString().slice(0, 10),
      startedAt,
      updatedAt: Date.now(),
      activeTimeMs: 50_000,
      visibleTimeMs: 50_000,
      timeSpentMs: 50_000,
      maxScrollPercent: 96,
      annotationsOpened: [],
    });
    expect(
      (
        await f.owner.query(internal.scriptureKeeps.candidates, {
          userId: "default_user",
          topic: "rest",
        })
      ).length,
    ).toBe(0);
    await f.owner.mutation(api.articles.restore, {
      articleId: targetArticleId,
    });
    expect(
      (
        await f.owner.query(internal.scriptureKeeps.candidates, {
          userId: "default_user",
          topic: "rest",
        })
      ).length,
    ).toBe(1);
  });

  it("excludes Keeps from article-only and opted-out recommendations", async () => {
    const f = await fixture();
    await f.owner.mutation(api.scriptureKeeps.keep, {
      annotationId: f.annotationId,
      referenceKey: "PSA.23",
    });
    await f.owner.mutation(api.bible.setPreferences, {
      enabled: true,
      scope: "articles",
    });
    expect(
      await f.owner.query(internal.scriptureKeeps.candidates, {
        userId: "default_user",
        topic: "rest",
      }),
    ).toEqual([]);
    expect(
      (
        await f.owner.query(api.scriptureKeeps.page, {
          paginationOpts: { numItems: 20, cursor: null },
        })
      ).page,
    ).toHaveLength(1);
    await f.owner.mutation(api.bible.setPreferences, { enabled: false });
    expect(await f.owner.query(api.scriptureKeeps.count, {})).toBe(0);
    await expect(
      f.owner.mutation(api.scriptureKeeps.keep, {
        annotationId: f.annotationId,
        referenceKey: "PSA.23",
      }),
    ).rejects.toThrow();
  });

  it("purges keeps and their origins in bounded batches, and detaches deleted article links", async () => {
    const f = await fixture();
    await f.owner.mutation(api.scriptureKeeps.keep, {
      annotationId: f.annotationId,
      referenceKey: "PSA.23",
    });
    const keep = await f.owner.run((ctx) =>
      ctx.db.query("scriptureKeeps").first(),
    );
    if (!keep) throw new Error("Keep fixture was not saved");
    const targetArticleId = await f.owner.run((ctx) =>
      ctx.db.insert("articles", {
        userId: "default_user",
        guid: "bible:web:Psalms 23",
        url: "https://example.test/target",
        title: "Psalms 23",
        content: "23:1 text",
        extractionStatus: "extracted",
        annotationStatus: "annotated",
        bible: {
          reference: "Psalms 23",
          translation: "web",
          copyright: "Public domain",
        },
        createdAt: Date.now(),
      }),
    );
    await f.owner.mutation(internal.scriptureKeeps.opened, {
      userId: "default_user",
      articleId: targetArticleId,
    });
    await f.owner.run(async (ctx) => {
      await ctx.db.delete(f.articleId);
      await ctx.db.delete(targetArticleId);
    });
    await f.owner.run(async (ctx) => {
      const result = await detachKeepArticleReferences(
        ctx,
        "default_user",
        f.articleId,
      );
      expect(result).toBe(true);
    });
    await f.owner.run(async (ctx) => {
      const result = await detachKeepArticleReferences(
        ctx,
        "default_user",
        targetArticleId,
      );
      expect(result).toBe(true);
    });
    const page = await f.owner.query(api.scriptureKeeps.page, {
      paginationOpts: { numItems: 20, cursor: null },
    });
    expect(page.page[0].origins[0].sourceArticleId).toBeNull();
    expect(page.page[0]).not.toHaveProperty("targetArticleId");
    expect(await f.owner.run((ctx) => ctx.db.get(keep._id))).not.toHaveProperty(
      "targetArticleId",
    );
    await f.owner.run(async (ctx) => {
      expect(await purgeScriptureKeeps(ctx, "default_user")).toBe(1);
      expect(await purgeScriptureKeeps(ctx, "default_user")).toBe(1);
      expect(await purgeScriptureKeeps(ctx, "default_user")).toBe(0);
    });
    expect(await f.owner.query(api.scriptureKeeps.count, {})).toBe(0);
  });
});
