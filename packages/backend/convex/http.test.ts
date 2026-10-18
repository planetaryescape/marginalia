/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ownerWithKey } from "../test/owner";
import { components } from "./_generated/api";
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
          status: "Up next",
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
  it("keeps the legacy request-size limit on the new direct path", async () => {
    const t = await ownerWithKey(modules);
    const provider = vi.fn();
    vi.stubGlobal("fetch", provider);
    const response = await t.fetch("/api/companion", {
      method: "POST",
      headers: { Origin: "https://reader.bhekani.com" },
      body: JSON.stringify({ ...request, paragraphs: ["x".repeat(300_001)] }),
    });
    expect(response.status).toBe(413);
    expect(provider).not.toHaveBeenCalled();
  });
  it.each([
    "companion",
    "library",
    "library/find",
    "library/search",
  ])("still checks live session revocation for direct /api/%s", async (path) => {
    const t = await ownerWithKey(modules);
    const identity = await t.run((ctx) => ctx.auth.getUserIdentity());
    if (!identity) throw new Error("Fixture missing identity");
    await t.mutation(components.betterAuth.adapter.deleteOne, {
      input: {
        model: "session",
        where: [{ field: "_id", value: String(identity.sessionId) }],
      },
    });
    const provider = vi.fn();
    vi.stubGlobal("fetch", provider);
    const response = await t.fetch(`/api/${path}`, {
      method: "POST",
      headers: { Origin: "https://reader.bhekani.com" },
      body: JSON.stringify(request),
    });
    expect(response.status).toBe(401);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
      "https://reader.bhekani.com",
    );
    expect(response.headers.get("Timing-Allow-Origin")).toBe(
      "https://reader.bhekani.com",
    );
    expect(response.headers.get("Server-Timing")).toMatch(
      /^auth;dur=\d+, total;dur=\d+$/,
    );
    expect(provider).not.toHaveBeenCalled();
  });
  it.each([
    "companion",
    "library",
  ])("rejects untrusted origins before any paid work on /api/%s", async (path) => {
    const t = await ownerWithKey(modules);
    const provider = vi.fn();
    vi.stubGlobal("fetch", provider);
    const response = await t.fetch(`/api/${path}`, {
      method: "POST",
      headers: { Origin: "https://evil.example" },
      body: JSON.stringify(request),
    });
    expect(response.status).toBe(403);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(response.headers.get("Server-Timing")).toBeNull();
    expect(provider).not.toHaveBeenCalled();
  });
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
    expect(response.headers.get("Server-Timing")).toMatch(
      /^auth;dur=\d+, budget;dur=\d+, parse;dur=\d+, ai;dur=\d+, retrieve;dur=\d+, attempt-1-failed;dur=\d+, first-token;dur=\d+, total;dur=\d+$/,
    );
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

describe("library search CORS", () => {
  const allowed = "https://reader.bhekani.com";

  for (const path of ["find", "search"]) {
    it(`answers a /api/library/${path} preflight for the reader origin`, async () => {
      const t = convexTest(schema, modules);
      const response = await t.fetch(`/api/library/${path}`, {
        method: "OPTIONS",
        headers: {
          Origin: allowed,
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers": "authorization,content-type",
        },
      });
      expect(response.status).toBe(204);
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe(allowed);
      expect(response.headers.get("Access-Control-Allow-Headers")).toBe(
        "authorization, content-type",
      );
      expect(
        response.headers.get("Access-Control-Allow-Credentials"),
      ).toBeNull();
    });

    it(`gives /api/library/${path} no CORS headers to another origin`, async () => {
      const t = convexTest(schema, modules);
      const preflight = await t.fetch(`/api/library/${path}`, {
        method: "OPTIONS",
        headers: { Origin: "https://evil.example" },
      });
      expect(preflight.headers.get("Access-Control-Allow-Origin")).toBeNull();
      const post = await t.fetch(`/api/library/${path}`, {
        method: "POST",
        headers: { Origin: "https://evil.example" },
        body: JSON.stringify({ question: "life" }),
      });
      expect(post.status).toBe(403);
      expect(post.headers.get("Access-Control-Allow-Origin")).toBeNull();
    });

    it(`adds CORS headers to a signed-out /api/library/${path} error for the reader origin`, async () => {
      const t = convexTest(schema, modules);
      const post = await t.fetch(`/api/library/${path}`, {
        method: "POST",
        headers: { Origin: allowed },
        body: JSON.stringify({ question: "life" }),
      });
      expect(post.status).toBe(401);
      expect(post.headers.get("Access-Control-Allow-Origin")).toBe(allowed);
      expect(post.headers.get("Vary")).toBe("Origin");
    });
  }

  it("reads the allowed origins from READER_ORIGINS", async () => {
    vi.stubEnv("READER_ORIGINS", "https://staging.example");
    const t = convexTest(schema, modules);
    const staging = await t.fetch("/api/library/find", {
      method: "OPTIONS",
      headers: { Origin: "https://staging.example" },
    });
    expect(staging.headers.get("Access-Control-Allow-Origin")).toBe(
      "https://staging.example",
    );
    const production = await t.fetch("/api/library/find", {
      method: "OPTIONS",
      headers: { Origin: allowed },
    });
    expect(production.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});
