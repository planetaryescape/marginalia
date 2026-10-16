/// <reference types="vite/client" />

import { describe, expect, it } from "vitest";
import { secondReaderTest } from "../test/owner";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");

async function fixture() {
  const f = await secondReaderTest(modules);
  const articleId = await f.t.run((ctx) =>
    ctx.db.insert("articles", {
      userId: "default_user",
      guid: "fixture",
      url: "https://example.com/fixture",
      title: "Markets",
      extractionStatus: "extracted",
      annotationStatus: "annotated",
      createdAt: 1,
    }),
  );
  return { ...f, articleId };
}

const lookup = (
  articleId: Awaited<ReturnType<typeof fixture>>["articleId"],
) => ({
  articleId,
  word: "Elastic,",
  sentence: "Demand for this product is elastic.",
  paragraphIndex: 3,
  sense: "adj. Changing a lot when the price changes.",
});

describe("lookups", () => {
  it("records a lookup under the signed-in reader, whatever the arguments say", async () => {
    const { owner, articleId, t } = await fixture();
    // `userId` is not an argument: a forged one is rejected, not stored
    await expect(
      owner.mutation(api.lookups.record, {
        ...lookup(articleId),
        userId: "someone_else",
      } as never),
    ).rejects.toThrow();
    await owner.mutation(api.lookups.record, lookup(articleId));
    const rows = await t.run((ctx) => ctx.db.query("lookups").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      userId: "default_user",
      word: "Elastic,",
      wordKey: "elastic",
      paragraphIndex: 3,
    });
  });

  it("records a retried lookup once and keeps the latest sense", async () => {
    const { owner, articleId, t } = await fixture();
    await owner.mutation(api.lookups.record, lookup(articleId));
    await owner.mutation(api.lookups.record, {
      ...lookup(articleId),
      sense: "adj. Responsive to price.",
    });
    const rows = await t.run((ctx) => ctx.db.query("lookups").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0].sense).toBe("adj. Responsive to price.");
  });

  it("keeps the same word looked up in two places as two entries", async () => {
    const { owner, articleId, t } = await fixture();
    await owner.mutation(api.lookups.record, lookup(articleId));
    await owner.mutation(api.lookups.record, {
      ...lookup(articleId),
      paragraphIndex: 9,
      sentence: "Supply is not elastic.",
    });
    expect(
      await t.run((ctx) => ctx.db.query("lookups").collect()),
    ).toHaveLength(2);
  });

  it('keeps C++ and C# apart but treats "elastic," and "elastic" as one word', async () => {
    const { owner, articleId, t } = await fixture();
    for (const word of ["C++", "C#", "elastic,", "(elastic)", "elastic"])
      await owner.mutation(api.lookups.record, {
        ...lookup(articleId),
        word,
        sentence: `About ${word}.`,
      });
    const keys = (await t.run((ctx) => ctx.db.query("lookups").collect())).map(
      (row) => row.wordKey,
    );
    expect(keys).toEqual(["c++", "c#", "elastic", "elastic", "elastic"]);
  });

  it("keeps the sense to a line", async () => {
    const { owner, articleId, t } = await fixture();
    await owner.mutation(api.lookups.record, {
      ...lookup(articleId),
      sense: "x".repeat(2000),
    });
    const [row] = await t.run((ctx) => ctx.db.query("lookups").collect());
    expect(row.sense.length).toBeLessThanOrEqual(300);
  });

  it("refuses an empty word or sense", async () => {
    const { owner, articleId } = await fixture();
    await expect(
      owner.mutation(api.lookups.record, { ...lookup(articleId), word: " ," }),
    ).rejects.toThrow();
    await expect(
      owner.mutation(api.lookups.record, { ...lookup(articleId), sense: " " }),
    ).rejects.toThrow();
  });

  it("never records against another reader's article", async () => {
    const { reader, articleId, t } = await fixture();
    await expect(
      reader.mutation(api.lookups.record, lookup(articleId)),
    ).rejects.toThrow(/not found/i);
    expect(await t.run((ctx) => ctx.db.query("lookups").collect())).toEqual([]);
  });
});
