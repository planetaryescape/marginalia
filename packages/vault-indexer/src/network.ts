export class HttpError extends Error {
  constructor(public readonly status: number) {
    super(`Request failed (HTTP ${status})`);
  }
}

class ResponseBudgetError extends Error {
  constructor() {
    super("Response exceeds 8 MB byte budget");
  }
}

export interface RequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  attempts?: number;
  retryDelayMs?: number;
}

async function readResponse(response: Response): Promise<string> {
  if (!response.body) throw new Error("Missing response body");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const parts: string[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 8_000_000) {
        void reader.cancel().catch(() => {});
        throw new ResponseBudgetError();
      }
      parts.push(decoder.decode(value, { stream: true }));
    }
    parts.push(decoder.decode());
    return parts.join("");
  } finally {
    reader.releaseLock();
  }
}

function pause(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    const abort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", abort, { once: true });
  });
}

/** Deadline includes the response body; errors never include provider bodies. */
export async function requestJson(
  url: string,
  init: RequestInit,
  options: RequestOptions = {},
): Promise<unknown> {
  const attempts = options.attempts ?? 3;
  for (let attempt = 0; attempt < attempts; attempt++) {
    options.signal?.throwIfAborted();
    const deadline = AbortSignal.timeout(options.timeoutMs ?? 30_000);
    const signal = options.signal
      ? AbortSignal.any([options.signal, deadline])
      : deadline;
    let retryAfter = 0;
    try {
      const response = await fetch(url, { ...init, signal });
      if (!response.ok) {
        const header = response.headers.get("retry-after");
        if (header) {
          const seconds = Number(header);
          retryAfter = Math.min(
            10_000,
            Math.max(
              0,
              Number.isFinite(seconds)
                ? seconds * 1000
                : Date.parse(header) - Date.now(),
            ),
          );
          if (!Number.isFinite(retryAfter)) retryAfter = 0;
        }
        // Cleanup must not delay a permanent auth/input failure.
        void response.body?.cancel().catch(() => {});
        throw new HttpError(response.status);
      }
      const body = await readResponse(response);
      return JSON.parse(body);
    } catch (error) {
      options.signal?.throwIfAborted();
      const transient =
        error instanceof HttpError
          ? error.status === 429 || error.status >= 500
          : error instanceof TypeError || deadline.aborted;
      if (!transient || attempt + 1 === attempts) {
        if (error instanceof HttpError) throw error;
        if (error instanceof ResponseBudgetError) throw error;
        throw new Error(
          deadline.aborted
            ? "Request timed out"
            : "Request failed or returned invalid JSON",
        );
      }
      await pause(
        Math.max(retryAfter, (options.retryDelayMs ?? 1000) * (attempt + 1)),
        options.signal,
      );
    }
  }
  throw new Error("No request attempts configured");
}
