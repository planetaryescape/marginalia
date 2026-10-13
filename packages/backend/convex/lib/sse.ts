export type ResponseBody = NonNullable<Response["body"]>;

/** The `data:` payloads of a server-sent event stream. */
export async function* dataLines(body: ResponseBody) {
  const reader = body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += value;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        // Comment lines like ": OPENROUTER PROCESSING" keep the connection alive
        if (line.startsWith("data: ")) yield line.slice(6).trim();
      }
    }
  } finally {
    // Returning early on [DONE], provider error or cancellation must release the upstream body.
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export function parseJson<T>(data: string): T | null {
  try {
    return JSON.parse(data) as T;
  } catch {
    return null;
  }
}
