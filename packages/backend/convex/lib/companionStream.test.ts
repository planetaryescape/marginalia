import { afterEach, describe, expect, it, vi } from "vitest";
import { REASONING_HEADROOM_TOKENS, streamChat } from "./companionStream";

function sse(lines: string[]) {
  return new Response(lines.map((l) => `data: ${l}\n\n`).join(""), {
    headers: { "Content-Type": "text/event-stream" },
  });
}

async function collect(provider: "openrouter" | "anthropic") {
  const out = [];
  for await (const e of streamChat({
    target: { provider, model: "m", apiKey: "k" },
    messages: [{ role: "user", content: "hi" }],
    web: false,
    maxTokens: 10,
  }))
    out.push(e);
  return out;
}

describe("streamChat output cap", () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    ["openrouter", "max_tokens", 10 + REASONING_HEADROOM_TOKENS],
    ["openai", "max_completion_tokens", 10 + REASONING_HEADROOM_TOKENS],
    ["anthropic", "max_tokens", 10],
  ] as const)("gives %s reasoning room on top of the answer's budget", async (provider, field, expected) => {
    let sent: Record<string, unknown> = {};
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      sent = JSON.parse(String(init.body));
      return sse(["[DONE]"]);
    });
    for await (const _ of streamChat({
      target: { provider, model: "m", apiKey: "k" },
      messages: [{ role: "user", content: "hi" }],
      web: false,
      maxTokens: 10,
    }));
    expect(sent[field]).toBe(expected);
  });

  it("reports a chat-completions stream that stopped at the length limit", async () => {
    vi.stubGlobal("fetch", async () =>
      sse([
        '{"choices":[{"delta":{"content":"[A](/read/jd7"}}]}',
        '{"choices":[{"delta":{},"finish_reason":"length"}]}',
        "[DONE]",
      ]),
    );
    expect(await collect("openrouter")).toEqual([
      { type: "text", text: "[A](/read/jd7" },
      { type: "truncated" },
    ]);
  });

  it("reports an Anthropic stream that stopped at max_tokens", async () => {
    vi.stubGlobal("fetch", async () =>
      sse([
        '{"type":"content_block_delta","delta":{"type":"text_delta","text":"Hi"}}',
        '{"type":"message_delta","delta":{"stop_reason":"max_tokens"}}',
        '{"type":"message_stop"}',
      ]),
    );
    expect(await collect("anthropic")).toEqual([
      { type: "text", text: "Hi" },
      { type: "truncated" },
    ]);
  });

  it("says nothing extra when the model finished", async () => {
    vi.stubGlobal("fetch", async () =>
      sse([
        '{"choices":[{"delta":{"content":"Done"},"finish_reason":"stop"}]}',
        "[DONE]",
      ]),
    );
    expect(await collect("openrouter")).toEqual([
      { type: "text", text: "Done" },
    ]);
  });
});
