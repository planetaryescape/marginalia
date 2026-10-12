/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { secondReaderTest, TEST_ENCRYPTION_KEY } from "../test/owner";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { READER_LIMITS } from "./limits";

const modules = import.meta.glob("./**/*.ts");

beforeEach(() => {
  vi.stubEnv("PROVIDER_KEYS_ENCRYPTION_KEY", TEST_ENCRYPTION_KEY);
  vi.stubEnv("OPENROUTER_API_KEY", "");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("per-reader limits", () => {
  it("caps provider key saves per reader per hour, before contacting the provider", async () => {
    const { reader, owner } = await secondReaderTest(modules);
    const provider = vi.fn(async () => Response.json({ data: [] }));
    vi.stubGlobal("fetch", provider);
    for (let i = 0; i < 10; i++)
      await reader.action(api.providerCredentials.save, {
        provider: "openai",
        apiKey: `sk-reader-openai-key-fixture-${i}000`,
      });
    await expect(
      reader.action(api.providerCredentials.save, {
        provider: "openai",
        apiKey: "sk-reader-openai-key-fixture-9999",
      }),
    ).rejects.toThrow("Too many key changes");
    expect(provider).toHaveBeenCalledTimes(10);
    // Another reader's budget is separate
    await owner.action(api.providerCredentials.save, {
      provider: "openai",
      apiKey: "sk-owner-openai-key-fixture-0001",
    });
  });

  it("caps AI requests per reader per minute across endpoints with a clear 429", async () => {
    const { t, reader, owner, readerLibraryId } =
      await secondReaderTest(modules);
    const provider = vi.fn();
    vi.stubGlobal("fetch", provider);
    const paths = ["companion", "library", "library/search"];
    for (let i = 0; i < READER_LIMITS.ai.max; i++) {
      const response = await reader.fetch(`/api/${paths[i % 3]}`, {
        method: "POST",
        body: "{}",
      });
      expect(response.status).toBe(400);
    }
    for (const path of paths) {
      const limited = await reader.fetch(`/api/${path}`, {
        method: "POST",
        body: "{}",
      });
      expect(limited.status).toBe(429);
      expect(await limited.json()).toEqual({
        code: "rate_limited",
        error: READER_LIMITS.ai.message,
      });
    }
    // Summaries draw on the same budget
    const articleId: Id<"articles"> = await t.run((ctx) =>
      ctx.db.insert("articles", {
        userId: readerLibraryId,
        guid: "g",
        url: "https://example.com/a",
        title: "A",
        extractionStatus: "extracted",
        annotationStatus: "pending",
        createdAt: Date.now(),
      }),
    );
    await expect(
      reader.action(api.actions.summarize.generate, {
        articleId,
        title: "A",
        paragraphs: ["One."],
      }),
    ).rejects.toThrow(READER_LIMITS.ai.message);
    expect(provider).not.toHaveBeenCalled();
    // The owner is unaffected
    const ownerResponse = await owner.fetch("/api/companion", {
      method: "POST",
      body: "{}",
    });
    expect(ownerResponse.status).toBe(400);
    // The window resets
    await t.run(async (ctx) => {
      const rows = await ctx.db.query("readerLimits").take(10);
      for (const row of rows)
        await ctx.db.patch(row._id, { startedAt: Date.now() - 61_000 });
    });
    const after = await reader.fetch("/api/companion", {
      method: "POST",
      body: "{}",
    });
    expect(after.status).toBe(400);
  });
});
