// @vitest-environment node
/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startImport } from "../test/imports";
import { secondReaderTest } from "../test/owner";
import { makePdf } from "../test/pdf";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

const modules = import.meta.glob("./**/*.ts");

// The action schedules marginalia work; these tests look only at the import
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const WORDS = Array.from(
  { length: 400 },
  (_, i) => `w${i.toString(36)}${"aeiou"[i % 5]}x`,
);

/** Page text that never repeats from page to page, so nothing looks like a running header. */
function pageLines(page: number, lines = 30) {
  let seed = page * 7919;
  const next = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return WORDS[seed % WORDS.length];
  };
  return Array.from({ length: lines }, (_, row) => {
    const words = Array.from({ length: 11 }, next).join(" ");
    return row === lines - 1 ? `${words}.` : words;
  });
}

type Fixture = Awaited<ReturnType<typeof secondReaderTest>>;

async function importOf(
  { t, owner }: Fixture,
  bytes: Uint8Array,
  fileName = "Field Guide.pdf",
) {
  const storageId = await t.run((ctx) =>
    ctx.storage.store(
      new Blob([bytes as BlobPart], { type: "application/pdf" }),
    ),
  );
  const started = await startImport(owner, {
    storageId,
    fileName,
  });
  if (!started.ok) throw new Error(started.error);
  await t.action(internal.actions.importPdf.run, {
    importId: started.importId,
  });
  const row = await t.run((ctx) =>
    ctx.db.get("documentImports", started.importId),
  );
  return { storageId, row };
}

const countRows = (f: Fixture) =>
  f.t.run(async (ctx) => ({
    articles: (await ctx.db.query("articles").collect()).length,
    books: (await ctx.db.query("books").collect()).length,
    units: (await ctx.db.query("bookUnits").collect()).length,
  }));

describe("importing a PDF that fits one article", () => {
  it("becomes an article of the reader, with its structure", async () => {
    const f = await secondReaderTest(modules);
    const { row, storageId } = await importOf(
      f,
      makePdf([pageLines(1), pageLines(2), pageLines(3)]),
    );
    expect(row).toMatchObject({ status: "ready", pages: 3 });
    const article = await f.t.run((ctx) =>
      ctx.db.get("articles", row?.articleId as Id<"articles">),
    );
    expect(article).toMatchObject({
      userId: "default_user",
      uploadedFileName: "Field Guide.pdf",
      pageCount: 3,
      title: "Field Guide",
      extractionStatus: "extracted",
    });
    expect(article?.contentHtml).toContain("<p>");
    expect(article?.bookUnitCount).toBeUndefined();
    expect(await countRows(f)).toMatchObject({ articles: 1, books: 0 });
    // The upload is not kept once its text is stored
    expect(
      await f.t.run((ctx) => ctx.db.system.get("_storage", storageId)),
    ).toBeNull();
    // and it is visible to its reader and no one else
    expect(
      await f.owner.query(api.articles.getById, {
        articleId: article?._id as Id<"articles">,
      }),
    ).not.toBeNull();
    expect(
      await f.reader.query(api.articles.getById, {
        articleId: article?._id as Id<"articles">,
      }),
    ).toBeNull();
  });
});

describe("refusing a PDF", () => {
  it("refuses scanned pages with nothing half-imported", async () => {
    const f = await secondReaderTest(modules);
    const { row, storageId } = await importOf(f, makePdf([[], [], []]));
    expect(row).toMatchObject({ status: "failed", failure: "scanned" });
    expect(await countRows(f)).toEqual({ articles: 0, books: 0, units: 0 });
    expect(
      await f.t.run((ctx) => ctx.db.system.get("_storage", storageId)),
    ).toBeNull();
    expect(await f.owner.query(api.documentImports.latest, {})).toMatchObject({
      status: "failed",
      failure: "scanned",
    });
  });

  it("refuses a file that is not a PDF", async () => {
    const f = await secondReaderTest(modules);
    const { row, storageId } = await importOf(
      f,
      new TextEncoder().encode("this is plain text, not a PDF"),
    );
    expect(row).toMatchObject({ status: "failed", failure: "unreadable" });
    expect(await countRows(f)).toEqual({ articles: 0, books: 0, units: 0 });
    expect(
      await f.t.run((ctx) => ctx.db.system.get("_storage", storageId)),
    ).toBeNull();
  });
});

describe("importing a book", () => {
  // Over MAX_STORED_BYTES of text and HTML: no single article row can hold it
  const chapters = 8;
  const pagesPerChapter = 30;
  const pages = Array.from({ length: chapters * pagesPerChapter }, (_, i) =>
    pageLines(i + 1, 32),
  );
  const outline = Array.from({ length: chapters }, (_, i) => ({
    title: `Chapter ${i + 1}`,
    page: i * pagesPerChapter + 1,
  }));

  it("stores its text by reading unit and keeps only the outline on the article", async () => {
    const f = await secondReaderTest(modules);
    const { row } = await importOf(f, makePdf(pages, outline), "Big Book.pdf");
    expect(row).toMatchObject({ status: "ready", pages: pages.length });

    const article = await f.t.run((ctx) =>
      ctx.db.get("articles", row?.articleId as Id<"articles">),
    );
    expect(article?.content).toBeUndefined();
    expect(article?.contentHtml).toBeUndefined();
    expect(article?.annotationStatus).toBe("skipped");
    expect(article?.extractionStatus).toBe("extracted");
    expect(article?.bookOutline?.length).toBe(article?.bookUnitCount);
    expect(article?.bookUnitCount).toBeGreaterThanOrEqual(chapters);

    const units = await f.t.run((ctx) => ctx.db.query("bookUnits").collect());
    expect(units).toHaveLength(article?.bookUnitCount ?? -1);
    expect(units.every((u) => u.userId === "default_user")).toBe(true);
    expect(units.map((u) => u.index).sort((a, b) => a - b)).toEqual(
      units.map((_, i) => i),
    );
    // every unit is a row of its own, well under the 1 MiB document limit
    expect(
      Math.max(...units.map((u) => u.content.length + u.contentHtml.length)),
    ).toBeLessThan(200_000);
    // the outline's minutes are the units' minutes
    for (const u of units)
      expect(article?.bookOutline?.[u.index].minutes).toBe(
        u.estimatedReadMinutes,
      );
    expect(units[0].annotationStatus).toBe("pending");
    expect(units[1].annotationStatus).toBe("deferred");
    // Once readable, its summaries and passages are queued for the same reader
    const queued = await f.t.run(async (ctx) =>
      (await ctx.db.system.query("_scheduled_functions").take(100)).filter(
        (job) => job.name.includes("bookIndex:start"),
      ),
    );
    expect(queued).toHaveLength(1);
    expect(queued[0].args[0]).toMatchObject({
      userId: "default_user",
      articleId: row?.articleId,
    });
    expect(await f.t.run((ctx) => ctx.db.query("books").first())).toMatchObject(
      {
        finishedThrough: -1,
        furthestUnit: -1,
      },
    );
  }, 60_000);

  it("is invisible to another reader", async () => {
    const f = await secondReaderTest(modules);
    const { row } = await importOf(f, makePdf(pages, outline));
    const articleId = row?.articleId as Id<"articles">;
    expect(await f.reader.query(api.books.get, { articleId })).toBeNull();
    expect(
      await f.reader.query(api.books.unit, { articleId, index: 0 }),
    ).toBeNull();
    expect(await f.owner.query(api.books.get, { articleId })).not.toBeNull();
    expect(
      await f.owner.query(api.books.unit, { articleId, index: 0 }),
    ).not.toBeNull();
  }, 60_000);

  it("leaves nothing behind when it fails part-way", async () => {
    const f = await secondReaderTest(modules);
    const { importId, articleId } = await halfWrittenBook(f);
    await f.t.mutation(internal.books.discardBook, {
      userId: "default_user",
      articleId,
    });
    expect(await countRows(f)).toEqual({ articles: 0, books: 0, units: 0 });
    expect(importId).toBeTruthy();
  });
});

/** An import whose action wrote a book's article and a unit, then was killed. */
async function halfWrittenBook(f: Fixture) {
  const storageId = await f.t.run((ctx) =>
    ctx.storage.store(new Blob(["%PDF-1.4"], { type: "application/pdf" })),
  );
  const started = await startImport(f.owner, {
    storageId,
    fileName: "half.pdf",
  });
  if (!started.ok) throw new Error(started.error);
  const { importId } = started;
  const articleId = await f.t.mutation(internal.books.createBookArticle, {
    importId,
    userId: "default_user",
    guid: "upload:test",
    title: "Half",
    excerpt: "x",
    fileName: "half.pdf",
    pageCount: 2,
    wordCount: 10,
    estimatedReadMinutes: 1,
    outline: [{ title: "a", minutes: 1 }],
  });
  if (!articleId) throw new Error("not created");
  await f.t.mutation(internal.books.addUnits, {
    importId,
    userId: "default_user",
    articleId,
    units: [
      {
        index: 0,
        title: "a",
        content: "a b",
        contentHtml: "<p>a b</p>",
        wordCount: 2,
        estimatedReadMinutes: 1,
      },
    ],
  });
  return { importId, articleId, storageId };
}

describe("an import that is killed", () => {
  it("is cleaned up after its time limit, with the half-written book", async () => {
    const f = await secondReaderTest(modules);
    const { importId, articleId, storageId } = await halfWrittenBook(f);
    // The article is recorded on the import as soon as it exists
    expect(
      (await f.t.run((ctx) => ctx.db.get("documentImports", importId)))
        ?.partialArticleId,
    ).toBe(articleId);

    await f.t.mutation(internal.documentImports.expire, { importId });
    await f.t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(await countRows(f)).toEqual({ articles: 0, books: 0, units: 0 });
    expect(
      await f.t.run((ctx) => ctx.db.system.get("_storage", storageId)),
    ).toBeNull();
    expect(await f.owner.query(api.documentImports.latest, {})).toMatchObject({
      status: "failed",
      failure: "too_slow",
    });
  });

  it("is left alone once it has finished", async () => {
    const f = await secondReaderTest(modules);
    const { row } = await importOf(f, makePdf([pageLines(1), pageLines(2)]));
    await f.t.mutation(internal.documentImports.expire, {
      importId: row?._id as Id<"documentImports">,
    });
    expect(
      (
        await f.t.run((ctx) =>
          ctx.db.get("documentImports", row?._id as Id<"documentImports">),
        )
      )?.status,
    ).toBe("ready");
  });
});

describe("an import in flight when the account is deleted", () => {
  it("writes nothing and removes its file", async () => {
    const f = await secondReaderTest(modules);
    const storageId = await f.t.run((ctx) =>
      ctx.storage.store(
        new Blob([makePdf([pageLines(1), pageLines(2)]) as BlobPart], {
          type: "application/pdf",
        }),
      ),
    );
    const started = await startImport(f.reader, {
      storageId,
      fileName: "gone.pdf",
    });
    if (!started.ok) throw new Error(started.error);
    // The reader deletes their account before the action gets to run
    await f.reader.mutation(api.account.deleteMine, { confirmation: "DELETE" });

    await f.t.action(internal.actions.importPdf.run, {
      importId: started.importId,
    });

    expect(await countRows(f)).toEqual({ articles: 0, books: 0, units: 0 });
    expect(
      await f.t.run((ctx) => ctx.db.system.get("_storage", storageId)),
    ).toBeNull();
    expect(
      await f.t.run((ctx) => ctx.db.query("documentImports").collect()),
    ).toEqual([]);
  });

  it("cannot create a book once the library is inactive", async () => {
    const f = await secondReaderTest(modules);
    const storageId = await f.t.run((ctx) =>
      ctx.storage.store(new Blob(["%PDF-1.4"], { type: "application/pdf" })),
    );
    const started = await startImport(f.reader, {
      storageId,
      fileName: "x.pdf",
    });
    if (!started.ok) throw new Error(started.error);
    await f.t.run(async (ctx) => {
      const row = await ctx.db.query("readers").first();
      if (row) await ctx.db.patch("readers", row._id, { status: "disabled" });
    });
    const created = await f.t.mutation(internal.books.createBookArticle, {
      importId: started.importId,
      userId: f.readerLibraryId,
      guid: "upload:x",
      title: "T",
      excerpt: "x",
      fileName: "x.pdf",
      pageCount: 1,
      wordCount: 1,
      estimatedReadMinutes: 1,
      outline: [{ title: "a", minutes: 1 }],
    });
    expect(created).toBeNull();
    expect(await countRows(f)).toEqual({ articles: 0, books: 0, units: 0 });
  });
});
