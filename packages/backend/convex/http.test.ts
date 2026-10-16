/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ownerWithKey } from "../test/owner";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("library search HTTP results", () => {
  it("does not expose a model's exclusion explanation as a search result", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-only");
    const t = await ownerWithKey(modules);
    const embedding = Array.from({ length: 1536 }, () => 1);
    const [rejectedId, matchedId] = await t.run(async (ctx) => {
      const ids = [];
      for (const [guid, title] of [
        ["rejected", "Cows and methane"],
        ["matched", "Sleep in daily life"],
      ])
        ids.push(
          await ctx.db.insert("articles", {
            userId: "default_user",
            guid,
            url: `https://example.com/${guid}`,
            title,
            excerpt: title,
            embedding,
            extractionStatus: "extracted",
            annotationStatus: "annotated",
            createdAt: Date.now(),
          }),
        );
      return ids;
    });
    vi.stubGlobal("fetch", async (url: string) => {
      if (url.endsWith("/embeddings"))
        return Response.json({ data: [{ index: 0, embedding }] });
      if (!url.endsWith("/chat/completions"))
        throw new Error("Unexpected provider request");
      return Response.json({
        choices: [
          {
            finish_reason: "stop",
            message: {
              content: JSON.stringify({
                matches: [
                  {
                    articleId: rejectedId,
                    relevant: true,
                    reason: "Not a match for life directly; omitted.",
                  },
                  {
                    articleId: matchedId,
                    relevant: true,
                    reason: "Explores sleep's role in daily life.",
                  },
                ],
              }),
            },
          },
        ],
      });
    });
    const response = await t.fetch("/api/library/search", {
      method: "POST",
      body: JSON.stringify({ question: "life" }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("Server-Timing")).toMatch(
      /ai;dur=\d+, embed;dur=\d+, retrieve;dur=\d+, rank;dur=\d+, total;dur=\d+/,
    );
    expect(await response.json()).toEqual({
      matches: [
        {
          articleId: matchedId,
          title: "Sleep in daily life",
          author: null,
          minutes: null,
          status: "Unread",
          reason: "Explores sleep's role in daily life.",
        },
      ],
    });
  });
});
const request = {
  mode: "explain",
  title: "An article",
  paragraphs: ["A passage"],
  selection: "A passage",
  paragraphIndex: 0,
};
function sse(lines: string[]) {
  return new Response(lines.map((line) => `data: ${line}\n\n`).join(""), {
    headers: { "Content-Type": "text/event-stream" },
  });
}

describe("companion HTTP streaming", () => {
  it("falls back after a network failure before the first token", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-only");
    vi.spyOn(console, "error").mockImplementation(() => {});
    const provider = vi
      .fn()
      .mockRejectedValueOnce(new Error("Network failed"))
      .mockResolvedValueOnce(
        sse([
          JSON.stringify({ choices: [{ delta: { content: "An answer." } }] }),
          "[DONE]",
        ]),
      );
    vi.stubGlobal("fetch", provider);
    const response = await (await ownerWithKey(modules)).fetch(
      "/api/companion",
      {
        method: "POST",
        body: JSON.stringify(request),
      },
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("An answer.");
    expect(provider).toHaveBeenCalledTimes(2);
    expect(response.headers.get("X-Companion-Model")).toBeTruthy();
  });
  it("fails an interrupted answer instead of completing it as a successful partial response", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-only");
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        sse([
          JSON.stringify({
            choices: [{ delta: { content: "Partial answer" } }],
          }),
          JSON.stringify({ error: { message: "Provider stopped" } }),
        ]),
      ),
    );
    const response = await (await ownerWithKey(modules)).fetch(
      "/api/companion",
      {
        method: "POST",
        body: JSON.stringify(request),
      },
    );
    await expect(response.text()).rejects.toThrow("interrupted");
  });
  it("rejects unauthenticated vault uploads before considering their data", async () => {
    vi.stubEnv("VAULT_INDEXER_API_KEY", "test-only");
    const response = await convexTest(schema, modules).fetch(
      "/api/vault/upload",
      { method: "POST", body: "{}" },
    );
    expect(response.status).toBe(401);
  });
});
