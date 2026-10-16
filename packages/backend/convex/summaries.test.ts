/// <reference types="vite/client" />

import { describe, expect, it } from "vitest";
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

describe("summaries.saveOverview", () => {
  async function setup() {
    const { t } = await secondReaderTest(modules);
    const articleId = await t.run((ctx) =>
      ctx.db.insert("articles", {
        userId: "default_user",
        guid: "g2",
        url: "https://example.com/g2",
        title: "Markets",
        extractionStatus: "extracted",
        annotationStatus: "annotated",
        createdAt: 1,
      }),
    );
    const rows = () =>
      t.run((ctx) =>
        ctx.db
          .query("summaries")
          .withIndex("by_article", (q) => q.eq("articleId", articleId))
          .collect(),
      );
    const overview = (thesis = "New point.", gist = "New gist.") =>
      t.mutation(internal.summaries.saveOverview, {
        userId: "default_user",
        articleId,
        thesis,
        gist,
        model: "import-model",
      });
    return { t, articleId, rows, overview };
  }

  it("writes the one point and short summary when there is no summary", async () => {
    const { rows, overview } = await setup();
    await overview();
    expect(await rows()).toMatchObject([
      { thesis: "New point.", gist: "New gist.", model: "import-model" },
    ]);
  });

  it("never replaces a summary that already has a one point", async () => {
    const { t, articleId, rows, overview } = await setup();
    await t.run((ctx) =>
      ctx.db.insert("summaries", {
        userId: "default_user",
        articleId,
        thesis: "Fuller point.",
        gist: "Fuller gist.",
        ideas: [],
        links: [],
        model: "on-demand",
        createdAt: 1,
      }),
    );
    expect(await overview()).toBeNull();
    expect(await rows()).toMatchObject([
      { thesis: "Fuller point.", gist: "Fuller gist.", model: "on-demand" },
    ]);
  });

  it("adds a one point to an older summary without touching its map or gist", async () => {
    const { t, articleId, rows, overview } = await setup();
    await t.run((ctx) =>
      ctx.db.insert("summaries", {
        userId: "default_user",
        articleId,
        gist: "Older gist.",
        claims: [{ text: "A claim", paragraphs: [1] }],
        model: "old",
        createdAt: 1,
      }),
    );
    await overview();
    expect(await rows()).toMatchObject([
      {
        thesis: "New point.",
        gist: "Older gist.",
        claims: [{ text: "A claim", paragraphs: [1] }],
        model: "old",
      },
    ]);
  });

  it("fills a summary that has nothing but a blank gist", async () => {
    const { t, articleId, rows, overview } = await setup();
    await t.run((ctx) =>
      ctx.db.insert("summaries", {
        userId: "default_user",
        articleId,
        gist: " ",
        model: "old",
        createdAt: 1,
      }),
    );
    await overview();
    expect(await rows()).toMatchObject([
      { thesis: "New point.", gist: "New gist." },
    ]);
  });

  it("is replaced whole by a later on-demand summary, and then holds", async () => {
    const { t, articleId, rows, overview } = await setup();
    await overview();
    await t.mutation(internal.summaries.save, {
      userId: "default_user",
      articleId,
      gist: "Fuller gist.",
      thesis: "Fuller point.",
      ideas: [],
      links: [],
      flow: "Flow.",
      model: "on-demand",
    });
    await overview("Late point.", "Late gist.");
    const final = await rows();
    expect(final).toHaveLength(1);
    expect(final[0]).toMatchObject({ thesis: "Fuller point.", flow: "Flow." });
  });

  it("makes one summary when the import and an on-demand request race", async () => {
    const { t, articleId, rows, overview } = await setup();
    await Promise.all([
      overview(),
      t.mutation(internal.summaries.save, {
        userId: "default_user",
        articleId,
        gist: "Fuller gist.",
        thesis: "Fuller point.",
        ideas: [],
        links: [],
        flow: "Flow.",
        model: "on-demand",
      }),
    ]);
    const final = await rows();
    expect(final).toHaveLength(1);
    expect(final[0].thesis).toBeTruthy();
  });

  it("ignores a blank one point, and another library's article", async () => {
    const { t, rows, overview } = await setup();
    expect(await overview("  ", "gist")).toBeNull();
    expect(await rows()).toEqual([]);
    const f = await secondReaderTest(modules);
    const theirs = await f.t.run((ctx) =>
      ctx.db.insert("articles", {
        userId: f.readerLibraryId,
        guid: "x",
        url: "https://example.com/x",
        title: "x",
        extractionStatus: "extracted",
        annotationStatus: "annotated",
        createdAt: 1,
      }),
    );
    await expect(
      f.t.mutation(internal.summaries.saveOverview, {
        userId: "default_user",
        articleId: theirs,
        thesis: "t",
        gist: "g",
        model: "m",
      }),
    ).rejects.toThrow("Article not found");
    void t;
  });
});
