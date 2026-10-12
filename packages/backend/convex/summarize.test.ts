/// <reference types="vite/client" />
import { afterEach, describe, expect, it, vi } from "vitest";
import { ownerTest } from "../test/owner";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("article summaries", () => {
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
    const t = await ownerTest(modules);
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
