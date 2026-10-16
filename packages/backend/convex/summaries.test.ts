/// <reference types="vite/client" />

import { expect, it } from "vitest";
import { secondReaderTest } from "../test/owner";
import { internal } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");

it("gives the companion only the summary of the signed-in reader's own article", async () => {
  const { t } = await secondReaderTest(modules);
  const articleId = await t.run(async (ctx) => {
    const id = await ctx.db.insert("articles", {
      userId: "default_user",
      guid: "g",
      url: "https://example.com/g",
      title: "Markets",
      extractionStatus: "extracted",
      annotationStatus: "annotated",
      createdAt: 1,
    });
    await ctx.db.insert("summaries", {
      userId: "default_user",
      articleId: id,
      gist: "A tour of markets.",
      thesis: "Prices drive demand.",
      model: "fixture",
      createdAt: 1,
    });
    return id;
  });
  expect(
    await t.query(internal.summaries.forCompanion, {
      articleId,
      userId: "default_user",
    }),
  ).toEqual({ thesis: "Prices drive demand.", gist: "A tour of markets." });
  // Another reader's ID, and text that is not an ID at all, find nothing
  expect(
    await t.query(internal.summaries.forCompanion, {
      articleId,
      userId: "someone_else",
    }),
  ).toBeNull();
  expect(
    await t.query(internal.summaries.forCompanion, {
      articleId: "not-an-id",
      userId: "default_user",
    }),
  ).toBeNull();
});
