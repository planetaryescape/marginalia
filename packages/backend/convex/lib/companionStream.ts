// Streams chat answers straight from the reader's provider. The AI SDK's OpenAI
// provider can't send OpenRouter's server-side `openrouter:web_search` tool,
// so the reading companion talks to each API directly. OpenRouter and OpenAI
// share the chat-completions stream format; Anthropic has its own.
import { completeResponses, streamResponses } from "./chatgptResponses";
import { searchCompletionSchema } from "./librarySearch";
import {
  type ModelProvider,
  type Provider,
  providerFailure,
} from "./providers";
import { dataLines, parseJson as parse, type ResponseBody } from "./sse";

const CHAT_URLS: Record<Exclude<Provider, "anthropic">, string> = {
  openrouter: "https://openrouter.ai/api/v1/chat/completions",
  openai: "https://api.openai.com/v1/chat/completions",
};
const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";

// Exa "instant" is the quickest and cheapest engine that needs no extra setup
// (~250 ms, $0.007 per search). Two searches is plenty for a margin note.
const WEB_SEARCH_TOOL = {
  type: "openrouter:web_search",
  parameters: { engine: "exa", mode: "instant", max_results: 5, max_uses: 2 },
};

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** Which provider and model to call, with the reader's own key. */
export interface ChatTarget {
  provider: ModelProvider;
  model: string;
  apiKey: string;
}

export type StreamEvent =
  | { type: "text"; text: string }
  | { type: "citation"; url: string; title?: string }
  /** The model stopped because it hit the output cap, not because it was done. */
  | { type: "truncated" }
  | { type: "error"; error: unknown };

function anthropicHeaders(apiKey: string) {
  return {
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01",
    "Content-Type": "application/json",
  };
}

function bearerHeaders(apiKey: string) {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "X-Title": "Marginalia",
  };
}

/** Anthropic takes the system prompt separately from the turns. */
function anthropicMessages(messages: ChatMessage[]) {
  return {
    system: messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n\n"),
    messages: messages
      .filter((m) => m.role !== "system")
      .map(({ role, content }) => ({ role, content })),
  };
}

function chatRequest(
  target: ChatTarget & { provider: Provider },
  messages: ChatMessage[],
  maxTokens: number,
  web: boolean,
  extra: Record<string, unknown>,
) {
  if (target.provider === "anthropic")
    return {
      url: ANTHROPIC_MESSAGES_URL,
      headers: anthropicHeaders(target.apiKey),
      body: {
        model: target.model,
        max_tokens: maxTokens,
        ...anthropicMessages(messages),
        ...extra,
      },
    };
  const limit =
    target.provider === "openai"
      ? // OpenAI's reasoning models take a completion budget and spend it thinking
        { max_completion_tokens: maxTokens, reasoning_effort: "low" }
      : { max_tokens: maxTokens };
  return {
    url: CHAT_URLS[target.provider],
    headers: bearerHeaders(target.apiKey),
    body: {
      model: target.model,
      messages,
      ...limit,
      // Web search is OpenRouter's server-side tool; direct providers answer without it
      ...(web && target.provider === "openrouter"
        ? { tools: [WEB_SEARCH_TOOL], max_tool_calls: 2 }
        : {}),
      ...extra,
    },
  };
}

async function* chatCompletionEvents(
  body: ResponseBody,
): AsyncGenerator<StreamEvent> {
  let truncated = false;
  for await (const data of dataLines(body)) {
    if (data === "[DONE]") break;
    const chunk = parse<{
      error?: unknown;
      choices?: {
        finish_reason?: string | null;
        delta?: {
          content?: string | null;
          annotations?: {
            type: string;
            url_citation?: { url: string; title?: string };
          }[];
        };
      }[];
    }>(data);
    if (!chunk) continue;
    if (chunk.error) {
      yield { type: "error", error: chunk.error };
      return;
    }
    const delta = chunk.choices?.[0]?.delta;
    if (chunk.choices?.[0]?.finish_reason === "length") truncated = true;
    if (delta?.content) yield { type: "text", text: delta.content };
    for (const annotation of delta?.annotations ?? []) {
      if (annotation.type === "url_citation" && annotation.url_citation) {
        yield { type: "citation", ...annotation.url_citation };
      }
    }
  }
  if (truncated) yield { type: "truncated" };
}

async function* anthropicEvents(
  body: ResponseBody,
): AsyncGenerator<StreamEvent> {
  let truncated = false;
  for await (const data of dataLines(body)) {
    const event = parse<{
      type?: string;
      error?: unknown;
      delta?: { type?: string; text?: string; stop_reason?: string };
    }>(data);
    if (!event) continue;
    if (event.type === "error") {
      yield { type: "error", error: event.error };
      return;
    }
    if (
      event.type === "message_delta" &&
      event.delta?.stop_reason === "max_tokens"
    )
      truncated = true;
    if (event.type === "message_stop") break;
    if (
      event.type === "content_block_delta" &&
      event.delta?.type === "text_delta" &&
      event.delta.text
    )
      yield { type: "text", text: event.delta.text };
  }
  if (truncated) yield { type: "truncated" };
}

export async function* streamChat({
  target,
  messages,
  web,
  maxTokens,
  signal,
}: {
  target: ChatTarget;
  messages: ChatMessage[];
  web: boolean;
  maxTokens: number;
  signal?: AbortSignal;
}): AsyncGenerator<StreamEvent> {
  // A ChatGPT plan answers through the Responses API, without hosted tools
  // or an output cap
  if (target.provider === "chatgpt") {
    yield* streamResponses({
      accessToken: target.apiKey,
      model: target.model,
      messages,
      signal,
    });
    return;
  }
  const { url, headers, body } = chatRequest(
    { ...target, provider: target.provider },
    messages,
    maxTokens,
    web,
    { stream: true },
  );
  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok || !response.body) {
    const detail = await response.text().catch(() => "");
    yield { type: "error", error: providerFailure(response.status, detail) };
    return;
  }

  yield* target.provider === "anthropic"
    ? anthropicEvents(response.body)
    : chatCompletionEvents(response.body);
}

/**
 * One non-streaming JSON answer. OpenRouter and OpenAI enforce the schema;
 * Anthropic follows the system prompt's JSON instructions.
 */
export async function completeJson({
  target,
  messages,
  maxTokens,
  jsonSchema,
  signal,
}: {
  target: ChatTarget;
  messages: ChatMessage[];
  maxTokens: number;
  jsonSchema: Record<string, unknown>;
  signal?: AbortSignal;
}): Promise<{ content: string; truncated: boolean }> {
  if (target.provider === "chatgpt")
    return {
      content: await completeResponses({
        accessToken: target.apiKey,
        model: target.model,
        messages,
        jsonSchema: jsonSchema.schema,
        signal,
      }),
      truncated: false,
    };
  const extra =
    target.provider === "anthropic"
      ? {}
      : { response_format: { type: "json_schema", json_schema: jsonSchema } };
  const { url, headers, body } = chatRequest(
    { ...target, provider: target.provider },
    messages,
    maxTokens,
    false,
    extra,
  );
  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok)
    throw providerFailure(
      response.status,
      await response.text().catch(() => ""),
    );
  const json = await response.json();
  if (target.provider === "anthropic") {
    const message = json as {
      content?: { type: string; text?: string }[];
      stop_reason?: string;
    };
    return {
      content: (message.content ?? [])
        .filter((block) => block.type === "text")
        .map((block) => block.text ?? "")
        .join(""),
      truncated: message.stop_reason === "max_tokens",
    };
  }
  const choice = searchCompletionSchema.parse(json).choices[0];
  return {
    content: choice.message.content,
    truncated: choice.finish_reason === "length",
  };
}

function domainOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** Markdown "Sources" line for citations the answer didn't already link inline. */
export function sourcesFooter(
  answer: string,
  citations: { url: string }[],
): string {
  const unique = [...new Map(citations.map((c) => [c.url, c])).values()];
  // A few extra sources is useful; a wall of links in a margin note isn't
  const missing = unique.filter((c) => !answer.includes(c.url)).slice(0, 4);
  if (!missing.length) return "";
  return `\n\nSources: ${missing.map((c) => `[${domainOf(c.url)}](${c.url})`).join(", ")}`;
}
