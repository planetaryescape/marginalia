// Streams a chat completion straight from OpenRouter. The AI SDK's OpenAI
// provider can't send OpenRouter's server-side `openrouter:web_search` tool,
// so the reading companion talks to the API directly.

const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";

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

export type StreamEvent =
  | { type: "text"; text: string }
  | { type: "citation"; url: string; title?: string }
  | { type: "error"; error: unknown };

export async function* streamChat({
  model,
  messages,
  web,
  maxTokens,
  signal,
}: {
  model: string;
  messages: ChatMessage[];
  web: boolean;
  maxTokens: number;
  signal?: AbortSignal;
}): AsyncGenerator<StreamEvent> {
  const response = await fetch(OPENROUTER_CHAT_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "X-Title": "Marginalia",
    },
    body: JSON.stringify({
      model,
      messages,
      stream: true,
      max_tokens: maxTokens,
      ...(web ? { tools: [WEB_SEARCH_TOOL], max_tool_calls: 2 } : {}),
    }),
    signal,
  });

  if (!response.ok || !response.body) {
    const detail = await response.text().catch(() => "");
    yield { type: "error", error: new Error(`${response.status} ${detail}`) };
    return;
  }

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += value;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      // Comment lines like ": OPENROUTER PROCESSING" keep the connection alive
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6).trim();
      if (data === "[DONE]") return;
      let chunk: {
        error?: unknown;
        choices?: {
          delta?: {
            content?: string | null;
            annotations?: {
              type: string;
              url_citation?: { url: string; title?: string };
            }[];
          };
        }[];
      };
      try {
        chunk = JSON.parse(data);
      } catch {
        continue;
      }
      if (chunk.error) {
        yield { type: "error", error: chunk.error };
        return;
      }
      const delta = chunk.choices?.[0]?.delta;
      if (delta?.content) yield { type: "text", text: delta.content };
      for (const annotation of delta?.annotations ?? []) {
        if (annotation.type === "url_citation" && annotation.url_citation) {
          yield { type: "citation", ...annotation.url_citation };
        }
      }
    }
  }
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
