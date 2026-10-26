/// <reference types="vite/client" />
import { afterEach, describe, expect, it, vi } from "vitest";
import { ownerWithKey } from "../test/owner";
import { api } from "./_generated/api";
import * as aiModels from "./lib/aiModels";
import { sourceHash } from "./lib/preparedRepresentation";

const modules = import.meta.glob("./**/*.ts");
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("article summaries", () => {
  it.each([
    "legacy",
    "current",
  ] as const)("summarizes the authoritative WEB source for a %s client even if it sends displayed paragraphs", async (client) => {
    const t = await ownerWithKey(modules);
    await t.mutation(api.bible.setPreferences, { enabled: true });
    const articleId = await t.run((ctx) =>
      ctx.db.insert("articles", {
        userId: "default_user",
        guid: "bible-summary-boundary",
        url: "https://bible-api.com",
        title: "John 3:16",
        content: "3:16 Public-domain study text",
        contentHtml: "<p>3:16 Public-domain study text</p>",
        bible: {
          reference: "John 3:16",
          translation: "web",
          copyright: "Public domain",
          displayVersionId: 111,
        },
        extractionStatus: "extracted",
        annotationStatus: "annotated",
        createdAt: Date.now(),
      }),
    );
    const generate = vi
      .spyOn(aiModels, "generateObjectWithFallback")
      .mockResolvedValue({
        modelId: "fixture",
        object: {
          gist: "A passage study",
          thesis: "A passage study",
          ideas: [],
          links: [],
          flow: "A passage study",
        },
      });
    await t.action(api.actions.summarize.generate, {
      articleId,
      title: client === "current" ? "John 3:16" : "Displayed edition",
      paragraphs: ["Licensed-dom-canary"],
      ...(client === "current"
        ? {
            sourceHash: await sourceHash(
              "3:16 Public-domain study text",
              "<p>3:16 Public-domain study text</p>",
            ),
          }
        : {}),
    });
    expect(JSON.stringify(generate.mock.calls)).toContain(
      "Public-domain study text",
    );
    expect(JSON.stringify(generate.mock.calls)).not.toContain(
      "Licensed-dom-canary",
    );
    expect(
      await t.query(api.summaries.getByArticle, { articleId }),
    ).toMatchObject({ thesis: "A passage study" });
    expect(generate.mock.calls[0][0].prompt).toContain(
      "John 3:16 — World English Bible study source",
    );
    if (client === "current") {
      await t.action(api.actions.summarize.generate, {
        articleId,
        title: "John 3:16",
        paragraphs: ["Licensed-dom-canary"],
        sourceHash: await sourceHash(
          "3:16 Public-domain study text",
          "<p>3:16 Public-domain study text</p>",
        ),
      });
      expect(generate).toHaveBeenCalledOnce();
      await expect(
        t.action(api.actions.summarize.generate, {
          articleId,
          title: "John 3:16",
          paragraphs: ["Licensed-dom-canary"],
          sourceHash: await sourceHash("Outdated source"),
        }),
      ).rejects.toThrow("Reload the article");
      expect(generate).toHaveBeenCalledOnce();
    }
  });
  it("lets the signed-in owner generate and retrieve an article summary", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-only");
    const provider = vi.fn(
      async (_url: RequestInfo | URL, init?: RequestInit) => {
        const request = JSON.parse(String(init?.body));
        // Reproduce the credit reservation error without paid provider calls.
        if (request.max_tokens !== 4096)
          return Response.json(
            {
              error: {
                code: 402,
                message:
                  "This request requires more credits, or fewer max_tokens. You requested up to 65536 tokens.",
              },
            },
            { status: 402 },
          );
        return Response.json({
          id: "summary-fixture",
          created: 1,
          model: request.model,
          choices: [
            {
              index: 0,
              finish_reason: "stop",
              message: {
                role: "assistant",
                content: JSON.stringify({
                  gist: "Rest is useful.",
                  thesis: "Rest helps people think.",
                  ideas: [
                    {
                      id: "a",
                      label: "Rest helps",
                      detail: "Rest supports clear thinking.",
                      role: "conclusion",
                      paragraphs: [1],
                    },
                  ],
                  links: [],
                  flow: "The article connects rest to clear thinking.",
                }),
              },
            },
          ],
          usage: {
            prompt_tokens: 50,
            completion_tokens: 150,
            total_tokens: 200,
          },
        });
      },
    );
    vi.stubGlobal("fetch", provider);
    const t = await ownerWithKey(modules);
    const articleId = await t.run((ctx) =>
      ctx.db.insert("articles", {
        userId: "default_user",
        guid: "summary-fixture",
        url: "https://example.com/summary-fixture",
        title: "A saved article",
        extractionStatus: "extracted",
        annotationStatus: "annotated",
        createdAt: Date.now(),
      }),
    );
    await t.action(api.actions.summarize.generate, {
      articleId,
      title: "A saved article",
      paragraphs: ["Rest supports clear thinking."],
    });
    expect(
      await t.query(api.summaries.getByArticle, { articleId }),
    ).toMatchObject({ gist: "Rest is useful." });
    expect(provider).toHaveBeenCalledOnce();
  });
});
