// @vitest-environment node
/// <reference types="vite/client" />
import { afterEach, expect, it, vi } from "vitest";
import {
  addReader,
  secondReaderTest,
  TEST_ENCRYPTION_KEY,
} from "../test/owner";
import { api, internal } from "./_generated/api";
import { initializeEmptyMetadata } from "./lib/articleMetadata";
import { encryptProviderKey } from "./lib/providerKeys";

const modules = import.meta.glob("./**/*.ts");
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it.each([
  false,
  true,
])("a non-owner can read their synced Readwise article across the desk without an AI provider (metadata=%s)", async (metadata) => {
  vi.useFakeTimers();
  vi.stubEnv("PROVIDER_KEYS_ENCRYPTION_KEY", TEST_ENCRYPTION_KEY);
  const f = await secondReaderTest(modules);
  const other = await addReader(f.t, { email: "other@example.com" });
  if (metadata)
    expect(
      await f.t.run((ctx) => initializeEmptyMetadata(ctx, f.readerLibraryId)),
    ).toBe(true);
  const sealed = await encryptProviderKey(
    "fixture-readwise-token",
    f.readerLibraryId,
    "readwise",
  );
  await f.t.run((ctx) =>
    ctx.db.insert("readwiseCredentials", {
      userId: f.readerLibraryId,
      ...sealed,
      last4: "oken",
      createdAt: 1,
      updatedAt: 1,
      validatedAt: 1,
    }),
  );
  const text = "An extracted synthetic article. ".repeat(200);
  const fetchMock = vi.fn(async () =>
    Response.json({
      results: [
        {
          id: "synthetic-readwise-1",
          url: "https://example.com/no-provider",
          title: "Available to read",
          category: "article",
          parent_id: null,
          html_content: `<p>${text}</p>`,
        },
      ],
      nextPageCursor: null,
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
  await f.t.action(internal.actions.readwiseSync.sync, {
    userId: f.readerLibraryId,
  });
  // Advance only to annotation/index/queue work, not the next paced Reader page.
  for (let i = 0; i < 12; i++) {
    vi.advanceTimersByTime(1000);
    await f.t.finishInProgressScheduledFunctions();
  }
  const article = await f.t.query(internal.readwise.findArticle, {
    userId: f.readerLibraryId,
    readerDocumentId: "synthetic-readwise-1",
  });
  expect(article).toMatchObject({
    extractionStatus: "extracted",
    annotationStatus: "skipped",
    skipReason: "no_provider",
  });
  if (!article) throw new Error("Missing imported fixture");
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(
    (await f.reader.query(api.readerBootstrap.get, { articleId: article._id }))
      ?.article?.content,
  ).toBe(text.trim());
  expect(
    (await f.reader.query(api.articles.listUnread, {})).map((a) => a._id),
  ).toContain(article._id);
  expect(
    (
      await f.reader.query(api.home.upNextPage, {
        paginationOpts: { numItems: 8, cursor: null },
      })
    ).page.map((a) => a._id),
  ).toContain(article._id);
  expect(await f.reader.query(api.home.overview, {})).toMatchObject({
    waiting: 1,
    pending: 0,
    fits: { 5: 1, 10: 1, 20: 1 },
  });
  expect(
    (await f.reader.query(api.home.overview, {})).upNext.map((a) => a._id),
  ).toContain(article._id);
  expect(
    (
      await f.reader.query(api.suggestions.forWindow, { requestedMinutes: 5 })
    ).map((a) => a._id),
  ).toContain(article._id);
  const seen = [];
  let cursor: string | null = null;
  for (let i = 0; i < 10; i++) {
    const page: {
      page: { _id: string }[];
      continueCursor: string;
      isDone: boolean;
    } = await f.reader.query(api.suggestions.moreForWindow, {
      requestedMinutes: 5,
      paginationOpts: { numItems: 8, cursor },
    });
    seen.push(...page.page.map((a) => a._id));
    cursor = page.continueCursor;
    if (page.isDone) break;
  }
  expect(seen).toEqual([article._id]);
  for (const client of [f.owner, other.client]) {
    expect(
      (
        await client.query(api.suggestions.moreForWindow, {
          requestedMinutes: 5,
          paginationOpts: { numItems: 8, cursor: '["skipped",null]' },
        })
      ).page,
    ).toEqual([]);
    expect(
      await client.query(api.readerBootstrap.get, { articleId: article._id }),
    ).toBeNull();
    expect(await client.query(api.articles.listUnread, {})).toEqual([]);
    expect(
      (
        await client.query(api.home.upNextPage, {
          paginationOpts: { numItems: 8, cursor: null },
        })
      ).page,
    ).toEqual([]);
    expect((await client.query(api.home.overview, {})).upNext).toEqual([]);
    expect(
      await client.query(api.suggestions.forWindow, { requestedMinutes: 5 }),
    ).toEqual([]);
  }
});
