/// <reference types="vite/client" />
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ownerWithKey,
  saveTestCredential,
  secondReaderTest,
} from "../test/owner";
import { startTimings } from "./lib/serverTiming";

const modules = import.meta.glob("./**/*.ts");
const embedding = Array.from({ length: 1536 }, () => 1);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function embeddingsOnly() {
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (url: string) => {
    calls.push(url);
    if (url.endsWith("/embeddings"))
      return Response.json({ data: [{ index: 0, embedding }] });
    throw new Error("The search-only path must not call a model");
  });
  return calls;
}

describe("search-only library path", () => {
  it("returns ranked articles without calling a model, and times each stage", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-only");
    const t = await ownerWithKey(modules);
    const calls = embeddingsOnly();
    const ids = await t.run(async (ctx) => {
      const out: Record<string, string> = {};
      for (const [guid, title, minutes] of [
        ["read", "Finished piece", 6],
        ["fresh", "Unread piece", 9],
      ] as const) {
        out[guid] = await ctx.db.insert("articles", {
          userId: "default_user",
          guid,
          url: `https://www.example.com/${guid}`,
          title,
          excerpt: title,
          embedding,
          estimatedReadMinutes: minutes,
          extractionStatus: "extracted",
          annotationStatus: "annotated",
          createdAt: Date.now(),
        });
      }
      await ctx.db.insert("articleInteractions", {
        userId: "default_user",
        articleId: out.read as never,
        action: "finished",
        createdAt: Date.now(),
      });
      return out;
    });

    const response = await t.fetch("/api/library/find", {
      method: "POST",
      body: JSON.stringify({ question: "life" }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      more: false,
      // Up next comes before what the reader has already finished.
      matches: [
        {
          articleId: ids.fresh,
          title: "Unread piece",
          author: null,
          source: "example.com",
          minutes: 9,
          status: "Up next",
        },
        {
          articleId: ids.read,
          title: "Finished piece",
          author: null,
          source: "example.com",
          minutes: 6,
          status: "Finished",
        },
      ],
    });
    expect(response.headers.get("Server-Timing")).toMatch(
      /ai;dur=\d+, embed;dur=\d+, search;dur=\d+, load;dur=\d+, total;dur=\d+/,
    );
    expect(calls.every((url) => url.endsWith("/embeddings"))).toBe(true);
  });

  it("answers a repeated query from the cache and says so in Server-Timing", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-only");
    const t = await ownerWithKey(modules);
    const calls = embeddingsOnly();
    await t.run((ctx) =>
      ctx.db.insert("articles", {
        userId: "default_user",
        guid: "cached",
        url: "https://www.example.com/cached",
        title: "Cached piece",
        excerpt: "Cached piece",
        embedding,
        extractionStatus: "extracted",
        annotationStatus: "annotated",
        createdAt: Date.now(),
      }),
    );
    const find = () =>
      t.fetch("/api/library/find", {
        method: "POST",
        body: JSON.stringify({ question: "  Cached   Piece " }),
      });

    const first = await find();
    const second = await find();

    expect(first.headers.get("Server-Timing")).toMatch(/(^|, )embed;dur=/);
    expect(second.headers.get("Server-Timing")).toMatch(
      /(^|, )embed-cached;dur=\d+/,
    );
    expect(await second.json()).toEqual(await first.json());
    expect(calls).toHaveLength(1);
  });

  it("keeps another reader's articles out of the result", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-only");
    const { t, reader, readerLibraryId } = await secondReaderTest(modules);
    await saveTestCredential(t, readerLibraryId, "openrouter", "reader-key");
    embeddingsOnly();
    await t.run(async (ctx) => {
      for (const [userId, title] of [
        ["default_user", "Owner private piece"],
        [readerLibraryId, "Reader piece"],
      ])
        await ctx.db.insert("articles", {
          userId,
          guid: title,
          url: `https://example.com/${encodeURIComponent(title)}`,
          title,
          excerpt: title,
          embedding,
          extractionStatus: "extracted",
          annotationStatus: "annotated",
          createdAt: Date.now(),
        });
    });
    const find = async (client: typeof reader) =>
      (
        (await (
          await client.fetch("/api/library/find", {
            method: "POST",
            body: JSON.stringify({ question: "piece" }),
          })
        ).json()) as { matches: { title: string }[] }
      ).matches.map((m) => m.title);

    expect(await find(reader)).toEqual(["Reader piece"]);
  });

  it("rejects a too-short search", async () => {
    const t = await ownerWithKey(modules);
    const short = await t.fetch("/api/library/find", {
      method: "POST",
      body: JSON.stringify({ question: "a" }),
    });
    expect(short.status).toBe(400);
  });
});

describe("Server-Timing stages", () => {
  it("reports each stage since the previous mark, then the total", () => {
    let now = 1000;
    const timings = startTimings(() => now);
    now = 1040;
    timings.mark("embed");
    now = 1100;
    timings.mark("search");
    now = 1110;
    expect(timings.header()).toBe("embed;dur=40, search;dur=60, total;dur=110");
  });
});
