/// <reference types="vite/client" />

import type { FunctionReturnType } from "convex/server";
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { addReader, secondReaderTest } from "../test/owner";
import { api, internal } from "./_generated/api";
import authSchema from "./betterAuth/schema";
import {
  dictionaryChunks,
  dictionaryOrder,
  foldDictionary,
  purgeDictionary,
} from "./lib/dictionaryIndex";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const OWNER = "default_user";
const month = {
  monthStart: new Date(2026, 9, 1).getTime(),
  monthEnd: new Date(2026, 10, 1).getTime(),
};

async function fixture(count = 0, userId = OWNER) {
  const f = await secondReaderTest(modules);
  const articleId = await f.t.run(async (ctx) => {
    const articleId = await ctx.db.insert("articles", {
      userId,
      guid: "fixture",
      url: "https://example.com",
      title: "Fixture",
      content: "x".repeat(900_000),
      extractionStatus: "extracted",
      annotationStatus: "annotated",
      createdAt: 1,
    });
    for (let i = 0; i < count; i++)
      await ctx.db.insert("lookups", {
        userId,
        articleId,
        word: `a${String(i).padStart(4, "0")}`,
        wordKey: `a${String(i).padStart(4, "0")}`,
        sense: "n. ordinary",
        sentence: "A sentence",
        createdAt: 1 + i,
      });
    return articleId;
  });
  return { ...f, articleId };
}

async function migrate(f: Awaited<ReturnType<typeof fixture>>, userId = OWNER) {
  for (let step = 0; step < 1000; step++) {
    const r = await f.t.mutation(internal.dictionary.backfillPage, { userId });
    if (r.complete || r.inactive) return r;
  }
  throw new Error("Fixture migration did not finish");
}

describe("indexed dictionary", () => {
  it("pages all >2000 headwords, jumps to rare letters directly and retains accent/# ordering", async () => {
    const f = await fixture(2050);
    for (const word of [
      "Zyzzyva",
      "Élan",
      "elan",
      "a\u0301",
      "a",
      "42",
      "Ωmega",
      "C++",
      "C#",
    ]) {
      await f.owner.mutation(api.lookups.record, {
        articleId: f.articleId,
        word,
        sentence: word,
        sense: "n. rare",
        unitIndex: 7,
      });
    }
    expect(
      (
        await f.owner.query(api.dictionary.headwords, {
          after: null,
          query: "",
        })
      ).partial,
    ).toBe(true);
    await migrate(f);
    const initial = await f.owner.query(api.dictionary.headwords, {
      after: null,
      query: "",
    });
    expect(initial.page).toHaveLength(40);
    expect(initial.done).toBe(false);
    expect(initial.partial).toBe(false);
    expect(initial.page[0].wordKey).toBe("42");
    expect(
      initial.page.every((h) => !("sentence" in h) && !("sense" in h)),
    ).toBe(true);
    const z = await f.owner.query(api.dictionary.headwords, {
      after: null,
      query: "",
      letter: "Z",
    });
    expect(z.page.map((h) => h.wordKey)).toEqual(["zyzzyva"]);
    const e = await f.owner.query(api.dictionary.headwords, {
      after: null,
      query: "",
      letter: "E",
    });
    expect(e.page.map((h) => h.wordKey)).toEqual(["elan", "élan"]);
    const all: string[] = [];
    let after: string | null = null;
    for (let n = 0; n < 100; n++) {
      const page: FunctionReturnType<typeof api.dictionary.headwords> =
        await f.owner.query(api.dictionary.headwords, {
          after,
          query: "",
        });
      all.push(...page.page.map((h) => h.wordKey));
      if (page.done) break;
      after = page.after;
    }
    expect(all).toHaveLength(2059);
    expect(new Set(all).size).toBe(2059);
    expect(all.indexOf("a")).toBeLessThan(all.indexOf("á"));
    expect(all).toContain("ωmega");
    const summary = await f.owner.query(api.dictionary.summary, month);
    expect(summary.total).toBe(2059);
    expect(summary.complete).toBe(true);
    expect(
      summary.letters.filter((l) => l.hasWords).map((l) => l.letter),
    ).toEqual(["#", "A", "C", "E", "Z"]);
    expect(
      (
        await f.reader.query(api.dictionary.headwords, {
          after: null,
          query: "",
        })
      ).page,
    ).toEqual([]);
  }, 30_000);

  it("keeps searching past empty scan pages and matches inside accented words and senses", async () => {
    const f = await fixture(210);
    await f.owner.mutation(api.lookups.record, {
      articleId: f.articleId,
      word: "Zéphyr",
      sentence: "s",
      sense: "n. an extraordinarily récondite idea",
    });
    await migrate(f);
    const first = await f.owner.query(api.dictionary.headwords, {
      after: null,
      query: "condit",
    });
    expect(first.page).toEqual([]);
    expect(first.done).toBe(false);
    let after = first.after;
    const found: string[] = [];
    for (let i = 0; i < 5; i++) {
      const r = await f.owner.query(api.dictionary.headwords, {
        after,
        query: "condit",
      });
      found.push(...r.page.map((h) => h.wordKey));
      if (r.done) break;
      after = r.after;
    }
    expect(found).toEqual(["zéphyr"]);
    expect(
      (
        await f.owner.query(api.dictionary.headwords, {
          after: null,
          query: "EPH",
          letter: "Z",
        })
      ).page.map((h) => h.wordKey),
    ).toEqual(["zéphyr"]);
    // Byte, not code-unit validation.
    await expect(
      f.owner.query(api.dictionary.headwords, {
        after: null,
        query: "😀".repeat(65),
      }),
    ).rejects.toThrow("256");
  });

  it("groups repeated senses across scan/page boundaries without skipping prefix-related accent keys", async () => {
    const f = await fixture();
    await f.t.run(async (ctx) => {
      for (let i = 0; i < 110; i++)
        await ctx.db.insert("lookups", {
          userId: OWNER,
          articleId: f.articleId,
          word: "a",
          wordKey: "a",
          sentence: `s${i}`,
          sense: "n. needle",
          createdAt: i,
        });
      await ctx.db.insert("lookups", {
        userId: OWNER,
        articleId: f.articleId,
        word: "á",
        wordKey: "á",
        sentence: "s",
        sense: "n. needle",
        createdAt: 120,
      });
    });
    await migrate(f);
    const first = await f.owner.query(api.dictionary.headwords, {
      after: null,
      query: "needle",
    });
    expect(first.page.map((h) => h.wordKey)).toEqual(["a"]);
    const second = await f.owner.query(api.dictionary.headwords, {
      after: first.after,
      query: "needle",
    });
    expect(second.page.map((h) => h.wordKey)).toEqual(["á"]);
    expect(second.done).toBe(true);
    const senses = await f.owner.query(api.dictionary.senses, {
      wordKey: "a",
      paginationOpts: { numItems: 500, cursor: null },
    });
    expect(senses.page).toHaveLength(4);
    expect(senses.isDone).toBe(false);
    const next = await f.owner.query(api.dictionary.senses, {
      wordKey: "a",
      paginationOpts: { numItems: 4, cursor: senses.continueCursor },
    });
    expect(next.page.map((s) => s.sentence)).toEqual(["s4", "s5", "s6", "s7"]);
  });

  it("adopts a legacy occurrence beyond 200, keeps unit namespaces/retries, and doesn't double-count resumed migration", async () => {
    const f = await fixture(220);
    const args = {
      articleId: f.articleId,
      word: "a0000",
      sentence: "A sentence",
      sense: "n. replaced",
    };
    const [a, b] = await Promise.all([
      f.owner.mutation(api.lookups.record, args),
      f.owner.mutation(api.lookups.record, args),
    ]);
    expect(a).toBe(b);
    await f.t.mutation(internal.dictionary.backfillPage, { userId: OWNER });
    await f.owner.mutation(api.lookups.record, { ...args, unitIndex: 0 });
    await Promise.all([
      f.t.mutation(internal.dictionary.backfillPage, { userId: OWNER }),
      f.owner.mutation(api.lookups.record, { ...args, unitIndex: 1 }),
    ]);
    await migrate(f);
    await migrate(f);
    const heads = await f.owner.query(api.dictionary.headwords, {
      after: null,
      query: "a0000",
    });
    expect(heads.page).toHaveLength(1);
    expect(heads.page[0].occurrences).toBe(3);
    const state = await f.owner.query(api.dictionary.summary, month);
    expect(state.total).toBe(220);
    const rows = await f.t.run((ctx) => ctx.db.query("lookups").collect());
    expect(rows).toHaveLength(222);
    expect(rows.find((r) => r._id === a)?.createdAt).toBe(1);
  });

  it("uses first seen in the local calendar month, including backfilled history, and labels bounded counts partial", async () => {
    const f = await fixture();
    await f.t.run(async (ctx) => {
      for (const [at, key] of [
        [month.monthStart - 1, "old"],
        [month.monthStart + 1, "old"],
        [month.monthStart, "new"],
        [month.monthEnd, "future"],
      ] as const)
        await ctx.db.insert("lookups", {
          userId: OWNER,
          articleId: f.articleId,
          word: key,
          wordKey: key,
          sense: "n. s",
          sentence: "s",
          createdAt: at,
        });
    });
    await migrate(f);
    expect(await f.owner.query(api.dictionary.summary, month)).toMatchObject({
      total: 3,
      month: 1,
      monthComplete: true,
    });
    await f.t.run(async (ctx) => {
      for (let i = 0; i < 260; i++)
        await ctx.db.insert("lookups", {
          userId: OWNER,
          articleId: f.articleId,
          word: `n${i}`,
          wordKey: `n${i}`,
          sense: "n. s",
          sentence: "s",
          createdAt: month.monthStart,
        });
      const state = await ctx.db.query("dictionaryState").first();
      if (state)
        await ctx.db.patch("dictionaryState", state._id, {
          complete: false,
          cursor: null,
        });
    });
    await migrate(f);
    expect(await f.owner.query(api.dictionary.summary, month)).toMatchObject({
      month: 256,
      monthComplete: false,
    });
    const summary = await f.owner.query(api.dictionary.summary, month);
    const tail = await f.owner.query(api.dictionary.monthCount, {
      ...month,
      paginationOpts: { numItems: 256, cursor: summary.monthCursor },
    });
    expect(summary.month + tail.count).toBe(261);
    expect(tail.done).toBe(true);
  });

  it("never links missing/foreign/deleted articles and preserves explicit book units", async () => {
    const f = await fixture();
    await f.owner.mutation(api.lookups.record, {
      articleId: f.articleId,
      word: "book",
      sentence: "quote",
      sense: "n. s",
      unitIndex: 0,
      paragraphIndex: 2,
    });
    let r = await f.owner.query(api.dictionary.senses, {
      wordKey: "book",
      paginationOpts: { numItems: 4, cursor: null },
    });
    expect(r.page[0]).toMatchObject({
      unitIndex: 0,
      paragraphIndex: 2,
      articleGone: false,
    });
    await f.t.run((ctx) =>
      ctx.db.patch("articles", f.articleId, { userId: "foreign" }),
    );
    r = await f.owner.query(api.dictionary.senses, {
      wordKey: "book",
      paginationOpts: { numItems: 4, cursor: null },
    });
    expect(r.page[0]).toMatchObject({ articleGone: true, articleTitle: null });
    await f.t.run((ctx) => ctx.db.delete("articles", f.articleId));
    r = await f.owner.query(api.dictionary.senses, {
      wordKey: "book",
      paginationOpts: { numItems: 4, cursor: null },
    });
    expect(r.page[0].articleGone).toBe(true);
    expect(
      (
        await f.owner.query(api.dictionary.headwords, {
          after: null,
          query: "book",
        })
      ).page,
    ).toHaveLength(1);
  });
  it("keeps only valid serial outcomes for concurrent record and article deletion", async () => {
    const f = await fixture();
    const [record, deletion] = await Promise.allSettled([
      f.owner.mutation(api.lookups.record, {
        articleId: f.articleId,
        word: "race",
        sentence: "s",
        sense: "n. retained",
      }),
      f.t.run((ctx) => ctx.db.delete("articles", f.articleId)),
    ]);
    expect(deletion.status).toBe("fulfilled");
    const heads = await f.owner.query(api.dictionary.headwords, {
      after: null,
      query: "",
    });
    if (record.status === "fulfilled") {
      expect(heads.page.map((h) => h.wordKey)).toEqual(["race"]);
      const senses = await f.owner.query(api.dictionary.senses, {
        wordKey: "race",
        paginationOpts: { numItems: 4, cursor: null },
      });
      expect(senses.page).toHaveLength(1);
      expect(senses.page[0]).toMatchObject({
        articleGone: true,
        articleTitle: null,
        sense: "n. retained",
      });
    } else {
      expect(heads.page).toEqual([]);
      expect(
        await f.t.run((ctx) => ctx.db.query("dictionaryOccurrences").collect()),
      ).toEqual([]);
      expect(await f.t.run((ctx) => ctx.db.query("lookups").collect())).toEqual(
        [],
      );
    }
  });

  it("fences deletion/write/backfill races and purges all derived rows without revival", async () => {
    const f = await secondReaderTest(modules);
    const reader = await f.t.run((ctx) => ctx.db.query("readers").first());
    if (!reader) throw new Error("Missing reader fixture");
    const articleId = await f.t.run((ctx) =>
      ctx.db.insert("articles", {
        userId: reader.libraryId,
        guid: "r",
        url: "https://example.com/r",
        title: "Reader",
        extractionStatus: "extracted",
        annotationStatus: "annotated",
        createdAt: 1,
      }),
    );
    await f.reader.mutation(api.lookups.record, {
      articleId,
      word: "private",
      sentence: "s",
      sense: "n. s",
    });
    await f.t.run((ctx) =>
      ctx.db.patch("readers", reader._id, { deletingAt: 1 }),
    );
    await expect(
      f.reader.mutation(api.lookups.record, {
        articleId,
        word: "late",
        sentence: "s",
        sense: "n. s",
      }),
    ).rejects.toThrow("inactive");
    expect(
      await f.t.mutation(internal.dictionary.backfillPage, {
        userId: reader.libraryId,
      }),
    ).toMatchObject({ inactive: true, processed: 0 });
    for (let i = 0; i < 10; i++)
      if (
        (await f.t.run((ctx) => purgeDictionary(ctx, reader.libraryId))) === 0
      )
        break;
    await f.t.mutation(internal.dictionary.backfillPage, {
      userId: reader.libraryId,
    });
    expect(
      await f.t.run((ctx) => ctx.db.query("dictionaryHeadwords").collect()),
    ).toEqual([]);
    expect(
      await f.t.run((ctx) => ctx.db.query("dictionarySearch").collect()),
    ).toEqual([]);
    expect(
      await f.t.run((ctx) => ctx.db.query("dictionaryState").collect()),
    ).toEqual([]);
    expect(
      await f.t.run((ctx) => ctx.db.query("dictionaryOccurrences").collect()),
    ).toEqual([]);
  });

  it("supports fresh accounts and rejects invalid page counts", async () => {
    const f = await fixture();
    expect(await f.owner.query(api.dictionary.summary, month)).toMatchObject({
      complete: true,
      total: 0,
      month: 0,
    });
    await f.owner.mutation(api.lookups.record, {
      articleId: f.articleId,
      word: "first",
      sentence: "s",
      sense: "n. first",
    });
    expect(await f.owner.query(api.dictionary.summary, month)).toMatchObject({
      complete: true,
      total: 1,
    });
    await expect(
      f.owner.query(api.dictionary.senses, {
        wordKey: "first",
        paginationOpts: { numItems: 0, cursor: null },
      }),
    ).rejects.toThrow("positive integer");
  });
  it("preserves createdAt/id sense ordering across ties and chooses the same first preview", async () => {
    const f = await fixture();
    const ids = await f.t.run(async (ctx) => {
      const ids = [];
      for (let i = 0; i < 9; i++)
        ids.push(
          await ctx.db.insert("lookups", {
            userId: OWNER,
            articleId: f.articleId,
            word: "tie",
            wordKey: "tie",
            sentence: `s${i}`,
            sense: `n. sense${i}`,
            createdAt: 1,
          }),
        );
      return ids;
    });
    await migrate(f);
    const found: string[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 4; i++) {
      const r: FunctionReturnType<typeof api.dictionary.senses> =
        await f.owner.query(api.dictionary.senses, {
          wordKey: "tie",
          paginationOpts: { numItems: 4, cursor },
        });
      found.push(...r.page.map((s) => s._id));
      if (r.isDone) break;
      cursor = r.continueCursor;
    }
    const expected = [...ids].sort((a, b) => a.localeCompare(b));
    expect(found).toEqual(expected);
    const head = await f.owner.query(api.dictionary.headwords, {
      after: null,
      query: "tie",
    });
    expect(head.page[0].preview).toBe(`n. sense${ids.indexOf(expected[0])}`);
  });
});

describe("dictionary search physical bounds", () => {
  it("migrates/resumes giant legacy senses and queries under enforced 4 MiB transaction reads", async () => {
    const t = convexTest({
      schema,
      modules,
      transactionLimits: { bytesRead: 4 * 1024 * 1024 },
    });
    t.registerComponent(
      "betterAuth",
      authSchema,
      import.meta.glob("./betterAuth/**/*.ts"),
    );
    const { client, libraryId } = await addReader(t, {
      email: "limits@example.com",
    });
    const articleId = await t.run((ctx) =>
      ctx.db.insert("articles", {
        userId: libraryId,
        guid: "big",
        url: "https://example.com/big",
        title: "Big",
        content: "x".repeat(900_000),
        extractionStatus: "extracted",
        annotationStatus: "annotated",
        createdAt: 1,
      }),
    );
    for (let i = 0; i < 5; i++)
      await t.run((ctx) =>
        ctx.db.insert("lookups", {
          userId: libraryId,
          articleId,
          word: `legacy${i}`,
          wordKey: `legacy${i}`,
          sentence: "s",
          sense: `${"x".repeat(600_000)} raremarker`,
          createdAt: i,
        }),
      );
    await t.run((ctx) =>
      ctx.db.insert("lookups", {
        userId: libraryId,
        articleId,
        word: "가".repeat(200),
        wordKey: "가".repeat(200),
        sentence: "s",
        sense: "x".repeat(900_000),
        createdAt: 6,
      }),
    );
    let calls = 0;
    let processed = 0;
    for (; calls < 10; calls++) {
      const page = await t.mutation(internal.dictionary.backfillPage, {
        userId: libraryId,
      });
      expect(page.processed).toBeLessThanOrEqual(1);
      processed += page.processed;
      if (page.complete) break;
    }
    expect(calls).toBeLessThan(10);
    expect(processed).toBe(6);
    const heads = await client.query(api.dictionary.headwords, {
      after: null,
      query: "",
    });
    expect(heads.page).toHaveLength(6);
    expect(new TextEncoder().encode(JSON.stringify(heads)).length).toBeLessThan(
      20_000,
    );
    const first = await client.query(api.dictionary.headwords, {
      after: null,
      query: "raremarker",
    });
    expect(first.page).toEqual([]);
    expect(first.done).toBe(false);
    const sense = await client.query(api.dictionary.senses, {
      wordKey: "legacy0",
      paginationOpts: { numItems: 4, cursor: null },
    });
    expect(sense.page).toHaveLength(1);
    expect(sense.page[0].sense.endsWith("raremarker")).toBe(true);
    // Retry publishes a new search version atomically, without losing identity.
    await client.mutation(api.lookups.record, {
      articleId,
      word: "legacy0",
      sentence: "s",
      sense: "n. revised",
    });
    const updated = await client.query(api.dictionary.headwords, {
      after: null,
      query: "revised",
    });
    const continued = await client.query(api.dictionary.headwords, {
      after: updated.after,
      query: "revised",
    });
    expect([...updated.page, ...continued.page].map((h) => h.wordKey)).toEqual([
      "legacy0",
    ]);
    // Stale versions are not search hits, even before explicit compaction.
    let after: string | null = null;
    const hits: string[] = [];
    for (let i = 0; i < 100; i++) {
      const r: FunctionReturnType<typeof api.dictionary.headwords> =
        await client.query(api.dictionary.headwords, {
          after,
          query: "raremarker",
        });
      hits.push(...r.page.map((h) => h.wordKey));
      if (r.done) break;
      after = r.after;
    }
    expect(hits).not.toContain("legacy0");
    expect(new Set(hits)).toEqual(
      new Set(["legacy1", "legacy2", "legacy3", "legacy4"]),
    );
    let cleanupAfter: string | null = null;
    let removed = 0;
    for (let i = 0; i < 100; i++) {
      const r: FunctionReturnType<typeof internal.dictionary.cleanupPage> =
        await t.mutation(internal.dictionary.cleanupPage, {
          userId: libraryId,
          after: cleanupAfter,
        });
      removed += r.removed;
      if (r.done) break;
      cleanupAfter = r.after;
    }
    expect(removed).toBeGreaterThan(0);
    expect(
      (
        await client.query(api.dictionary.headwords, {
          after: null,
          query: "revised",
        })
      ).page.map((h) => h.wordKey),
    ).toEqual(["legacy0"]);
  }, 30_000);
  it("keeps Unicode chunks bounded and preserves a contains match across the edge", () => {
    const sense = `${"😀".repeat(1020)}récondite${"x".repeat(2000)}`;
    const chunks = dictionaryChunks(sense);
    expect(
      chunks.every((c) => new TextEncoder().encode(c).length <= 4096),
    ).toBe(true);
    expect(chunks.some((c) => c.includes("recondite"))).toBe(true);
    expect(foldDictionary("ÉLAN")).toBe("elan");
    const words = ["á", "a", "élan", "elan", "𐀀", "\uE000"];
    const expected = ["a", "á", "elan", "élan", "𐀀", "\uE000"];
    expect(
      words.sort((a, b) => (dictionaryOrder(a) < dictionaryOrder(b) ? -1 : 1)),
    ).toEqual(expected);
  });
});
