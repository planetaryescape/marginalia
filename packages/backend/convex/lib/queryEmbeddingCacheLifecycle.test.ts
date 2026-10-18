import { afterEach, expect, it, vi } from "vitest";
import { internal } from "../_generated/api";
import { cachedQueryEmbedding } from "./queryEmbeddingCache";

afterEach(() => vi.unstubAllGlobals());
it("awaits durable enqueue, not cache storage or eviction on the result path", async () => {
  const vector = Array.from({ length: 1536 }, () => 1);
  vi.stubGlobal("fetch", async () =>
    Response.json({ data: [{ index: 0, embedding: vector }] }),
  );
  let enqueue!: () => void;
  const runAfter = vi.fn().mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        enqueue = resolve;
      }),
  );
  const ctx = {
    runQuery: vi.fn().mockResolvedValue(null),
    scheduler: { runAfter },
  };
  const result = cachedQueryEmbedding(ctx, "reader", "  RUST ", {
    provider: "openai",
    apiKey: "fixture",
  });
  await vi.waitFor(() => expect(runAfter).toHaveBeenCalledTimes(1));
  expect(runAfter.mock.calls[0]).toMatchObject([
    0,
    internal.queryEmbeddings.store,
    { userId: "reader", key: "rust", embedding: vector },
  ]);
  enqueue();
  expect(await result).toEqual({ vector, cached: false });
});
