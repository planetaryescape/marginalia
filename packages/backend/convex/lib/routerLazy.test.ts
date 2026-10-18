import { afterEach, expect, it, vi } from "vitest";
import { ChatGPTRequestError } from "./chatgptResponses";

const mocks = vi.hoisted(() => ({ token: vi.fn(), decrypt: vi.fn() }));
vi.mock("./chatgptTokens", () => ({ chatgptAccessToken: mocks.token }));
vi.mock("./providerKeys", () => ({ decryptProviderKey: mocks.decrypt }));
vi.mock("./providers", async (original) => ({
  ...(await original<typeof import("./providers")>()),
  modelChain: () => [
    { id: "api", model: "api", name: "API", provider: "openai" },
    { id: "plan", model: "plan", name: "Plan", provider: "chatgpt" },
  ],
}));

import { streamWithFallback } from "./answerStream";
import { loadReaderAI } from "./router";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

async function ai() {
  mocks.decrypt.mockResolvedValue("fixture-api-key");
  return loadReaderAI(
    {
      runQuery: vi.fn().mockResolvedValue({
        credentials: [{ provider: "openai" }],
        models: {},
        chatgptModels: [],
      }),
      runMutation: vi.fn(),
    },
    "reader",
  );
}
const success = () =>
  new Response(
    'data: {"choices":[{"delta":{"content":"API answer"}}]}\n\ndata: [DONE]\n\n',
  );

it("does not refresh a fallback ChatGPT target after primary API-key success", async () => {
  const routing = await ai();
  expect(routing.chain("quick").map((t) => t.provider)).toEqual([
    "openai",
    "chatgpt",
  ]);
  vi.stubGlobal("fetch", vi.fn(success));
  const response = await streamWithFallback(
    [],
    routing.chain("quick"),
    false,
    new AbortController().signal,
    routing.noteFailure,
  );
  expect(await response.text()).toBe("API answer");
  expect(mocks.token).not.toHaveBeenCalled();
});

it("resolves a plan only on attempt, and a terminal fallback resolution cannot spend another key", async () => {
  const routing = await ai();
  mocks.token.mockRejectedValue(
    new ChatGPTRequestError(429, "subscription_sharing_usage_limit_exceeded"),
  );
  const fetch = vi.fn(async () => new Response("down", { status: 500 }));
  vi.stubGlobal("fetch", fetch);
  const chain = routing.chain("quick");
  const response = await streamWithFallback(
    [],
    [...chain, chain[0]],
    false,
    new AbortController().signal,
    routing.noteFailure,
  );
  expect(response.status).toBe(429);
  expect(mocks.token).toHaveBeenCalledTimes(1);
  expect(fetch).toHaveBeenCalledTimes(1);
});
