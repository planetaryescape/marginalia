import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ChatGPTRequestError } from "./chatgptResponses";
import type {
  streamChat as realStreamChat,
  StreamEvent,
} from "./companionStream";
import type { ProviderTarget } from "./router";

const streamChat = vi.hoisted(() => vi.fn<typeof realStreamChat>());
vi.mock("./companionStream", async (original) => ({
  ...(await original<typeof import("./companionStream")>()),
  streamChat,
}));

import { streamWithFallback } from "./answerStream";

const targets: ProviderTarget[] = ["first", "second"].map((id) => ({
  id,
  name: id,
  model: id,
  provider: "openai",
  apiKey: "fixture",
}));
const signal = () => new AbortController().signal;
const deadlines = { firstTokenMs: 5, idleMs: 5, totalMs: 1_000 };
beforeEach(() => streamChat.mockReset());
afterEach(() => vi.useRealTimers());
async function* text(): AsyncGenerator<StreamEvent> {
  yield { type: "text", text: "ok" };
}

it("does not drain a slow consumer and retains the final chunk and citation footer", async () => {
  let advances = 0;
  streamChat.mockImplementation(async function* () {
    advances++;
    yield { type: "text", text: "first " };
    advances++;
    yield { type: "text", text: "last" };
    advances++;
    yield { type: "citation", url: "https://example.com/source" };
  });
  const response = await streamWithFallback(
    [],
    targets,
    false,
    signal(),
    async () => {},
  );
  await Promise.resolve();
  expect(advances).toBe(1);
  const reader = response.body!.getReader();
  expect(new TextDecoder().decode((await reader.read()).value)).toBe("first ");
  expect(advances).toBe(1);
  expect(new TextDecoder().decode((await reader.read()).value)).toBe("last");
  expect(new TextDecoder().decode((await reader.read()).value)).toContain(
    "Sources: [example.com](https://example.com/source)",
  );
  expect((await reader.read()).done).toBe(true);
  expect(streamChat).toHaveBeenCalledTimes(1);
});

it("aborts a stalled first attempt before fallback, even when iterator.return hangs", async () => {
  vi.useFakeTimers();
  let firstSignal!: AbortSignal;
  streamChat
    .mockImplementationOnce(async function* (options) {
      firstSignal = options.signal!;
      await new Promise(() => {});
    })
    .mockImplementationOnce((options) => {
      expect(firstSignal.aborted).toBe(true);
      expect(options.signal!.aborted).toBe(false);
      return text();
    });
  const pending = streamWithFallback(
    [],
    targets,
    false,
    signal(),
    async () => {},
    1200,
    { deadlines },
  );
  await vi.advanceTimersByTimeAsync(106);
  const response = await pending;
  expect(await response.text()).toBe("ok");
  expect(response.headers.get("X-Companion-Model")).toBe("second");
});

it("does not fall back or hang Stop during a pending provider read", async () => {
  vi.useFakeTimers();
  let providerSignal!: AbortSignal;
  streamChat.mockImplementation(async function* (options) {
    providerSignal = options.signal!;
    yield { type: "text", text: "first" };
    await new Promise(() => {});
  });
  const response = await streamWithFallback(
    [],
    targets,
    false,
    signal(),
    async () => {},
    1200,
    { deadlines },
  );
  const reader = response.body!.getReader();
  await reader.read();
  const pending = reader.read();
  const cancelled = reader.cancel();
  await vi.advanceTimersByTimeAsync(101);
  await cancelled;
  expect((await pending).done).toBe(true);
  expect(providerSignal.aborted).toBe(true);
  expect(streamChat).toHaveBeenCalledTimes(1);
});

it("errors a mid-answer idle timeout without replaying the answer", async () => {
  vi.useFakeTimers();
  streamChat.mockImplementation(async function* () {
    yield { type: "text", text: "first" };
    await new Promise(() => {});
  });
  const response = await streamWithFallback(
    [],
    targets,
    false,
    signal(),
    async () => {},
    1200,
    { deadlines },
  );
  const reader = response.body!.getReader();
  await reader.read();
  const failed = expect(reader.read()).rejects.toMatchObject({
    name: "TimeoutError",
  });
  await vi.advanceTimersByTimeAsync(106);
  await failed;
  expect(streamChat).toHaveBeenCalledTimes(1);
});

it("never switches a terminal ChatGPT limit to a paid key", async () => {
  streamChat.mockImplementation(async function* () {
    yield {
      type: "error",
      error: new ChatGPTRequestError(
        429,
        "subscription_sharing_usage_limit_exceeded",
      ),
    };
  });
  const response = await streamWithFallback(
    [],
    targets,
    false,
    signal(),
    async () => {},
  );
  expect(response.status).toBe(429);
  expect(await response.json()).toMatchObject({ code: "chatgpt_usage_limit" });
  expect(streamChat).toHaveBeenCalledTimes(1);
});
