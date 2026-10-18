/// <reference types="vite/client" />
import { afterEach, expect, it, vi } from "vitest";
import { ownerWithKey, secondReaderTest } from "../test/owner";
import { internal } from "./_generated/api";
import {
  type PreparedReference,
  representationHash,
  sourceHash,
} from "./lib/preparedRepresentation";
import { purgePreparedPage } from "./preparedArticles";

const modules = import.meta.glob("./**/*.ts");
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
async function fixture(unitIndex?: number) {
  const t = await ownerWithKey(modules);
  const content =
    "Original plain text is not the displayed paragraph representation.";
  const contentHtml = "<p>First &amp; exact.</p><p>第二段 🧪</p>";
  const articleId = await t.run(async (ctx) => {
    const id = await ctx.db.insert("articles", {
      userId: "default_user",
      guid: "fixture",
      url: "https://example.com",
      title: "Fixture",
      content,
      contentHtml,
      extractionStatus: "extracted",
      annotationStatus: "annotated",
      createdAt: 0,
      bookUnitCount: unitIndex === undefined ? undefined : 1,
    });
    if (unitIndex !== undefined)
      await ctx.db.insert("bookUnits", {
        userId: "default_user",
        articleId: id,
        index: unitIndex,
        title: "Part",
        content,
        contentHtml,
        wordCount: 10,
        estimatedReadMinutes: 1,
        annotationStatus: "annotated",
      });
    return id;
  });
  const paragraphs = [
    "First & exact.",
    "第二段 🧪",
    "",
    "A very long paragraph. ".repeat(1500),
  ];
  const prepareBody = {
    articleId,
    unitIndex,
    sourceHash: await sourceHash(content, contentHtml),
    paragraphs,
  };
  const prepare = () =>
    t.fetch("/api/companion/prepare", {
      method: "POST",
      body: JSON.stringify(prepareBody),
    });
  return { t, articleId, paragraphs, prepareBody, prepare };
}
const ask = (
  articleId: string,
  prepared: PreparedReference,
  unitIndex?: number,
) => ({
  mode: "article",
  title: "Fixture",
  articleId,
  unitIndex,
  prepared,
  question: "What does ¶2 say?",
  paragraphIndex: null,
});
function providerMock() {
  const provider = vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    if (body.input) {
      const inputs = Array.isArray(body.input) ? body.input : [body.input];
      return Response.json({
        data: inputs.map((_: string, index: number) => ({
          index,
          embedding: Array(1536).fill(1),
        })),
      });
    }
    return new Response(
      'data: {"choices":[{"delta":{"content":"Exact answer ¶2."}}]}\n\ndata: [DONE]\n\n',
      { headers: { "Content-Type": "text/event-stream" } },
    );
  });
  vi.stubGlobal("fetch", provider);
  return provider;
}

it("prepares without provider work; two referenced Ask turns retain exact citations and warm vectors", async () => {
  const f = await fixture();
  const provider = providerMock();
  const response = await f.prepare();
  expect(response.status).toBe(200);
  const { prepared } = await response.json();
  expect(provider).not.toHaveBeenCalled();
  for (let turn = 0; turn < 2; turn++) {
    const response = await f.t.fetch("/api/companion", {
      method: "POST",
      body: JSON.stringify(ask(f.articleId, prepared)),
    });
    expect(await response.text()).toBe("Exact answer ¶2.");
  }
  const bodies = provider.mock.calls.map(([, init]) =>
    JSON.parse(String(init.body)),
  );
  expect(
    bodies.filter((b) => Array.isArray(b.input) && b.input.length > 1),
  ).toHaveLength(1);
  const prompts = bodies
    .filter((b) => b.messages)
    .map((b) => JSON.stringify(b.messages));
  expect(prompts).toHaveLength(2);
  expect(prompts[0]).toContain("¶2");
  expect(prompts[0]).toContain("第二段 🧪");
  expect(prompts[1]).toBe(prompts[0]);
  expect(JSON.stringify(ask(f.articleId, prepared)).length).toBeLessThan(500);
});

it.each([
  undefined,
  0,
])("reuses exactly one stored version for article/unit %s, including concurrent tabs", async (unitIndex) => {
  const f = await fixture(unitIndex);
  const responses = await Promise.all([f.prepare(), f.prepare()]);
  const [{ prepared: a }, { prepared: b }] = await Promise.all(
    responses.map((r) => r.json()),
  );
  expect(a).toEqual(b);
  expect(
    await f.t.query(internal.preparedArticles.read, {
      userId: "default_user",
      articleId: f.articleId,
      unitIndex,
      reference: a,
    }),
  ).toEqual(f.paragraphs);
  const rows = await f.t.run((ctx) =>
    ctx.db.query("preparedArticles").collect(),
  );
  expect(rows).toHaveLength(1);
  expect(rows[0].bytes).toBe(
    new TextEncoder().encode(JSON.stringify(f.paragraphs)).byteLength,
  );
});

it("missing, superseded, source-changed and deleted refs are explicit misses with no provider work", async () => {
  const f = await fixture();
  const { prepared } = await (await f.prepare()).json();
  const provider = providerMock();
  async function miss(ref: PreparedReference = prepared) {
    const response = await f.t.fetch("/api/companion", {
      method: "POST",
      body: JSON.stringify(ask(f.articleId, ref)),
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      code: "prepared_reference_miss",
    });
    expect(provider).not.toHaveBeenCalled();
  }
  await miss({ ...prepared, representationHash: "0".repeat(64) });
  await f.t.mutation(internal.preparedArticles.prepare, {
    ...f.prepareBody,
    userId: "default_user",
    paragraphs: ["A new exact representation"],
  });
  await miss();
  expect(
    await f.t.run((ctx) => ctx.db.query("preparedArticles").collect()),
  ).toHaveLength(1);
  await f.t.run((ctx) =>
    ctx.db.patch(f.articleId, { contentHtml: "<p>Changed body</p>" }),
  );
  await miss();
  expect((await f.prepare()).status).toBe(409);
  await f.t.run((ctx) => ctx.db.delete(f.articleId));
  await miss();
});

it("foreign refs and disabled/deleting readers cannot prepare or use private text", async () => {
  const {
    t,
    owner,
    reader: other,
    readerLibraryId,
  } = await secondReaderTest(modules);
  const articleId = await t.run((ctx) =>
    ctx.db.insert("articles", {
      userId: "default_user",
      guid: "private",
      url: "https://example.com",
      title: "Private",
      content: "Original",
      extractionStatus: "extracted",
      annotationStatus: "annotated",
      createdAt: 0,
    }),
  );
  const body = {
    articleId,
    paragraphs: ["Original"],
    sourceHash: await sourceHash("Original"),
  };
  const { prepared } = await (
    await owner.fetch("/api/companion/prepare", {
      method: "POST",
      body: JSON.stringify(body),
    })
  ).json();
  expect(
    (
      await other.fetch("/api/companion/prepare", {
        method: "POST",
        body: JSON.stringify(body),
      })
    ).status,
  ).toBe(409);
  expect(
    (
      await other.fetch("/api/companion", {
        method: "POST",
        body: JSON.stringify(ask(articleId, prepared)),
      })
    ).status,
  ).toBe(409);
  await t.run((ctx) => ctx.db.patch(articleId, { userId: readerLibraryId }));
  const ownedResponse = await other.fetch("/api/companion/prepare", {
    method: "POST",
    body: JSON.stringify(body),
  });
  expect(ownedResponse.status).toBe(200);
  const ownedReference = (await ownedResponse.json()).prepared;
  await t.run(async (ctx) => {
    const row = await ctx.db
      .query("readers")
      .withIndex("by_libraryId", (q) => q.eq("libraryId", readerLibraryId))
      .unique();
    if (!row) throw new Error("Missing fixture reader");
    await ctx.db.patch(row._id, { deletingAt: 1 });
  });
  expect(
    (
      await other.fetch("/api/companion/prepare", {
        method: "POST",
        body: JSON.stringify(body),
      })
    ).status,
  ).toBe(409);
  const denied = await other.fetch("/api/companion", {
    method: "POST",
    body: JSON.stringify(ask(articleId, ownedReference)),
  });
  expect(denied.status).toBe(409);
  expect(await denied.json()).toMatchObject({
    code: "prepared_reference_miss",
  });
});

it("enforces UTF-8 rather than JS length, never truncates, and exposes bounded purge", async () => {
  const f = await fixture();
  const response = await f.t.fetch("/api/companion/prepare", {
    method: "POST",
    body: JSON.stringify({
      ...f.prepareBody,
      paragraphs: ["界".repeat(160_000), "界".repeat(160_000)],
    }),
  });
  expect(response.status).toBe(413);
  expect(
    await f.t.run((ctx) => ctx.db.query("preparedArticles").collect()),
  ).toHaveLength(0);
  // A worst-case UTF-8 packet that fit the old 300k-character transport still fits.
  const unicode = ["界".repeat(299_000)];
  const compatible = await f.t.fetch("/api/companion/prepare", {
    method: "POST",
    body: JSON.stringify({ ...f.prepareBody, paragraphs: unicode }),
  });
  expect(compatible.status).toBe(200);
  const { prepared } = await compatible.json();
  expect(
    await f.t.query(internal.preparedArticles.read, {
      userId: "default_user",
      articleId: f.articleId,
      reference: prepared,
    }),
  ).toEqual(unicode);
  const atLimit = [
    "x".repeat(250_000),
    "x".repeat(250_000),
    "x".repeat(250_000),
    "x".repeat(199_987),
  ];
  expect(
    (
      await f.t.fetch("/api/companion/prepare", {
        method: "POST",
        body: JSON.stringify({ ...f.prepareBody, paragraphs: atLimit }),
      })
    ).status,
  ).toBe(200);
  atLimit[3] += "x";
  expect(
    (
      await f.t.fetch("/api/companion/prepare", {
        method: "POST",
        body: JSON.stringify({ ...f.prepareBody, paragraphs: atLimit }),
      })
    ).status,
  ).toBe(413);
  await f.prepare();
  expect(await f.t.run((ctx) => purgePreparedPage(ctx, "someone-else"))).toBe(
    0,
  );
  expect(
    await f.t.run((ctx) => ctx.db.query("preparedArticles").collect()),
  ).toHaveLength(1);
  expect(
    await f.t.run((ctx) => purgePreparedPage(ctx, "default_user", f.articleId)),
  ).toBe(1);
  expect(
    await f.t.run((ctx) => ctx.db.query("preparedArticles").collect()),
  ).toHaveLength(0);
});

it("hashes paragraph boundaries unambiguously including NUL and Unicode", async () => {
  expect(await representationHash(["a\u0000b", "c"])).not.toBe(
    await representationHash(["a", "b\u0000c"]),
  );
});

it("prepared passage Ask preserves the selected original paragraph and old full-body compatibility, including unit zero", async () => {
  const f = await fixture(0);
  const { prepared } = await (await f.prepare()).json();
  const provider = providerMock();
  const base = {
    mode: "ask",
    title: "Fixture",
    articleId: f.articleId,
    unitIndex: 0,
    selection: "第二段 🧪",
    paragraphIndex: 1,
    question: "Explain these words?",
  };
  for (const context of [{ prepared }, { paragraphs: f.paragraphs }]) {
    const response = await f.t.fetch("/api/companion", {
      method: "POST",
      body: JSON.stringify({ ...base, ...context }),
    });
    expect(await response.text()).toBe("Exact answer ¶2.");
  }
  const prompts = provider.mock.calls.map(
    ([, init]) => JSON.parse(String(init.body)).messages,
  );
  expect(prompts).toHaveLength(2);
  expect(prompts[0]).toEqual(prompts[1]);
  expect(JSON.stringify(prompts[0])).toContain("第二段 🧪");
  expect(JSON.stringify(prompts[0])).toContain("¶2");
});

it("purges at most three near-limit rows per call and never touches another library", async () => {
  const f = await fixture();
  const text = "x".repeat(940_000);
  await f.t.run(async (ctx) => {
    for (let unitIndex = 0; unitIndex < 5; unitIndex++)
      await ctx.db.insert("preparedArticles", {
        userId: "default_user",
        articleId: f.articleId,
        unitIndex,
        format: "safe-paragraphs-v1",
        sourceHash: "a".repeat(64),
        representationHash: "b".repeat(64),
        paragraphs: [
          text.slice(0, 250_000),
          text.slice(250_000, 500_000),
          text.slice(500_000, 750_000),
          text.slice(750_000),
        ],
        bytes: 940_013,
      });
    await ctx.db.insert("preparedArticles", {
      userId: "other",
      articleId: f.articleId,
      format: "safe-paragraphs-v1",
      sourceHash: "a".repeat(64),
      representationHash: "b".repeat(64),
      paragraphs: ["Private"],
      bytes: 11,
    });
  });
  expect(await f.t.run((ctx) => purgePreparedPage(ctx, "default_user"))).toBe(
    3,
  );
  expect(
    await f.t.run((ctx) =>
      ctx.db
        .query("preparedArticles")
        .withIndex("by_userId_and_articleId_and_unitIndex", (q) =>
          q.eq("userId", "default_user"),
        )
        .collect(),
    ),
  ).toHaveLength(2);
  expect(await f.t.run((ctx) => purgePreparedPage(ctx, "default_user"))).toBe(
    2,
  );
  const remaining = await f.t.run((ctx) =>
    ctx.db.query("preparedArticles").collect(),
  );
  expect(remaining).toHaveLength(1);
  expect(remaining[0].userId).toBe("other");
});
