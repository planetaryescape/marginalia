import { afterEach, expect, it, vi } from "vitest";
import { embedText } from "./embeddings";

afterEach(() => vi.unstubAllGlobals());
it("Stop aborts embeddings even when a provider adapter never resolves", async () => {
  let providerSignal!: AbortSignal;
  vi.stubGlobal("fetch", (_url: string, init: RequestInit) => {
    providerSignal = init.signal!;
    return new Promise(() => {});
  });
  const controller = new AbortController();
  const pending = embedText(
    { provider: "openai", apiKey: "fixture", signal: controller.signal },
    "question",
  );
  controller.abort();
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  expect(providerSignal.aborted).toBe(true);
});
