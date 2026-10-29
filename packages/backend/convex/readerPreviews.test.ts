/// <reference types="vite/client" />
import { expect, it } from "vitest";
import { ownerTest, secondReaderTest } from "../test/owner";
import { api, internal } from "./_generated/api";
import {
  assertBytes,
  NOTE_HTML_BYTES,
  validateNote,
  validateTranscript,
} from "./lib/readerBodies";

const modules = import.meta.glob("./**/*.ts");
async function fixture() {
  const f = await secondReaderTest(modules);
  const articleId = await f.t.run((ctx) =>
    ctx.db.insert("articles", {
      userId: "default_user",
      guid: "lean",
      url: "https://example.com/lean",
      title: "Lean",
      extractionStatus: "extracted",
      annotationStatus: "annotated",
      createdAt: 1,
    }),
  );
  return { ...f, articleId };
}

it("keeps an indexed answer beyond 200 old rows, upgrades a late legacy row and separates units", async () => {
  const { t, owner, articleId } = await fixture();
  const legacyId = await t.run(async (ctx) => {
    for (let i = 0; i < 210; i++)
      await ctx.db.insert("companionThreads", {
        articleId,
        userId: "default_user",
        answerId: `old-${i}`,
        mode: "explain",
        selection: "same",
        turns: [],
        createdAt: i,
        updatedAt: i,
      });
    return ctx.db.insert("companionThreads", {
      articleId,
      userId: "default_user",
      mode: "explain",
      selection: "legacy",
      turns: [],
      createdAt: 211,
      updatedAt: 211,
    });
  });
  const args = {
    articleId,
    answerId: "last-answer",
    mode: "explain" as const,
    selection: "same",
    turns: [{ role: "assistant" as const, content: "An answer" }],
  };
  const first = await owner.mutation(api.companionThreads.keep, args);
  const jobsBeforeRetry = await t.run((ctx) =>
    ctx.db.system.query("_scheduled_functions").take(50),
  );
  expect(await owner.mutation(api.companionThreads.keep, args)).toBe(first);
  expect(
    await t.run((ctx) => ctx.db.system.query("_scheduled_functions").take(50)),
  ).toEqual(jobsBeforeRetry);
  expect(
    await owner.mutation(api.companionThreads.keep, {
      ...args,
      answerId: "legacy",
      legacyId,
    }),
  ).toBe(legacyId);
  const otherUnit = await owner.mutation(api.companionThreads.keep, {
    ...args,
    unitIndex: 0,
  });
  expect(otherUnit).not.toBe(first);
  const ids = await Promise.all(
    Array.from({ length: 4 }, () =>
      owner.mutation(api.companionThreads.keep, {
        ...args,
        answerId: "parallel",
      }),
    ),
  );
  expect(new Set(ids).size).toBe(1);
  expect(
    await t.run((ctx) =>
      ctx.db
        .query("companionThreads")
        .withIndex("by_article", (q) => q.eq("articleId", articleId))
        .collect()
        .then((rows) => rows.filter((row) => row.answerId === "parallel")),
    ),
  ).toHaveLength(1);
});

it("does not adopt another article's or reader's legacy answer and rejects missing articles", async () => {
  const { t, owner, reader, articleId } = await fixture();
  // No extraction action is needed: direct fixture writes stay isolated from providers.
  const legacyId = await t.run((ctx) =>
    ctx.db.insert("companionThreads", {
      articleId,
      userId: "other-reader",
      mode: "ask",
      selection: "private",
      turns: [],
      createdAt: 1,
      updatedAt: 1,
    }),
  );
  const args = {
    articleId,
    answerId: "safe",
    legacyId,
    mode: "ask" as const,
    selection: "mine",
    turns: [],
  };
  const kept = await owner.mutation(api.companionThreads.keep, args);
  expect(kept).not.toBe(legacyId);
  const otherArticleId = await t.run((ctx) =>
    ctx.db.insert("articles", {
      userId: "default_user",
      guid: "other",
      url: "https://example.com/other",
      title: "Other",
      extractionStatus: "extracted",
      annotationStatus: "annotated",
      createdAt: 1,
    }),
  );
  const ownOtherArticleLegacy = await t.run((ctx) =>
    ctx.db.insert("companionThreads", {
      articleId: otherArticleId,
      userId: "default_user",
      mode: "ask",
      selection: "elsewhere",
      turns: [],
      createdAt: 1,
      updatedAt: 1,
    }),
  );
  expect(
    await owner.mutation(api.companionThreads.keep, {
      ...args,
      answerId: "other-article-legacy",
      legacyId: ownOtherArticleLegacy,
    }),
  ).not.toBe(ownOtherArticleLegacy);
  await expect(
    reader.mutation(api.companionThreads.keep, args),
  ).rejects.toThrow("Article not found");
  await t.run((ctx) => ctx.db.delete(articleId));
  await expect(owner.mutation(api.companionThreads.keep, args)).rejects.toThrow(
    "Article not found",
  );
  expect(
    await reader.query(api.companionThreads.getBody, { threadId: kept }),
  ).toBeNull();
});

it("finds a legacy word occurrence beyond 200, including absent unit, without collapsing passages or parts", async () => {
  const { t, owner, articleId } = await fixture();
  const last = await t.run(async (ctx) => {
    for (let i = 0; i < 210; i++)
      await ctx.db.insert("lookups", {
        userId: "default_user",
        articleId,
        word: "bass",
        wordKey: "bass",
        sentence: "bass and bass",
        paragraphIndex: i,
        occurrence: 0,
        sense: "old",
        createdAt: i,
      });
    return ctx.db.insert("lookups", {
      userId: "default_user",
      articleId,
      word: "bass",
      wordKey: "bass",
      sentence: "bass and bass",
      paragraphIndex: 999,
      occurrence: 1,
      sense: "last",
      createdAt: 999,
    });
  });
  const args = {
    articleId,
    word: "Bass,",
    sentence: "bass and bass",
    paragraphIndex: 999,
    occurrence: 1,
    sense: "new",
  };
  expect(await owner.mutation(api.lookups.record, args)).toBe(last);
  const part = await owner.mutation(api.lookups.record, {
    ...args,
    unitIndex: 0,
  });
  expect(part).not.toBe(last);
  expect(
    await owner.mutation(api.lookups.record, { ...args, unitIndex: 0 }),
  ).toBe(part);
  expect(
    await owner.mutation(api.lookups.record, { ...args, occurrence: 0 }),
  ).not.toBe(last);
  expect(
    await owner.mutation(api.lookups.record, {
      ...args,
      sentence: "different bass",
    }),
  ).not.toBe(last);
  const parallel = await Promise.all(
    Array.from({ length: 3 }, () =>
      owner.mutation(api.lookups.record, { ...args, paragraphIndex: 500 }),
    ),
  );
  expect(new Set(parallel).size).toBe(1);
  const unicodeId = await owner.mutation(api.lookups.record, {
    ...args,
    word: "😀".repeat(200),
    sentence: "😀".repeat(1000),
  });
  const unicode = await t.run((ctx) => ctx.db.get(unicodeId));
  expect(unicode?.word.endsWith("…")).toBe(true);
  expect(unicode?.word).not.toMatch(/[\uD800-\uDBFF]…$/);
  await expect(
    owner.mutation(api.lookups.record, { ...args, unitIndex: Number.NaN }),
  ).rejects.toThrow("Invalid unit");
});

it("paginates exact unit previews without HTML, vectors, operational fields or transcripts; hydrates only owned bodies", async () => {
  const { t, owner, reader, articleId } = await fixture();
  const ids = await t.run(async (ctx) => {
    const ids = [];
    for (let i = 0; i < 4; i++)
      ids.push(
        await ctx.db.insert("userNotes", {
          articleId,
          userId: "default_user",
          selectedText: "anchor",
          content: `<p>${i} private HTML</p>`,
          contentPlain: `${i} ${"😀".repeat(500)}`,
          embedding: Array(1536).fill(1),
          createdAt: i,
          updatedAt: i,
        }),
      );
    await ctx.db.insert("userNotes", {
      articleId,
      userId: "default_user",
      unitIndex: 0,
      selectedText: "unit",
      content: "unit body",
      contentPlain: "unit body",
      createdAt: 99,
      updatedAt: 99,
    });
    return ids;
  });
  const first = await owner.query(api.userNotes.listPreviewsByArticle, {
    articleId,
    paginationOpts: { numItems: 2, cursor: null },
  });
  expect(first.page).toHaveLength(2);
  expect(first.isDone).toBe(false);
  expect(first.page[0]).not.toHaveProperty("content");
  expect(first.page[0]).not.toHaveProperty("embedding");
  expect(first.page[0]).not.toHaveProperty("userId");
  expect(Array.from(first.page[0].contentPlain)).toHaveLength(361);
  const next = await owner.query(api.userNotes.listPreviewsByArticle, {
    articleId,
    paginationOpts: { numItems: 2, cursor: first.continueCursor },
  });
  expect(
    new Set([...first.page, ...next.page].map((row) => row._id)).size,
  ).toBe(4);
  expect(next.isDone).toBe(true);
  expect(
    await reader.query(api.userNotes.getBody, { noteId: ids[0] }),
  ).toBeNull();
  expect(
    (await owner.query(api.userNotes.getBody, { noteId: ids[0] }))?.content,
  ).toBe("<p>0 private HTML</p>");
  expect(
    (
      await owner.query(api.userNotes.listPreviewsByArticle, {
        articleId,
        unitIndex: 0,
        paginationOpts: { numItems: 25, cursor: null },
      })
    ).page,
  ).toHaveLength(1);
  expect(
    (
      await t.query(internal.userNotes.listByArticleInternal, { articleId })
    ).find((row) => row._id === ids[0])?.embedding,
  ).toHaveLength(1536);
  const markId = await t.run((ctx) =>
    ctx.db.insert("highlights", {
      articleId,
      userId: "default_user",
      kind: "highlight",
      text: "exact anchor",
      embedding: [1, 2],
      createdAt: 1,
    }),
  );
  const marks = await owner.query(api.highlights.listPresentationByArticle, {
    articleId,
    paginationOpts: { numItems: 25, cursor: null },
  });
  expect(marks.page[0].text).toBe("exact anchor");
  expect(marks.page[0]).not.toHaveProperty("embedding");
  expect(
    (
      await t.query(internal.highlights.getByIdInternal, {
        highlightId: markId,
      })
    )?.embedding,
  ).toEqual([1, 2]);
  expect(
    (
      await reader.query(api.highlights.listPresentationByArticle, {
        articleId,
        paginationOpts: { numItems: 25, cursor: null },
      })
    ).page,
  ).toEqual([]);
});

it("preserves legacy copy confirmation as hashes and reads old oversized bodies intact", async () => {
  const { t, owner, articleId } = await fixture();
  const ids = await t.run(async (ctx) => ({
    note: await ctx.db.insert("userNotes", {
      articleId,
      userId: "default_user",
      selectedText: "tarn",
      content: "<h3>Define</h3><p>A small  mountain\nlake.</p>",
      contentPlain: "Define\n\nA small mountain lake.",
      createdAt: 1,
      updatedAt: 1,
    }),
    thread: await ctx.db.insert("companionThreads", {
      articleId,
      userId: "default_user",
      mode: "define",
      selection: "tarn",
      turns: [
        { role: "assistant", content: "A small mountain lake." },
        { role: "user", content: "More?" },
        { role: "assistant", content: "Often glacial." },
      ],
      embedding: [1, 2],
      createdAt: 1,
      updatedAt: 1,
    }),
    oversized: await ctx.db.insert("userNotes", {
      articleId,
      userId: "default_user",
      selectedText: "",
      content: "x".repeat(NOTE_HTML_BYTES + 1),
      contentPlain: "legacy",
      createdAt: 2,
      updatedAt: 2,
    }),
  }));
  const notes = await owner.query(api.userNotes.listPreviewsByArticle, {
    articleId,
    paginationOpts: { numItems: 25, cursor: null },
  });
  const threads = await owner.query(
    api.companionThreads.listPreviewsByArticle,
    { articleId, paginationOpts: { numItems: 25, cursor: null } },
  );
  expect(threads.page[0]).not.toHaveProperty("turns");
  expect(threads.page[0]).not.toHaveProperty("embedding");
  expect(threads.page[0].legacyCopies).toContain(
    notes.page.find((row) => row._id === ids.note)?.legacyCopy,
  );
  // An answer with code-like text matches the escaped copy the old button made
  const code = await t.run(async (ctx) => ({
    note: await ctx.db.insert("userNotes", {
      articleId,
      userId: "default_user",
      selectedText: "generics",
      content: "<h3>Explain</h3><p>Use Array&lt;T&gt; for a list.</p>",
      contentPlain: "Explain\n\nUse Array<T> for a list.",
      createdAt: 3,
      updatedAt: 3,
    }),
    thread: await ctx.db.insert("companionThreads", {
      articleId,
      userId: "default_user",
      mode: "explain",
      selection: "generics",
      turns: [{ role: "assistant", content: "Use Array<T> for a list." }],
      createdAt: 3,
      updatedAt: 3,
    }),
  }));
  const codeNotes = await owner.query(api.userNotes.listPreviewsByArticle, {
    articleId,
    paginationOpts: { numItems: 25, cursor: null },
  });
  const codeThreads = await owner.query(
    api.companionThreads.listPreviewsByArticle,
    { articleId, paginationOpts: { numItems: 25, cursor: null } },
  );
  const codeCopy = codeNotes.page.find(
    (row) => row._id === code.note,
  )?.legacyCopy;
  expect(codeCopy).toBeDefined();
  expect(
    codeThreads.page.find((row) => row._id === code.thread)?.legacyCopies,
  ).toContain(codeCopy);
  const old = await owner.query(api.userNotes.getBody, {
    noteId: ids.oversized,
  });
  expect(old?.content.length).toBe(NOTE_HTML_BYTES + 1);
  expect(old?.legacyOversized).toBe(true);
  expect(
    (await owner.query(api.companionThreads.getBody, { threadId: ids.thread }))
      ?.turns,
  ).toHaveLength(3);
  expect(
    (
      await t.query(internal.companionThreads.getByIdInternal, {
        threadId: ids.thread,
      })
    )?.embedding,
  ).toEqual([1, 2]);
});

it("checks UTF-8 storage limits before writes and keeps common old-client paths valid", async () => {
  expect(() => assertBytes("😀".repeat(4), 16, "fixture")).not.toThrow();
  expect(() => assertBytes("😀".repeat(4), 15, "fixture")).toThrow("UTF-8");
  expect(() =>
    validateNote("x".repeat(NOTE_HTML_BYTES), "plain"),
  ).not.toThrow();
  expect(() =>
    validateTranscript(
      Array.from({ length: 65 }, () => ({ role: "user", content: "small" })),
    ),
  ).toThrow("64 turns");
  const { t, owner, articleId } = await fixture();
  await expect(
    owner.mutation(api.userNotes.create, {
      articleId,
      selectedText: "",
      content: "😀".repeat(NOTE_HTML_BYTES / 4 + 1),
      contentPlain: "plain",
    }),
  ).rejects.toThrow("Note HTML");
  expect(
    await t.run((ctx) => ctx.db.query("userNotes").collect()),
  ).toHaveLength(0);
  await expect(
    owner.mutation(api.companionThreads.create, {
      articleId,
      mode: "ask",
      selection: "",
      turns: [{ role: "assistant", content: "x".repeat(256_000) }],
    }),
  ).rejects.toThrow("Conversation");
  expect(
    await t.run((ctx) => ctx.db.query("companionThreads").collect()),
  ).toHaveLength(0);
  const id = await owner.mutation(api.userNotes.create, {
    articleId,
    selectedText: "",
    content: "<p>A common old-client note.</p>",
    contentPlain: "A common old-client note.",
  });
  expect(
    (await owner.query(api.userNotes.getById, { noteId: id }))?.contentPlain,
  ).toBe("A common old-client note.");
});

it("annotation bookkeeping does not alter presentation", async () => {
  const t = await ownerTest(modules);
  const articleId = await t.run((ctx) =>
    ctx.db.insert("articles", {
      userId: "default_user",
      guid: "annotations",
      url: "https://example.com/a",
      title: "A",
      extractionStatus: "extracted",
      annotationStatus: "annotated",
      createdAt: 1,
    }),
  );
  const annotationId = await t.run((ctx) =>
    ctx.db.insert("annotations", {
      articleId,
      userId: "default_user",
      type: "question",
      anchorText: "anchor",
      anchorStartOffset: 0,
      anchorEndOffset: 6,
      content: "Question?",
      relevanceScore: 1,
      wasViewed: false,
      wasDismissed: false,
      createdAt: 1,
    }),
  );
  const args = { articleId, paginationOpts: { numItems: 25, cursor: null } };
  const before = await t.query(api.annotations.listPresentationByArticle, args);
  await t.mutation(api.annotations.markViewed, { annotationId });
  await t.mutation(api.annotations.markViewed, { annotationId });
  await t.mutation(api.annotations.markDismissed, { annotationId });
  expect(
    await t.query(api.annotations.listPresentationByArticle, args),
  ).toEqual(before);
  expect(before.page[0]).not.toHaveProperty("wasViewed");
});

it("keeps which match was selected and where the passage ends, and hands both back", async () => {
  const { t, owner, articleId } = await fixture();
  const args = {
    articleId,
    answerId: "second-bass",
    mode: "define" as const,
    selection: "bass",
    paragraphIndex: 3,
    occurrence: 1,
    paragraphEnd: 4,
    turns: [{ role: "assistant" as const, content: "A low voice." }],
  };
  const threadId = await owner.mutation(api.companionThreads.keep, args);
  const body = await owner.query(api.companionThreads.getBody, { threadId });
  expect(body).toMatchObject({ occurrence: 1, paragraphEnd: 4 });
  const previews = await owner.query(
    api.companionThreads.listPreviewsByArticle,
    { articleId, paginationOpts: { numItems: 10, cursor: null } },
  );
  expect(previews.page[0]).toMatchObject({ occurrence: 1 });

  // A row kept before occurrences were stored learns them when kept again
  const legacyId = await t.run((ctx) =>
    ctx.db.insert("companionThreads", {
      articleId,
      userId: "default_user",
      mode: "define",
      selection: "bass",
      turns: [],
      createdAt: 1,
      updatedAt: 1,
    }),
  );
  await owner.mutation(api.companionThreads.keep, {
    ...args,
    answerId: "old-bass",
    legacyId,
    occurrence: 2,
  });
  expect(
    await owner.query(api.companionThreads.getBody, { threadId: legacyId }),
  ).toMatchObject({ occurrence: 2, paragraphEnd: 4 });

  // Retrying an unchanged keep still fills in what an older keep left out
  const plain = await owner.mutation(api.companionThreads.keep, {
    ...args,
    answerId: "kept-before-anchors",
    occurrence: undefined,
    paragraphEnd: undefined,
  });
  expect(
    await owner.mutation(api.companionThreads.keep, {
      ...args,
      answerId: "kept-before-anchors",
    }),
  ).toBe(plain);
  expect(
    await owner.query(api.companionThreads.getBody, { threadId: plain }),
  ).toMatchObject({ occurrence: 1, paragraphEnd: 4 });

  await expect(
    owner.mutation(api.companionThreads.keep, {
      ...args,
      answerId: "bad",
      occurrence: -1,
    }),
  ).rejects.toThrow("Invalid occurrence");
});
