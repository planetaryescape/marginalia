/// <reference types="vite/client" />
import { afterEach, describe, expect, it, vi } from "vitest";
import { secondReaderTest } from "../test/owner";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

const modules = import.meta.glob("./**/*.ts");

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

type Fixture = Awaited<ReturnType<typeof secondReaderTest>>;

const ARTICLE = {
  externalId: "issue-42",
  title: "The quiet death of the three-pane layout",
  html: "<p>Why every RSS reader since 2002 shipped the same window.</p><script>alert(1)</script>",
  url: "https://example.com/three-pane",
  author: "Long Reads Weekly",
  publishedAt: 1_760_000_000_000,
};

function send(t: Fixture["t"], token: string | null, body: unknown = ARTICLE) {
  return t.fetch("/api/v1/articles", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

function highlights(t: Fixture["t"], token: string, articleId: string) {
  return t.fetch(`/api/v1/articles/${articleId}/highlights`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

describe("personal API tokens", () => {
  it("shows a token once and lists only its name and last four characters", async () => {
    const { reader } = await secondReaderTest(modules);
    const { token } = await reader.action(api.apiTokens.create, {
      name: "Mail on my laptop",
    });
    expect(token).toMatch(/^mrg_[A-Za-z0-9_-]{43}$/);
    const listed = await reader.query(api.apiTokens.list, {});
    expect(listed).toEqual([
      expect.objectContaining({
        name: "Mail on my laptop",
        last4: token.slice(-4),
        lastUsedAt: null,
      }),
    ]);
    expect(JSON.stringify(listed)).not.toContain(token);
  });

  it("refuses requests without a valid token", async () => {
    const { t, reader } = await secondReaderTest(modules);
    expect((await send(t, null)).status).toBe(401);
    expect((await send(t, "mrg_not-a-real-token")).status).toBe(401);
    const { token } = await reader.action(api.apiTokens.create, {
      name: "App",
    });
    expect((await send(t, token.replace("mrg_", "xyz_"))).status).toBe(401);
  });

  it("stops a token working once it is revoked or its reader is disabled", async () => {
    const { t, reader, readerLibraryId } = await secondReaderTest(modules);
    const first = await reader.action(api.apiTokens.create, { name: "One" });
    const second = await reader.action(api.apiTokens.create, { name: "Two" });
    await reader.mutation(api.apiTokens.revoke, { tokenId: first.id });
    expect((await send(t, first.token)).status).toBe(401);
    await t.run(async (ctx) => {
      const row = await ctx.db
        .query("readers")
        .withIndex("by_libraryId", (q) => q.eq("libraryId", readerLibraryId))
        .unique();
      if (row) await ctx.db.patch(row._id, { status: "disabled" });
    });
    expect((await send(t, second.token)).status).toBe(401);
  });

  it("never lets one reader revoke another reader's token", async () => {
    const { owner, reader } = await secondReaderTest(modules);
    const { id } = await reader.action(api.apiTokens.create, { name: "Mine" });
    await expect(
      owner.mutation(api.apiTokens.revoke, { tokenId: id }),
    ).rejects.toThrow("Token not found");
  });
});

describe("sending an article in", () => {
  it("stores it once in the token's library, keyed by the sender's ID", async () => {
    const { t, reader, readerLibraryId } = await secondReaderTest(modules);
    vi.stubEnv("SITE_URL", "https://reader.example.com");
    const { token } = await reader.action(api.apiTokens.create, {
      name: "App",
    });

    const created = await send(t, token);
    expect(created.status).toBe(201);
    const body = await created.json();
    expect(body).toEqual({
      articleId: expect.any(String),
      readUrl: `https://reader.example.com/read/${body.articleId}`,
      created: true,
    });

    const again = await send(t, token, { ...ARTICLE, title: "Renamed" });
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({
      articleId: body.articleId,
      created: false,
    });

    const article = await t.run((ctx) =>
      ctx.db.get(body.articleId as Id<"articles">),
    );
    expect(article).toMatchObject({
      userId: readerLibraryId,
      guid: "external:issue-42",
      url: ARTICLE.url,
      title: ARTICLE.title,
      author: ARTICLE.author,
      publishedAt: ARTICLE.publishedAt,
    });
    expect(article?.contentHtml).not.toContain("<script");
  });

  it("accepts an article without a web address", async () => {
    const { t, reader } = await secondReaderTest(modules);
    const { token } = await reader.action(api.apiTokens.create, {
      name: "App",
    });
    const { url: _url, ...withoutUrl } = ARTICLE;
    const response = await send(t, token, withoutUrl);
    expect(response.status).toBe(201);
  });

  it("rejects a malformed article", async () => {
    const { t, reader } = await secondReaderTest(modules);
    const { token } = await reader.action(api.apiTokens.create, {
      name: "App",
    });
    for (const body of [
      { ...ARTICLE, html: "" },
      { ...ARTICLE, externalId: undefined },
      { ...ARTICLE, url: "javascript:alert(1)" },
    ])
      expect((await send(t, token, body)).status).toBe(400);
  });
});

describe("reading highlights back", () => {
  it("returns the article's highlights only to its own library", async () => {
    const { t, owner, reader } = await secondReaderTest(modules);
    const mine = await reader.action(api.apiTokens.create, { name: "App" });
    const theirs = await owner.action(api.apiTokens.create, { name: "App" });
    const { articleId } = await (await send(t, mine.token)).json();
    await reader.mutation(api.highlights.create, {
      articleId,
      kind: "highlight",
      text: "shipped the same window",
      paragraphIndex: 0,
    });

    const response = await highlights(t, mine.token, articleId);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      articleId,
      title: ARTICLE.title,
      highlights: [
        {
          id: expect.any(String),
          kind: "highlight",
          text: "shipped the same window",
          paragraphIndex: 0,
          createdAt: expect.any(Number),
        },
      ],
    });

    expect((await highlights(t, theirs.token, articleId)).status).toBe(404);
    expect((await highlights(t, mine.token, "not-an-id")).status).toBe(404);
  });
});
