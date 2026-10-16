/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { secondReaderTest } from "../test/owner";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");

function row(userId: string, i: number, status: "annotated" | "deferred") {
  return {
    userId,
    guid: `${userId}-${i}`,
    url: `https://example.com/${userId}/${i}`,
    title: `${userId} piece ${i}`,
    extractionStatus: "extracted" as const,
    annotationStatus: status,
    createdAt: i,
  };
}

describe("Up next, a page at a time", () => {
  it("walks the whole queue newest first across both statuses, with no repeats or gaps", async () => {
    const f = await secondReaderTest(modules);
    const seeded = await f.t.run(async (ctx) => {
      const ids: string[] = [];
      for (let i = 0; i < 23; i++)
        ids.push(
          await ctx.db.insert(
            "articles",
            row("default_user", i, i % 3 ? "annotated" : "deferred"),
          ),
        );
      // Not part of the queue: finished, and still being annotated
      await ctx.db.insert("articles", {
        ...row("default_user", 90, "annotated"),
        finishedAt: 1,
      });
      await ctx.db.insert("articles", {
        ...row("default_user", 91, "annotated"),
        annotationStatus: "pending",
      });
      return ids;
    });

    const seen: string[] = [];
    let cursor: string | null = null;
    for (let guard = 0; guard < 10; guard++) {
      const result: {
        page: { _id: string }[];
        isDone: boolean;
        continueCursor: string;
      } = await f.owner.query(api.home.upNextPage, {
        paginationOpts: { numItems: 5, cursor },
      });
      seen.push(...result.page.map((a) => a._id));
      if (result.isDone) break;
      cursor = result.continueCursor;
    }
    expect(seen).toEqual([...seeded].reverse());
  });

  it("keeps two loaded pages whole and in order when an article arrives at the head", async () => {
    const f = await secondReaderTest(modules);
    await f.t.run(async (ctx) => {
      for (let i = 0; i < 20; i++)
        await ctx.db.insert("articles", row("default_user", i, "annotated"));
    });
    const first = await f.owner.query(api.home.upNextPage, {
      paginationOpts: { numItems: 5, cursor: null },
    });
    const second = await f.owner.query(api.home.upNextPage, {
      paginationOpts: { numItems: 5, cursor: first.continueCursor },
    });
    await f.t.run(async (ctx) => {
      await ctx.db.insert("articles", row("default_user", 50, "annotated"));
    });
    // How usePaginatedQuery re-asks: each loaded page pinned to its end cursor
    const again1 = await f.owner.query(api.home.upNextPage, {
      paginationOpts: {
        numItems: 5,
        cursor: null,
        endCursor: first.continueCursor,
      },
    });
    const again2 = await f.owner.query(api.home.upNextPage, {
      paginationOpts: {
        numItems: 5,
        cursor: first.continueCursor,
        endCursor: second.continueCursor,
      },
    });
    const ids = [...again1.page, ...again2.page].map((a) => a._id);
    expect(ids).toEqual([
      expect.any(String),
      ...first.page.map((a) => a._id),
      ...second.page.map((a) => a._id),
    ]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("caps the page size whatever the client asks for", async () => {
    const f = await secondReaderTest(modules);
    await f.t.run(async (ctx) => {
      for (let i = 0; i < 30; i++)
        await ctx.db.insert("articles", row("default_user", i, "annotated"));
    });
    const result = await f.owner.query(api.home.upNextPage, {
      paginationOpts: { numItems: 100_000, cursor: null },
    });
    expect(result.page).toHaveLength(8);
    expect(result.isDone).toBe(false);
  });

  it("pages 21 near-megabyte articles without repeats or gaps", async () => {
    const f = await secondReaderTest(modules);
    const body = "x".repeat(800_000);
    const ids = await f.t.run(async (ctx) => {
      const ids: string[] = [];
      for (let i = 0; i < 21; i++)
        ids.push(
          await ctx.db.insert("articles", {
            ...row("default_user", i, "annotated"),
            content: body,
          }),
        );
      return ids;
    });
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let guard = 0; guard < 30; guard++) {
      const result: {
        page: { _id: string }[];
        isDone: boolean;
        continueCursor: string;
      } = await f.owner.query(api.home.upNextPage, {
        paginationOpts: { numItems: 10, cursor },
      });
      expect(result.page.length).toBeLessThanOrEqual(8);
      seen.push(...result.page.map((a) => a._id));
      if (result.isDone) break;
      cursor = result.continueCursor;
    }
    expect(seen).toEqual([...ids].reverse());
  });

  it("never lists another reader's articles", async () => {
    const f = await secondReaderTest(modules);
    await f.t.run(async (ctx) => {
      await ctx.db.insert("articles", row("default_user", 1, "annotated"));
      await ctx.db.insert("articles", row(f.readerLibraryId, 2, "deferred"));
    });
    const theirs = await f.reader.query(api.home.upNextPage, {
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(theirs.page.map((a) => a.title)).toEqual([
      `${f.readerLibraryId} piece 2`,
    ]);
    const mine = await f.owner.query(api.home.upNextPage, {
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(mine.page.map((a) => a.title)).toEqual(["default_user piece 1"]);
  });
});
