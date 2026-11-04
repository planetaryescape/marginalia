import { availableParallelism } from "node:os";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "edge-runtime",
    maxWorkers: Math.min(
      3,
      Math.max(1, Math.floor(availableParallelism() / 2)),
    ),
  },
});
