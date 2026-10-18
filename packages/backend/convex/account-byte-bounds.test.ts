/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, expect, it, vi } from "vitest";
import { addReader } from "../test/owner";
import { api } from "./_generated/api";
import authSchema from "./betterAuth/schema";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
afterEach(() => vi.useRealTimers());

it("purges valid near-limit bodies under a cumulative 4 MiB read budget", async () => {
  vi.useFakeTimers();
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
    email: "large-library@example.com",
  });
  const text = "x".repeat(900_000);
  for (let index = 0; index < 6; index++) {
    await t.run(async (ctx) => {
      const articleId = await ctx.db.insert("articles", {
        userId: libraryId,
        guid: `large-${index}`,
        url: `https://example.com/large-${index}`,
        title: "Large article",
        content: text,
        extractionStatus: "extracted",
        annotationStatus: "deferred",
        createdAt: index,
      });
      await ctx.db.insert("userNotes", {
        userId: libraryId,
        articleId,
        selectedText: "A large body.",
        content: text.slice(0, 450_000),
        contentPlain: text.slice(0, 450_000),
        createdAt: index,
        updatedAt: index,
      });
      await ctx.db.insert("companionThreads", {
        userId: libraryId,
        articleId,
        mode: "ask",
        selection: "A large body.",
        turns: [{ role: "assistant", content: text }],
        createdAt: index,
        updatedAt: index,
      });
      await ctx.db.insert("bookUnits", {
        userId: libraryId,
        articleId,
        index: 0,
        title: "Large part",
        content: text.slice(0, 450_000),
        contentHtml: text.slice(0, 450_000),
        wordCount: 1,
        estimatedReadMinutes: 1,
        annotationStatus: "deferred",
      });
      await ctx.db.insert("lookups", {
        userId: libraryId,
        articleId,
        word: "large",
        wordKey: "large",
        sentence: "A large body.",
        sense: text,
        createdAt: index,
      });
      await ctx.db.insert("highlights", {
        userId: libraryId,
        articleId,
        kind: "highlight",
        text,
        createdAt: index,
      });
    });
  }
  // A row-count-only policy really does fail for valid stored documents.
  await expect(
    t.run((ctx) => ctx.db.query("userNotes").take(64)),
  ).rejects.toThrow(/bytes|read/i);
  await client.mutation(api.account.deleteMine, { confirmation: "DELETE" });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  for (const table of [
    "userNotes",
    "companionThreads",
    "bookUnits",
    "lookups",
    "highlights",
    "articles",
    "readers",
  ] as const) {
    expect(await t.run((ctx) => ctx.db.query(table).take(1))).toHaveLength(0);
  }
  const jobs = await t.run((ctx) =>
    ctx.db.system.query("_scheduled_functions").take(200),
  );
  expect(jobs.length).toBeGreaterThan(10);
  expect(jobs.every((job) => job.state.kind === "success")).toBe(true);
});
