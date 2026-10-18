import { afterEach, expect, it, vi } from "vitest";

vi.mock("./auth-client", () => ({ authClient: {} }));

import { streamFromConvex } from "./companion";

afterEach(() => vi.unstubAllGlobals());

it("keeps a split UTF-8 final chunk and the citation footer in the old text contract", async () => {
  const answer =
    "An answer café.\n\nSources: [example.com](https://example.com)";
  const bytes = new TextEncoder().encode(answer);
  vi.stubGlobal(
    "fetch",
    async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
            controller.close();
          },
        }),
        { headers: { "X-Companion-Model": "fixture-model" } },
      ),
  );
  const chunks: string[] = [];
  const onModel = vi.fn();
  await streamFromConvex(
    "/api/companion",
    {},
    {
      signal: new AbortController().signal,
      onModel,
      onText: (chunk) => chunks.push(chunk),
    },
  );
  expect(chunks.join("")).toBe(answer);
  expect(onModel).toHaveBeenCalledWith("fixture-model");
});

it("Stop interrupts a pending body read without waiting on a hung cancellation handshake", async () => {
  let reading!: () => void;
  const started = new Promise<void>((resolve) => {
    reading = resolve;
  });
  const cancel = vi.fn(() => new Promise<void>(() => {}));
  vi.stubGlobal(
    "fetch",
    async () =>
      new Response(
        new ReadableStream(
          {
            pull() {
              reading();
            },
            cancel,
          },
          { highWaterMark: 0 },
        ),
      ),
  );
  const controller = new AbortController();
  const pending = streamFromConvex(
    "/api/library",
    {},
    { signal: controller.signal, onModel: () => {}, onText: () => {} },
  );
  await started;
  controller.abort();
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  expect(cancel).toHaveBeenCalledTimes(1);
});
