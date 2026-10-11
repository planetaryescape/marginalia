/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
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
    const response = await convexTest(schema, modules).fetch("/api/companion", {
      method: "POST",
      body: JSON.stringify(request),
    });
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
    const response = await convexTest(schema, modules).fetch("/api/companion", {
      method: "POST",
      body: JSON.stringify(request),
    });
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
