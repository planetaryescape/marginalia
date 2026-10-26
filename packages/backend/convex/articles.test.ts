import { describe, expect, it } from "vitest";
import { ownerTest } from "../test/owner";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");

type Seed = {
  userId?: string;
  guid: string;
  url: string;
  title?: string;
  saved?: boolean;
};

async function library(seeds: Seed[]) {
  const t = await ownerTest(modules);
  await t.run(async (ctx) => {
    for (const [i, s] of seeds.entries()) {
      const articleId = await ctx.db.insert("articles", {
        userId: s.userId ?? "default_user",
        guid: s.guid,
        url: s.url,
        title: s.title ?? `article ${i}`,
        extractionStatus: "extracted",
        annotationStatus: "annotated",
        estimatedReadMinutes: 6,
        createdAt: Date.now(),
      });
      if (s.saved)
        await ctx.db.insert("savedArticles", {
          userId: "default_user",
          articleId,
          savedAt: Date.now(),
        });
    }
  });
  return t;
}

const find = (t: Awaited<ReturnType<typeof library>>, url: string) =>
  t.query(api.articles.findByUrl, { url });

describe("findByUrl", () => {
  it("finds an article by the GUID it was stored under", async () => {
    // A feed's GUID is often its permalink, while the stored URL carries tracking
    const t = await library([
      {
        guid: "https://example.com/post-42/",
        url: "https://example.com/post-42?utm_source=feed",
        title: "by guid",
      },
    ]);
    expect(await find(t, "https://example.com/post-42")).toMatchObject({
      title: "by guid",
      estimatedReadMinutes: 6,
      saved: false,
    });
  });

  it("finds a feed article by its URL when the GUID differs", async () => {
    const t = await library([
      {
        guid: "tag:feed,2026:42",
        url: "https://example.com/post-42",
        title: "feed post",
      },
    ]);
    expect(await find(t, "https://example.com/post-42")).toMatchObject({
      title: "feed post",
    });
  });

  it("matches across a fragment, a trailing slash and surrounding space", async () => {
    const t = await library([
      { guid: "g1", url: "https://example.com/essays/focus/", title: "essay" },
    ]);
    expect(
      await find(t, "  https://example.com/essays/focus#comments "),
    ).toMatchObject({ title: "essay" });
    expect(await find(t, "https://example.com/essays/focus")).toMatchObject({
      title: "essay",
    });
  });

  it("reports whether the reader has already saved it", async () => {
    const t = await library([
      { guid: "g1", url: "https://example.com/a", saved: true },
    ]);
    expect(await find(t, "https://example.com/a")).toMatchObject({
      saved: true,
    });
  });

  it("returns null for a URL the reader does not have", async () => {
    const t = await library([{ guid: "g1", url: "https://example.com/a" }]);
    expect(await find(t, "https://example.com/b")).toBeNull();
  });

  it("does not see another reader's copy", async () => {
    const t = await library([
      {
        userId: "another_reader",
        guid: "g1",
        url: "https://example.com/private",
        saved: true,
      },
    ]);
    expect(await find(t, "https://example.com/private")).toBeNull();
    expect(await find(t, "g1")).toBeNull();
  });
});
