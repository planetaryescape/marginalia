import { afterEach, expect, it, vi } from "vitest";
import { internal } from "../_generated/api";
import { cachedQueryEmbedding } from "./queryEmbeddingCache";

afterEach(() => vi.unstubAllGlobals());
it("lets search overlap minimal publication, which callers join before returning", async () => {
  const vector = Array.from({ length: 1536 }, () => 1);
  vi.stubGlobal("fetch", async () =>
    Response.json({ data: [{ index: 0, embedding: vector }] }),
  );
  let enqueue!: () => void;
  const runMutation = vi.fn().mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        enqueue = resolve;
      }),
  );
  const ctx = {
    runQuery: vi.fn().mockResolvedValue(null),
    runMutation,
  };
  const result = cachedQueryEmbedding(ctx, "reader", "  RUST ", {
    provider: "openai",
    apiKey: "fixture",
  });
  const ready = await result;
  expect(runMutation.mock.calls[0]).toMatchObject([
    internal.queryEmbeddings.publish,
    { userId: "reader", key: "rust", embedding: vector },
  ]);
  enqueue();
  await ready.publication;
  expect(ready).toMatchObject({ vector, cached: false });
});
