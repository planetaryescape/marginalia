/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { secondReaderTest } from "../test/owner";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";

const modules = import.meta.glob("./**/*.ts");
const OWNER = "default_user";

function addArticle(
  ctx: MutationCtx,
  userId: string,
  guid: string,
  fields: Record<string, unknown> = {},
) {
  return ctx.db.insert("articles", {
    userId,
    guid,
    url: `https://example.com/${guid}`,
    title: `Article ${guid}`,
    excerpt: `Excerpt of ${guid}`,
    estimatedReadMinutes: 7,
    extractionStatus: "extracted",
    annotationStatus: "annotated",
    createdAt: Date.now(),
    ...fields,
  });
}

const note = (fields: Record<string, unknown> = {}) => ({
  type: "assumption" as const,
  anchorText: "anchor",
  anchorStartOffset: 0,
  anchorEndOffset: 6,
  content: "A note.",
  relevanceScore: 0.8,
  ...fields,
});

const reflection = {
  strongestPoint: "s",
  weakestAssumption: "w",
  credibleCounterview: "c",
  questionForYou: "q",
};

async function setup() {
  const f = await secondReaderTest(modules);
  const [articleId, other, theirs] = await f.t.run(async (ctx) => [
    await addArticle(ctx, OWNER, "main"),
    await addArticle(ctx, OWNER, "other"),
    await addArticle(ctx, f.readerLibraryId, "theirs"),
  ]);
  return { ...f, articleId, other, theirs };
}

const notesOf = (
  t: Awaited<ReturnType<typeof setup>>["t"],
  articleId: Id<"articles">,
) =>
  t.run((ctx) =>
    ctx.db
      .query("annotations")
      .withIndex("by_article", (q) => q.eq("articleId", articleId))
      .collect(),
  );

describe("annotations.replaceForArticle", () => {
  it("replaces the margin in one go and stamps the version", async () => {
    const f = await setup();
    await f.t.run((ctx) =>
      ctx.db.insert("annotations", {
        ...note({ type: "context", content: "old" }),
        type: "context",
        articleId: f.articleId,
        userId: OWNER,
        wasViewed: false,
        wasDismissed: false,
        createdAt: 1,
      }),
    );
    await f.t.mutation(internal.annotations.replaceForArticle, {
      articleId: f.articleId,
      userId: OWNER,
      notes: [
        note({ type: "fallacy", fallacyName: "false dilemma" }),
        note({ type: "strong_point", anchorText: "second" }),
      ],
      reflection,
    });
    const rows = await notesOf(f.t, f.articleId);
    expect(rows.map((r) => r.type).sort()).toEqual(["fallacy", "strong_point"]);
    expect(rows.find((r) => r.type === "fallacy")?.fallacyName).toBe(
      "false dilemma",
    );
    expect(await f.t.run((ctx) => ctx.db.get(f.articleId))).toMatchObject({
      annotationStatus: "annotated",
      annotationVersion: 2,
    });
  });

  it("keeps a connection to the library's own article and drops one that points elsewhere", async () => {
    const f = await setup();
    await f.t.mutation(internal.annotations.replaceForArticle, {
      articleId: f.articleId,
      userId: OWNER,
      notes: [
        note({ type: "cross_reference", articleRefId: f.other }),
        // Another library's article, with and without a vault note to fall back on
        note({
          type: "cross_reference",
          anchorText: "b",
          articleRefId: f.theirs,
        }),
        note({
          type: "cross_reference",
          anchorText: "c",
          articleRefId: f.theirs,
          notePath: "vault.md",
        }),
        // This article itself
        note({
          type: "cross_reference",
          anchorText: "d",
          articleRefId: f.articleId,
        }),
      ],
      reflection,
    });
    const rows = await notesOf(f.t, f.articleId);
    expect(rows.map((r) => [r.anchorText, r.articleRefId, r.notePath])).toEqual(
      expect.arrayContaining([
        ["anchor", f.other, undefined],
        ["c", undefined, "vault.md"],
      ]),
    );
    expect(rows).toHaveLength(2);
  });

  it("refuses an article from another library", async () => {
    const f = await setup();
    await expect(
      f.t.mutation(internal.annotations.replaceForArticle, {
        articleId: f.theirs,
        userId: OWNER,
        notes: [],
        reflection,
      }),
    ).rejects.toThrow("Article not found");
  });

  it("keeps a reflection the reader has answered, and replaces one they haven't", async () => {
    const f = await setup();
    const reflectionRow = (articleId: Id<"articles">, userResponse?: string) =>
      f.t.run((ctx) =>
        ctx.db.insert("reflections", {
          ...reflection,
          articleId,
          userId: OWNER,
          userResponse,
          createdAt: 1,
        }),
      );
    await reflectionRow(f.articleId, "My answer");
    await reflectionRow(f.other);
    for (const articleId of [f.articleId, f.other])
      await f.t.mutation(internal.annotations.replaceForArticle, {
        articleId,
        userId: OWNER,
        notes: [],
        reflection: { ...reflection, strongestPoint: "new" },
      });
    const reflections = (id: Id<"articles">) =>
      f.t.run((ctx) =>
        ctx.db
          .query("reflections")
          .withIndex("by_article", (q) => q.eq("articleId", id))
          .collect(),
      );
    expect(await reflections(f.articleId)).toMatchObject([
      { strongestPoint: "s", userResponse: "My answer" },
    ]);
    expect(await reflections(f.other)).toMatchObject([
      { strongestPoint: "new" },
    ]);
  });
});

describe("annotations the reader has responded to", () => {
  it("survive a replacement that lands after they answered, and new notes go around them", async () => {
    const f = await setup();
    const [answered, plain] = await f.t.run(async (ctx) => {
      const row = (anchorText: string, start: number) =>
        ctx.db.insert("annotations", {
          articleId: f.articleId,
          userId: OWNER,
          type: "question",
          anchorText,
          anchorStartOffset: start,
          anchorEndOffset: start + anchorText.length,
          content: `old ${anchorText}`,
          relevanceScore: 0.7,
          wasViewed: false,
          wasDismissed: false,
          createdAt: 1,
        });
      const answered = await row("answered", 0);
      const plain = await row("plain", 50);
      // The reader writes this while the new margin is being generated
      await ctx.db.insert("userNotes", {
        userId: OWNER,
        articleId: f.articleId,
        annotationId: answered,
        selectedText: "answered",
        content: "<p>mine</p>",
        contentPlain: "mine",
        createdAt: 2,
        updatedAt: 2,
      });
      return [answered, plain];
    });
    await f.t.mutation(internal.annotations.replaceForArticle, {
      articleId: f.articleId,
      userId: OWNER,
      notes: [
        // Overlaps the answered note's anchor: dropped
        note({
          anchorText: "answered",
          anchorStartOffset: 2,
          anchorEndOffset: 6,
        }),
        note({
          anchorText: "fresh",
          anchorStartOffset: 100,
          anchorEndOffset: 105,
        }),
      ],
      reflection,
    });
    const rows = await notesOf(f.t, f.articleId);
    expect(rows.map((r) => r._id)).toContain(answered);
    expect(rows.map((r) => r._id)).not.toContain(plain);
    expect(rows.map((r) => r.anchorText).sort()).toEqual(["answered", "fresh"]);
    expect(rows.find((r) => r._id === answered)?.content).toBe("old answered");
    expect(
      (await f.t.run((ctx) => ctx.db.get(f.articleId)))?.annotationVersion,
    ).toBe(2);
    // Their note still points at a live annotation
    const userNote = await f.t.run((ctx) => ctx.db.query("userNotes").first());
    expect(userNote?.annotationId).toBe(answered);
  });
});

describe("annotations.referencedArticle", () => {
  async function connect(
    f: Awaited<ReturnType<typeof setup>>,
    to: Id<"articles">,
  ) {
    return f.t.run((ctx) =>
      ctx.db.insert("annotations", {
        ...note({ type: "cross_reference" }),
        type: "cross_reference",
        articleRefId: to,
        articleId: f.articleId,
        userId: OWNER,
        wasViewed: false,
        wasDismissed: false,
        createdAt: 1,
      }),
    );
  }

  it("gives the other article's title, minutes, read state and saved state", async () => {
    const f = await setup();
    const annotationId = await connect(f, f.other);
    expect(
      await f.owner.query(api.annotations.referencedArticle, { annotationId }),
    ).toEqual({
      _id: f.other,
      title: "Article other",
      estimatedReadMinutes: 7,
      read: false,
      saved: false,
    });
    await f.owner.mutation(api.savedArticles.save, { articleId: f.other });
    await f.t.run((ctx) => ctx.db.patch(f.other, { finishedAt: 5 }));
    expect(
      await f.owner.query(api.annotations.referencedArticle, { annotationId }),
    ).toMatchObject({ read: true, saved: true });
  });

  it("gives nothing for a note without an article, another reader's note, or a target outside the library", async () => {
    const f = await setup();
    const plain = await f.t.run((ctx) =>
      ctx.db.insert("annotations", {
        ...note(),
        articleId: f.articleId,
        userId: OWNER,
        wasViewed: false,
        wasDismissed: false,
        createdAt: 1,
      }),
    );
    expect(
      await f.owner.query(api.annotations.referencedArticle, {
        annotationId: plain,
      }),
    ).toBeNull();

    const connected = await connect(f, f.other);
    expect(
      await f.reader.query(api.annotations.referencedArticle, {
        annotationId: connected,
      }),
    ).toBeNull();

    // A stray reference to someone else's article reveals nothing
    const stray = await connect(f, f.theirs);
    expect(
      await f.owner.query(api.annotations.referencedArticle, {
        annotationId: stray,
      }),
    ).toBeNull();
  });
});

describe("annotations.libraryCandidates", () => {
  it("returns only the library's own articles, with a short excerpt", async () => {
    const f = await setup();
    const long = await f.t.run((ctx) =>
      addArticle(ctx, OWNER, "long", {
        excerpt: undefined,
        content: `${"word ".repeat(200)}`,
      }),
    );
    const found = await f.t.query(internal.annotations.libraryCandidates, {
      userId: OWNER,
      articleIds: [f.other, f.theirs, long],
    });
    expect(found.map((c) => c.id).sort()).toEqual([f.other, long].sort());
    expect(
      found.find((c) => c.id === long)?.excerpt.length,
    ).toBeLessThanOrEqual(280);
    expect(found.find((c) => c.id === f.other)).toMatchObject({
      title: "Article other",
      minutes: 7,
    });
  });
});

describe("older margins", () => {
  it("keep listing: rows without the new fields and with the original kinds", async () => {
    const f = await setup();
    await f.t.run(async (ctx) => {
      for (const type of [
        "cross_reference",
        "context",
        "tension",
        "question",
      ] as const)
        await ctx.db.insert("annotations", {
          articleId: f.articleId,
          userId: OWNER,
          type,
          anchorText: "a",
          anchorStartOffset: 0,
          anchorEndOffset: 1,
          content: "c",
          relevanceScore: 0.7,
          wasViewed: false,
          wasDismissed: false,
          createdAt: 1,
        });
    });
    const listed = await f.owner.query(api.annotations.listByArticle, {
      articleId: f.articleId,
    });
    expect(listed).toHaveLength(4);
    expect(listed.every((a) => a.articleRefId === undefined)).toBe(true);
  });
});
