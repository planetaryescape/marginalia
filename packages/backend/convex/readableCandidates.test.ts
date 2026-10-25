/// <reference types="vite/client" />
import type { PaginationResult } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { metadataContext } from "../test/metadata";
import { secondReaderTest } from "../test/owner";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

const modules = import.meta.glob("./**/*.ts");
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("readable candidates before and after metadata migration", () => {
  it.each([
    false,
    true,
  ])("excludes missing, empty, unextracted, finished and book source rows (metadata=%s)", async (metadata) => {
    const f = await secondReaderTest(modules);
    const expected: Id<"articles">[] = [];
    const ids = await f.t.run(async (raw) => {
      const db = metadataContext(raw).db;
      const base = {
        userId: f.readerLibraryId,
        title: "Fixture",
        url: "https://example.com/fixture",
        guid: "fixture",
        content: "Short readable text",
        extractionStatus: "extracted" as const,
        annotationStatus: "skipped" as const,
        estimatedReadMinutes: 3,
        createdAt: 1,
      };
      for (const [i, override] of [
        { skipReason: "no_provider" as const },
        {},
        { annotationStatus: "annotated" as const },
        { annotationStatus: "deferred" as const },
      ].entries())
        expected.push(
          await db.insert("articles", {
            ...base,
            ...override,
            guid: `valid-${i}`,
          }),
        );
      const failed = await db.insert("articles", {
        ...base,
        guid: "failed-annotation",
        annotationStatus: "failed",
      });
      // Newest invalid rows may not consume a limit and starve the valid ones.
      for (let i = 0; i < 30; i++)
        for (const override of [
          { content: undefined },
          { content: "" },
          { extractionStatus: "pending" as const },
          { extractionStatus: "failed" as const },
          { bookUnitCount: 2 },
          { finishedAt: 1 },
          { annotationStatus: "pending" as const },
        ])
          await db.insert("articles", {
            ...base,
            ...override,
            guid: `invalid-${i}-${JSON.stringify(override)}`,
          });
      await db.insert("articles", {
        ...base,
        userId: "default_user",
        guid: "foreign",
      });
      return { failed };
    });
    if (metadata)
      for (let i = 0; i < 100; i++) {
        if (
          (
            await f.t.mutation(internal.articleMetadata.backfill, {
              userId: f.readerLibraryId,
            })
          ).complete
        )
          break;
      }
    const unread = await f.reader.query(api.articles.listUnread, {});
    expect(new Set(unread.map((a) => a._id))).toEqual(new Set(expected));
    expect(
      new Set(
        (await f.reader.query(api.home.overview, {})).upNext.map((a) => a._id),
      ),
    ).toEqual(new Set(expected));
    const page = await f.reader.query(api.home.upNextPage, {
      paginationOpts: { numItems: 500, cursor: null },
    });
    expect(new Set(page.page.map((a) => a._id))).toEqual(new Set(expected));
    expect(page.page.length).toBeLessThanOrEqual(8);
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 10; i++) {
      const result: PaginationResult<{ _id: string }> = await f.reader.query(
        api.suggestions.moreForWindow,
        {
          requestedMinutes: 5,
          paginationOpts: { numItems: 8, cursor },
        },
      );
      seen.push(...result.page.map((a) => a._id));
      cursor = result.continueCursor;
      if (result.isDone) break;
    }
    expect(new Set(seen)).toEqual(new Set([...expected, ids.failed]));
    expect(seen.length).toBe(new Set(seen).size);
    const picks = await f.reader.query(api.suggestions.forWindow, {
      requestedMinutes: 5,
    });
    expect(picks).toHaveLength(3);
    expect(picks.every((a) => [...expected, ids.failed].includes(a._id))).toBe(
      true,
    );
    const skippedPicks = await f.reader.query(api.suggestions.moreForWindow, {
      requestedMinutes: 5,
      paginationOpts: {
        numItems: 8,
        cursor: JSON.stringify(["skipped", null]),
      },
    });
    expect(skippedPicks.page).toHaveLength(2);
    expect(skippedPicks.page.every((a) => a.deferred === false)).toBe(true);
    for (const status of ["annotated", "deferred", "failed"])
      await expect(
        f.reader.query(api.suggestions.moreForWindow, {
          requestedMinutes: 5,
          paginationOpts: {
            numItems: 8,
            cursor: JSON.stringify([status, null]),
          },
        }),
      ).resolves.toHaveProperty("page");
    await expect(
      f.reader.query(api.suggestions.moreForWindow, {
        requestedMinutes: 5,
        paginationOpts: { numItems: 8, cursor: '["__proto__",null]' },
      }),
    ).rejects.toThrow();
    // Validator rejects arbitrary status keys before any counter is touched.
    await expect(
      f.t.mutation(internal.articles.updateAnnotationStatus, {
        articleId: expected[0],
        // @ts-expect-error Deliberately invalid runtime input.
        status: "constructor",
      }),
    ).rejects.toThrow();
  });
});
