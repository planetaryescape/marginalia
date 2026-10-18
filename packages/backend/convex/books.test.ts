/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startImport } from "../test/imports";
import { saveTestCredential, secondReaderTest } from "../test/owner";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

const modules = import.meta.glob("./**/*.ts");

// Reading a unit schedules its margin; none of these tests run it
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

type Fixture = Awaited<ReturnType<typeof secondReaderTest>>;

/** A book of units with these lengths in minutes, owned by `userId`. */
async function seedBook(
  { t }: Fixture,
  userId: string,
  minutes: number[],
  title = "Thinking in Systems",
) {
  return t.run(async (ctx) => {
    const articleId = await ctx.db.insert("articles", {
      userId,
      guid: `upload:${title}:${userId}`,
      url: `upload:${title}:${userId}`,
      title,
      extractionStatus: "extracted",
      annotationStatus: "skipped",
      bookUnitCount: minutes.length,
      bookOutline: minutes.map((m, i) => ({
        title: `Unit ${i + 1}`,
        minutes: m,
      })),
      estimatedReadMinutes: minutes.reduce((a, b) => a + b, 0),
      createdAt: Date.now(),
    });
    await ctx.db.insert("books", {
      userId,
      articleId,
      unitCount: minutes.length,
      finishedThrough: -1,
      furthestUnit: -1,
      furthestScroll: 0,
      finished: false,
      createdAt: Date.now(),
    });
    for (const [index, m] of minutes.entries())
      await ctx.db.insert("bookUnits", {
        userId,
        articleId,
        index,
        title: `Unit ${index + 1}`,
        content: `Text of unit ${index + 1}`,
        contentHtml: `<p>Text of unit ${index + 1}</p>`,
        wordCount: m * 220,
        estimatedReadMinutes: m,
        annotationStatus: "deferred",
      });
    return articleId;
  });
}

const picks = (c: Fixture["owner"], requestedMinutes: number) =>
  c.query(api.suggestions.forWindow, { requestedMinutes });

describe("a book in picks", () => {
  it("bootstraps default or explicit text in one authorized query and leaves legacy endpoints intact", async () => {
    const f = await secondReaderTest(modules);
    const id = await seedBook(f, "default_user", [4, 6, 9]);
    const boot = await f.owner.query(api.readerBootstrap.get, {
      articleId: id,
    });
    expect(boot).toMatchObject({
      isBook: true,
      unitIndex: 0,
      article: { content: "Text of unit 1" },
    });
    expect(boot?.article).not.toHaveProperty("userId");
    expect(boot?.article).not.toHaveProperty("bookOutline");
    await expect(
      f.owner.mutation(api.books.recordProgress, {
        articleId: id,
        unitIndex: 1,
        unitKey: boot?.unitKey ?? "missing",
        scrollPercent: 95,
      }),
    ).rejects.toThrow("part has changed");
    expect(
      await f.owner.query(api.readerBootstrap.get, {
        articleId: id,
        unitIndex: 2,
      }),
    ).toMatchObject({ unitIndex: 2, article: { content: "Text of unit 3" } });
    expect(
      await f.owner.query(api.readerBootstrap.get, {
        articleId: id,
        unitIndex: 99,
      }),
    ).toMatchObject({ article: null, missingUnit: true });
    expect(
      await f.reader.query(api.readerBootstrap.get, { articleId: id }),
    ).toBeNull();
    expect(
      await f.owner.query(api.books.unit, { articleId: id, index: 0 }),
    ).toMatchObject({ content: "Text of unit 1" });
    const outline = await f.owner.query(api.readerBootstrap.outline, {
      articleId: id,
    });
    await f.owner.mutation(api.books.recordProgress, {
      articleId: id,
      unitIndex: 0,
      scrollPercent: 20,
    });
    expect(
      await f.owner.query(api.readerBootstrap.outline, { articleId: id }),
    ).toEqual(outline);
    expect(
      await f.owner.query(api.readerBootstrap.progress, { articleId: id }),
    ).toMatchObject({ unit: 0, scroll: 20 });
    expect(
      await f.t.run((ctx) => ctx.db.query("bookUnitStatus").take(5)),
    ).toHaveLength(1);
  });
  it("offers the book's first unit when nothing has been read", async () => {
    const f = await secondReaderTest(modules);
    const id = await seedBook(f, "default_user", [4, 6, 9]);
    const [pick, ...rest] = await picks(f.owner, 10);
    expect(rest).toEqual([]);
    expect(pick).toMatchObject({
      _id: id,
      title: "Thinking in Systems · Part 1 of 3",
      estimatedReadMinutes: 4,
      book: { unitIndex: 0, unitTitle: "Unit 1" },
    });
  });

  it("offers only the unit after the last one read", async () => {
    const f = await secondReaderTest(modules);
    const id = await seedBook(f, "default_user", [4, 6, 9, 3]);
    await f.owner.mutation(api.books.recordProgress, {
      articleId: id,
      unitIndex: 0,
      scrollPercent: 96,
    });
    const [pick] = await picks(f.owner, 10);
    expect(pick.book).toMatchObject({ unitIndex: 1 });
    expect(pick.title).toContain("Part 2 of 4");

    await f.owner.mutation(api.books.recordProgress, {
      articleId: id,
      unitIndex: 1,
      scrollPercent: 95,
    });
    expect((await picks(f.owner, 10))[0].book).toMatchObject({ unitIndex: 2 });
  });

  it("offers nothing from the book when its next unit does not fit, even if a later one does", async () => {
    const f = await secondReaderTest(modules);
    const id = await seedBook(f, "default_user", [4, 12, 3]);
    await f.owner.mutation(api.books.recordProgress, {
      articleId: id,
      unitIndex: 0,
      scrollPercent: 99,
    });
    // Unit 2 is 12 minutes; unit 3 is 3 minutes and would fit 5, but is not next
    expect(await picks(f.owner, 5)).toEqual([]);
    expect((await picks(f.owner, 12))[0].book).toMatchObject({ unitIndex: 1 });
  });

  it("keeps the paragraph at the furthest place within the part", async () => {
    const f = await secondReaderTest(modules);
    const id = await seedBook(f, "default_user", [4, 6, 9]);
    const at = (scrollPercent: number, paragraphIndex?: number) =>
      f.owner.mutation(api.books.recordProgress, {
        articleId: id,
        unitIndex: 1,
        scrollPercent,
        paragraphIndex,
      });
    await at(30, 11);
    await at(50, 19);
    // Back up the part: the furthest place stands
    await at(10, 3);
    expect(await f.owner.query(api.books.get, { articleId: id })).toMatchObject(
      { furthestUnit: 1, furthestScroll: 50, furthestParagraph: 19 },
    );
    // A row from before paragraphs: going further clears the stale one
    await at(60);
    expect(
      (await f.owner.query(api.books.get, { articleId: id }))
        ?.furthestParagraph,
    ).toBeUndefined();
  });

  it("keeps offering the unit the reader is partway through", async () => {
    const f = await secondReaderTest(modules);
    const id = await seedBook(f, "default_user", [4, 6, 9]);
    await f.owner.mutation(api.books.recordProgress, {
      articleId: id,
      unitIndex: 1,
      scrollPercent: 30,
    });
    expect((await picks(f.owner, 10))[0].book).toMatchObject({ unitIndex: 1 });
  });

  it("stops offering a book once its last unit is read", async () => {
    const f = await secondReaderTest(modules);
    const id = await seedBook(f, "default_user", [4, 6]);
    for (const unitIndex of [0, 1])
      await f.owner.mutation(api.books.recordProgress, {
        articleId: id,
        unitIndex,
        scrollPercent: 100,
      });
    expect(await picks(f.owner, 30)).toEqual([]);
    const article = await f.t.run((ctx) => ctx.db.get("articles", id));
    expect(article?.finishedAt).toBeDefined();
  });

  it("offers a book only with the unit that fits, next to ordinary articles", async () => {
    const f = await secondReaderTest(modules);
    await seedBook(f, "default_user", [8, 8]);
    await f.t.run((ctx) =>
      ctx.db.insert("articles", {
        userId: "default_user",
        guid: "a",
        url: "https://example.com/a",
        title: "An ordinary article",
        extractionStatus: "extracted",
        annotationStatus: "annotated",
        estimatedReadMinutes: 8,
        createdAt: Date.now(),
      }),
    );
    const titles = (await picks(f.owner, 10)).map((p) => p.title);
    expect(titles).toContain("An ordinary article");
    expect(titles).toContain("Thinking in Systems · Part 1 of 2");
    expect(titles).toHaveLength(2);
  });

  it("is on the first page of more picks, once", async () => {
    const f = await secondReaderTest(modules);
    await seedBook(f, "default_user", [4, 6]);
    const page = (cursor: string | null) =>
      f.owner.query(api.suggestions.moreForWindow, {
        requestedMinutes: 10,
        paginationOpts: { numItems: 10, cursor },
      });
    const first = await page(null);
    expect(first.page.map((p) => p.title)).toEqual([
      "Thinking in Systems · Part 1 of 2",
    ]);
    const second = await page(first.continueCursor);
    expect(second.page).toEqual([]);
  });
});

describe("books belong to their reader", () => {
  it("never offers one reader's book to another", async () => {
    const f = await secondReaderTest(modules);
    await seedBook(f, "default_user", [4, 6]);
    expect(await picks(f.reader as never, 10)).toEqual([]);
  });

  it("keeps each reader's place in a book of the same title", async () => {
    const f = await secondReaderTest(modules);
    const mine = await seedBook(f, "default_user", [4, 6, 9]);
    const theirs = await seedBook(f, f.readerLibraryId, [4, 6, 9]);
    await f.owner.mutation(api.books.recordProgress, {
      articleId: mine,
      unitIndex: 0,
      scrollPercent: 100,
    });
    expect((await picks(f.owner, 10))[0].book).toMatchObject({ unitIndex: 1 });
    const [theirPick] = await picks(f.reader as never, 10);
    expect(theirPick).toMatchObject({ _id: theirs, book: { unitIndex: 0 } });
  });

  it("will not read or move another reader's book", async () => {
    const f = await secondReaderTest(modules);
    const mine = await seedBook(f, "default_user", [4, 6]);
    expect(await f.reader.query(api.books.get, { articleId: mine })).toBeNull();
    expect(
      await f.reader.query(api.books.unit, { articleId: mine, index: 0 }),
    ).toBeNull();
    await expect(
      f.reader.mutation(api.books.recordProgress, {
        articleId: mine,
        unitIndex: 0,
        scrollPercent: 100,
      }),
    ).rejects.toThrow("Book not found");
    const row = await f.t.run((ctx) => ctx.db.query("books").first());
    expect(row).toMatchObject({ finishedThrough: -1, furthestUnit: -1 });
  });

  it("lists a reader's notes for one unit only", async () => {
    const f = await secondReaderTest(modules);
    const id = await seedBook(f, "default_user", [4, 6]);
    await f.t.run(async (ctx) => {
      for (const unitIndex of [0, 1])
        await ctx.db.insert("annotations", {
          articleId: id,
          userId: "default_user",
          unitIndex,
          type: "context",
          anchorText: "Text",
          anchorStartOffset: 0,
          anchorEndOffset: 4,
          content: `note on unit ${unitIndex + 1}`,
          relevanceScore: 0.8,
          wasViewed: false,
          wasDismissed: false,
          createdAt: Date.now(),
        });
    });
    const second = await f.owner.query(api.annotations.listByArticle, {
      articleId: id,
      unitIndex: 1,
    });
    expect(second.map((a) => a.content)).toEqual(["note on unit 2"]);
    expect(
      await f.reader.query(api.annotations.listByArticle, {
        articleId: id,
        unitIndex: 1,
      }),
    ).toEqual([]);
  });
});

describe("recording progress", () => {
  it("rejects a unit that is not in the book and a bad position", async () => {
    const f = await secondReaderTest(modules);
    const id = await seedBook(f, "default_user", [4, 6]);
    for (const unitIndex of [-1, 2, 0.5])
      await expect(
        f.owner.mutation(api.books.recordProgress, {
          articleId: id,
          unitIndex,
          scrollPercent: 50,
        }),
      ).rejects.toThrow();
    await expect(
      f.owner.mutation(api.books.recordProgress, {
        articleId: id,
        unitIndex: 0,
        scrollPercent: Number.NaN,
      }),
    ).rejects.toThrow();
  });

  it("never moves backward", async () => {
    const f = await secondReaderTest(modules);
    const id = await seedBook(f, "default_user", [4, 6, 9]);
    const record = (unitIndex: number, scrollPercent: number) =>
      f.owner.mutation(api.books.recordProgress, {
        articleId: id,
        unitIndex,
        scrollPercent,
      });
    await record(2, 40);
    await record(0, 99);
    expect(await f.t.run((ctx) => ctx.db.query("books").first())).toMatchObject(
      {
        finishedThrough: 0,
        furthestUnit: 2,
      },
    );
  });

  it("starts the unit's margin, and the next unit's once well into this one", async () => {
    const f = await secondReaderTest(modules);
    const id = await seedBook(f, "default_user", [4, 6, 9]);
    const statuses = () =>
      f.t.run(async (ctx) =>
        (await ctx.db.query("bookUnits").collect())
          .sort((a, b) => a.index - b.index)
          .map((u) => u.annotationStatus),
      );
    await f.owner.mutation(api.books.recordProgress, {
      articleId: id,
      unitIndex: 0,
      scrollPercent: 10,
    });
    expect(await statuses()).toEqual(["pending", "deferred", "deferred"]);
    await f.owner.mutation(api.books.recordProgress, {
      articleId: id,
      unitIndex: 0,
      scrollPercent: 65,
    });
    expect(await statuses()).toEqual(["pending", "pending", "deferred"]);
  });

  it("does not finish the book when a visit's time adds up", async () => {
    const f = await secondReaderTest(modules);
    const id = await seedBook(f, "default_user", [4, 6]);
    await f.owner.mutation(api.readingActivity.checkpoint, {
      articleId: id,
      visitId: crypto.randomUUID(),
      day: "2026-10-16",
      startedAt: Date.now() - 600_000,
      updatedAt: Date.now(),
      activeTimeMs: 600_000,
      visibleTimeMs: 600_000,
      timeSpentMs: 600_000,
      maxScrollPercent: 100,
      annotationsOpened: [],
      finished: true,
    });
    const article = await f.t.run((ctx) =>
      ctx.db.get("articles", id as Id<"articles">),
    );
    expect(article?.finishedAt).toBeUndefined();
  });
});

describe("the library shelf", () => {
  it("lists an unfinished book once, with its parts", async () => {
    const f = await secondReaderTest(modules);
    await seedBook(f, "default_user", [4, 6]);
    const overview = await f.owner.query(api.home.overview, {});
    expect(overview.upNext).toMatchObject([
      { title: "Thinking in Systems", source: "Book · 2 parts" },
    ]);
    expect((await f.reader.query(api.home.overview, {})).upNext).toEqual([]);
  });
});

describe("deleting an account", () => {
  it("removes the reader's books, units and imports, and the owner's stay", async () => {
    const f = await secondReaderTest(modules);
    await seedBook(f, "default_user", [4, 6]);
    await seedBook(f, f.readerLibraryId, [4, 6, 9]);
    const storageId = await f.t.run((ctx) =>
      ctx.storage.store(new Blob(["%PDF-1.4"], { type: "application/pdf" })),
    );
    await startImport(f.reader, {
      storageId,
      fileName: "x.pdf",
    });

    await f.reader.mutation(api.account.deleteMine, { confirmation: "DELETE" });
    await f.t.finishAllScheduledFunctions(vi.runAllTimers);

    const left = await f.t.run(async (ctx) => ({
      books: (await ctx.db.query("books").collect()).map((b) => b.userId),
      units: (await ctx.db.query("bookUnits").collect()).map((u) => u.userId),
      imports: await ctx.db.query("documentImports").collect(),
      file: await ctx.db.system.get("_storage", storageId),
    }));
    expect(left.books).toEqual(["default_user"]);
    expect(new Set(left.units)).toEqual(new Set(["default_user"]));
    expect(left.imports).toEqual([]);
    expect(left.file).toBeNull();
  });
});

describe("a book's marks, notes and kept answers", () => {
  it("are filed under the part and listed only for it", async () => {
    const f = await secondReaderTest(modules);
    const id = await seedBook(f, "default_user", [4, 6]);
    const mine = f.owner;
    for (const unitIndex of [0, 1]) {
      await mine.mutation(api.highlights.create, {
        articleId: id,
        kind: "highlight",
        text: `mark ${unitIndex}`,
        paragraphIndex: 2,
        unitIndex,
      });
      await mine.mutation(api.userNotes.create, {
        articleId: id,
        selectedText: `quote ${unitIndex}`,
        unitIndex,
        content: "<p>n</p>",
        contentPlain: "n",
      });
      await mine.mutation(api.companionThreads.keep, {
        articleId: id,
        answerId: `a${unitIndex}`,
        mode: "explain",
        selection: `passage ${unitIndex}`,
        unitIndex,
        turns: [{ role: "assistant", content: "x" }],
      });
    }
    const second = { articleId: id, unitIndex: 1 };
    expect(
      (await mine.query(api.highlights.listByArticle, second)).map(
        (h) => h.text,
      ),
    ).toEqual(["mark 1"]);
    expect(
      (await mine.query(api.userNotes.listByArticle, second)).map(
        (n) => n.selectedText,
      ),
    ).toEqual(["quote 1"]);
    expect(
      (await mine.query(api.companionThreads.listByArticle, second)).map(
        (c) => c.selection,
      ),
    ).toEqual(["passage 1"]);
    // Without a part, an article lists everything, as before
    expect(
      await mine.query(api.highlights.listByArticle, { articleId: id }),
    ).toHaveLength(2);
  });
});

describe("re-annotating", () => {
  it("is refused for a book, and its notes stay", async () => {
    const f = await secondReaderTest(modules);
    const id = await seedBook(f, "default_user", [4, 6]);
    await f.t.run((ctx) =>
      ctx.db.insert("annotations", {
        articleId: id,
        userId: "default_user",
        unitIndex: 0,
        type: "context",
        anchorText: "Text",
        anchorStartOffset: 0,
        anchorEndOffset: 4,
        content: "keep me",
        relevanceScore: 0.8,
        wasViewed: false,
        wasDismissed: false,
        createdAt: Date.now(),
      }),
    );
    await expect(
      f.owner.action(api.articles.requestReannotate, { articleId: id }),
    ).rejects.toThrow("annotated a part at a time");
    expect(
      await f.t.run((ctx) => ctx.db.query("annotations").collect()),
    ).toHaveLength(1);
  });
});

describe("books that are finished", () => {
  it("don't crowd an unfinished book off the shelf or out of picks", async () => {
    const f = await secondReaderTest(modules);
    // The unfinished book is the oldest; many newer ones are done
    const unfinished = await seedBook(
      f,
      "default_user",
      [4, 6],
      "Still reading",
    );
    for (let i = 0; i < 25; i++) {
      const id = await seedBook(f, "default_user", [4, 6], `Done ${i}`);
      await f.owner.mutation(api.articles.archive, { articleId: id });
    }
    const shelf = (await f.owner.query(api.home.overview, {})).upNext;
    expect(shelf.map((e) => e.title)).toEqual(["Still reading"]);
    const [pick] = await picks(f.owner, 10);
    expect(pick._id).toBe(unfinished);
  });
});

describe("marking a book unread", () => {
  it("offers a book read to the end from its start again", async () => {
    const f = await secondReaderTest(modules);
    const id = await seedBook(f, "default_user", [4, 6]);
    for (const unitIndex of [0, 1])
      await f.owner.mutation(api.books.recordProgress, {
        articleId: id,
        unitIndex,
        scrollPercent: 100,
      });
    expect(await picks(f.owner, 30)).toEqual([]);
    expect(await f.t.run((ctx) => ctx.db.query("books").first())).toMatchObject(
      {
        finished: true,
      },
    );

    await f.owner.mutation(api.articles.restore, { articleId: id });
    expect(await f.t.run((ctx) => ctx.db.query("books").first())).toMatchObject(
      {
        finished: false,
        finishedThrough: -1,
        furthestUnit: -1,
      },
    );
    expect((await picks(f.owner, 30))[0].book).toMatchObject({ unitIndex: 0 });
  });

  it("keeps the place of a book that was only archived", async () => {
    const f = await secondReaderTest(modules);
    const id = await seedBook(f, "default_user", [4, 6, 9]);
    await f.owner.mutation(api.books.recordProgress, {
      articleId: id,
      unitIndex: 0,
      scrollPercent: 100,
    });
    await f.owner.mutation(api.articles.archive, { articleId: id });
    expect(await picks(f.owner, 30)).toEqual([]);
    await f.owner.mutation(api.articles.restore, { articleId: id });
    expect((await picks(f.owner, 30))[0].book).toMatchObject({ unitIndex: 1 });
  });
});

describe("a unit whose margin did not arrive", () => {
  const unitStatus = (f: Fixture) =>
    f.t.run(async (ctx) => {
      const u = (await ctx.db.query("bookUnits").collect()).find(
        (x) => x.index === 0,
      );
      return { status: u?.annotationStatus, retries: u?.annotationRetries };
    });
  const open = (f: Fixture, id: Id<"articles">) =>
    f.owner.mutation(api.books.recordProgress, {
      articleId: id,
      unitIndex: 0,
      scrollPercent: 0,
    });
  const setUnit = (f: Fixture, patch: Record<string, unknown>) =>
    f.t.run(async (ctx) => {
      const u = (await ctx.db.query("bookUnits").collect()).find(
        (x) => x.index === 0,
      );
      if (u) {
        await ctx.db.patch("bookUnits", u._id, patch);
        const metadata = await ctx.db
          .query("bookUnitStatus")
          .withIndex("by_userId_and_articleId_and_index", (q) =>
            q
              .eq("userId", u.userId)
              .eq("articleId", u.articleId)
              .eq("index", u.index),
          )
          .unique();
        if (metadata) await ctx.db.patch("bookUnitStatus", metadata._id, patch);
      }
    });

  it("is started again on opening, twice at most", async () => {
    const f = await secondReaderTest(modules);
    const id = await seedBook(f, "default_user", [4, 6]);
    for (const retries of [1, 2]) {
      await setUnit(f, { annotationStatus: "failed" });
      await open(f, id);
      expect(await unitStatus(f)).toEqual({ status: "pending", retries });
    }
    await setUnit(f, { annotationStatus: "failed" });
    await open(f, id);
    expect(await unitStatus(f)).toEqual({ status: "failed", retries: 2 });
  });

  it("is started once a provider is saved when it was skipped for lack of one", async () => {
    const f = await secondReaderTest(modules);
    const id = await seedBook(f, "default_user", [4, 6]);
    await setUnit(f, {
      annotationStatus: "skipped",
      skipReason: "no_provider",
    });
    await open(f, id);
    expect((await unitStatus(f)).status).toBe("skipped");
    await saveTestCredential(
      f.t,
      "default_user",
      "openrouter",
      "sk-or-test-key-0001",
    );
    await open(f, id);
    expect((await unitStatus(f)).status).toBe("pending");
  });
});

describe("a margin written for a reader who is leaving", () => {
  it("is refused once the library is no longer active", async () => {
    const f = await secondReaderTest(modules);
    const id = await seedBook(f, f.readerLibraryId, [4, 6]);
    await f.t.run(async (ctx) => {
      const row = await ctx.db.query("readers").first();
      if (row) await ctx.db.patch("readers", row._id, { status: "disabled" });
    });
    await expect(
      f.t.mutation(internal.annotations.replaceForUnit, {
        userId: f.readerLibraryId,
        articleId: id,
        unitIndex: 0,
        notes: [
          {
            type: "context",
            anchorText: "Text",
            anchorStartOffset: 0,
            anchorEndOffset: 4,
            content: "late note",
            relevanceScore: 0.9,
          },
        ],
      }),
    ).rejects.toThrow("no longer active");
    expect(
      await f.t.run((ctx) => ctx.db.query("annotations").collect()),
    ).toEqual([]);
  });
});

describe("removing a half-written book", () => {
  it("deletes it in small batches and releases the import only at the end", async () => {
    const f = await secondReaderTest(modules);
    const id = await seedBook(
      f,
      "default_user",
      Array.from({ length: 25 }, () => 4),
    );
    const importId = await f.t.run(async (ctx) =>
      ctx.db.insert("documentImports", {
        userId: "default_user",
        storageId: await ctx.storage.store(new Blob(["%PDF-"])),
        fileName: "x.pdf",
        status: "failed",
        step: "text",
        failure: "too_slow",
        partialArticleId: id,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
    );
    await f.t.mutation(internal.books.discardBook, {
      userId: "default_user",
      articleId: id,
      importId,
    });
    // One batch of ten is gone; the rest wait, and the import still names the book
    expect(
      await f.t.run((ctx) => ctx.db.query("bookUnits").collect()),
    ).toHaveLength(15);
    expect(
      (await f.t.run((ctx) => ctx.db.get("documentImports", importId)))
        ?.partialArticleId,
    ).toBe(id);
    await f.t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await f.t.run((ctx) => ctx.db.query("bookUnits").collect())).toEqual(
      [],
    );
    expect(await f.t.run((ctx) => ctx.db.get("articles", id))).toBeNull();
    expect(
      (await f.t.run((ctx) => ctx.db.get("documentImports", importId)))
        ?.partialArticleId,
    ).toBeUndefined();
  });
});

describe("marks beyond the first part", () => {
  it("are found within their part, however many another part holds", async () => {
    const f = await secondReaderTest(modules);
    const id = await seedBook(f, "default_user", [4, 6]);
    await f.t.run(async (ctx) => {
      for (let i = 0; i < 520; i++)
        await ctx.db.insert("highlights", {
          userId: "default_user",
          articleId: id,
          kind: "highlight",
          text: `first ${i}`,
          unitIndex: 0,
          createdAt: Date.now(),
        });
      await ctx.db.insert("highlights", {
        userId: "default_user",
        articleId: id,
        kind: "highlight",
        text: "the only one in part two",
        unitIndex: 1,
        createdAt: Date.now(),
      });
    });
    const second = await f.owner.query(api.highlights.listByArticle, {
      articleId: id,
      unitIndex: 1,
    });
    expect(second.map((h) => h.text)).toEqual(["the only one in part two"]);
  });
});

describe("how many books a pick reads", () => {
  it("considers the five newest unfinished books, each with its whole outline", async () => {
    const f = await secondReaderTest(modules);
    for (let i = 0; i < 7; i++)
      await seedBook(f, "default_user", [4, 6], `Book ${i}`);
    const page = await f.owner.query(api.suggestions.moreForWindow, {
      requestedMinutes: 10,
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(page.page.map((p) => p.title.split(" · ")[0]).sort()).toEqual([
      "Book 2",
      "Book 3",
      "Book 4",
      "Book 5",
      "Book 6",
    ]);
  });
});
