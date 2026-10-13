// Answers from a reader's ChatGPT plan through the Responses API. Plan usage
// accepts only a narrow request: streaming, `store: false`, the whole history
// in `input` every time, the system prompt as `instructions`, and none of the
// sampling, output-cap or conversation-state parameters.
import {
  CHATGPT_RECONNECT,
  CHATGPT_RESPONSES_URL,
  CHATGPT_USAGE_URL,
} from "./chatgpt";
import type { ChatMessage, StreamEvent } from "./companionStream";
import { dataLines, parseJson } from "./sse";

export const CHATGPT_USAGE_LIMIT = `Your ChatGPT plan's usage limit for this app is reached. Check your usage at ${CHATGPT_USAGE_URL}.`;
export const CHATGPT_NOT_ELIGIBLE =
  "Your ChatGPT plan can't be used with this reader. Use one of your API keys instead, or check your plan in ChatGPT.";
export const CHATGPT_TEMPORARY =
  "ChatGPT is temporarily unavailable. Try again later.";

export type ChatGPTFailureKind =
  | "usage_limit"
  | "not_eligible"
  | "reconnect"
  | "temporary"
  | "other";

/**
 * A failed plan request with OpenAI's status and code. Terminal failures are
 * about the reader's plan or connection, so they're shown to the reader
 * instead of silently moving the request to one of their paid API keys.
 */
export class ChatGPTRequestError extends Error {
  readonly kind: ChatGPTFailureKind;
  constructor(
    readonly status: number,
    readonly code: string | undefined,
    detail = "",
  ) {
    super(
      `ChatGPT returned ${status}${code ? ` ${code}` : ""}${
        detail && status !== 401 && status !== 403
          ? `: ${detail.slice(0, 300)}`
          : ""
      }`,
    );
    this.kind = failureKind(status, code);
  }

  get terminal(): boolean {
    return (
      this.kind === "usage_limit" ||
      this.kind === "not_eligible" ||
      this.kind === "reconnect"
    );
  }

  /** What to tell the reader. */
  get readerMessage(): string {
    switch (this.kind) {
      case "usage_limit":
        return CHATGPT_USAGE_LIMIT;
      case "not_eligible":
        return CHATGPT_NOT_ELIGIBLE;
      case "reconnect":
        return CHATGPT_RECONNECT;
      case "temporary":
        return CHATGPT_TEMPORARY;
      default:
        return "ChatGPT couldn't answer. Try again.";
    }
  }

  /** The HTTP status to answer the browser with. */
  get responseStatus(): number {
    if (this.kind === "usage_limit") return 429;
    if (this.kind === "not_eligible") return 403;
    if (this.kind === "reconnect") return 401;
    return 502;
  }
}

function failureKind(
  status: number,
  code: string | undefined,
): ChatGPTFailureKind {
  if (code === "subscription_sharing_usage_limit_exceeded")
    return "usage_limit";
  if (code === "subscription_sharing_user_not_eligible") return "not_eligible";
  if (code === "invalid_user" || status === 401) return "reconnect";
  if (status === 0 || status === 429 || status >= 500) return "temporary";
  return "other";
}

export function isTerminalChatGPTError(
  error: unknown,
): error is ChatGPTRequestError {
  return error instanceof ChatGPTRequestError && error.terminal;
}

/** Error bodies come as `{error: {code, message}}` or `{detail}`. */
function errorFields(body: unknown): { code?: string; detail: string } {
  if (!body || typeof body !== "object") return { detail: "" };
  const record = body as Record<string, unknown>;
  const error =
    record.error && typeof record.error === "object"
      ? (record.error as Record<string, unknown>)
      : record;
  const code = typeof error.code === "string" ? error.code : undefined;
  const detail =
    typeof error.message === "string"
      ? error.message
      : typeof record.detail === "string"
        ? record.detail
        : "";
  return { code, detail };
}

export function responsesBody(model: string, messages: ChatMessage[]) {
  const instructions = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");
  const input = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      type: "message",
      role: m.role,
      content: [
        {
          type: m.role === "assistant" ? "output_text" : "input_text",
          text: m.content,
        },
      ],
    }));
  return {
    model,
    ...(instructions ? { instructions } : {}),
    input,
    store: false,
    stream: true,
  };
}

interface ResponsesEvent {
  type?: string;
  delta?: string;
  code?: string;
  message?: string;
  error?: { code?: string; message?: string };
  response?: {
    status?: number;
    error?: { code?: string; message?: string } | null;
    incomplete_details?: { reason?: string } | null;
  };
}

export async function* streamResponses({
  accessToken,
  model,
  messages,
  signal,
}: {
  accessToken: string;
  model: string;
  messages: ChatMessage[];
  signal?: AbortSignal;
}): AsyncGenerator<StreamEvent> {
  let response: Response;
  try {
    response = await fetch(CHATGPT_RESPONSES_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify(responsesBody(model, messages)),
      signal,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    yield { type: "error", error: new ChatGPTRequestError(0, "network_error") };
    return;
  }
  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => "");
    const { code, detail } = errorFields(parseJson(text));
    yield {
      type: "error",
      error: new ChatGPTRequestError(response.status, code, detail),
    };
    return;
  }

  for await (const data of dataLines(response.body)) {
    const event = parseJson<ResponsesEvent>(data);
    if (!event) continue;
    switch (event.type) {
      case "response.output_text.delta":
        if (event.delta) yield { type: "text", text: event.delta };
        break;
      // Only a completed response is a success
      case "response.completed":
        return;
      case "response.failed": {
        const failure = event.response?.error ?? {};
        yield {
          type: "error",
          error: new ChatGPTRequestError(
            response.status,
            failure.code,
            failure.message,
          ),
        };
        return;
      }
      case "response.incomplete":
        yield {
          type: "error",
          error: new ChatGPTRequestError(
            response.status,
            "response_incomplete",
            event.response?.incomplete_details?.reason,
          ),
        };
        return;
      case "error": {
        const code = event.code ?? event.error?.code;
        yield {
          type: "error",
          error: new ChatGPTRequestError(
            response.status,
            code,
            event.message ?? event.error?.message,
          ),
        };
        return;
      }
    }
  }
  yield {
    type: "error",
    error: new ChatGPTRequestError(0, "stream_interrupted"),
  };
}

/** Strips a Markdown code fence a model may wrap JSON in. */
function unfence(text: string): string {
  const match = text.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return match ? match[1] : text.trim();
}

/**
 * Collects a whole answer from the stream. With a JSON Schema, the
 * instructions ask for JSON only; callers validate it with their own schema.
 */
export async function completeResponses({
  accessToken,
  model,
  messages,
  jsonSchema,
  signal,
}: {
  accessToken: string;
  model: string;
  messages: ChatMessage[];
  jsonSchema?: unknown;
  signal?: AbortSignal;
}): Promise<string> {
  const chat: ChatMessage[] = jsonSchema
    ? [
        ...messages,
        {
          role: "system",
          content: `Reply with only one JSON object that matches this JSON Schema. No prose, no Markdown, no code fences.\n${JSON.stringify(jsonSchema)}`,
        },
      ]
    : messages;
  let text = "";
  for await (const event of streamResponses({
    accessToken,
    model,
    messages: chat,
    signal,
  })) {
    if (event.type === "text") text += event.text;
    else if (event.type === "error") throw event.error;
  }
  return jsonSchema ? unfence(text) : text;
}
