import type { ActionCtx } from "../_generated/server";

/** Await a provider/DB stage interruptibly, even if its adapter ignores abort. */
export function interruptible<T>(
  work: PromiseLike<T>,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) {
    // Work may have rejected synchronously while constructing this wait.
    void Promise.resolve(work).catch(() => {});
    return Promise.reject(signal.reason);
  }
  return new Promise((resolve, reject) => {
    const aborted = () => reject(signal.reason);
    signal.addEventListener("abort", aborted, { once: true });
    Promise.resolve(work)
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", aborted));
  });
}

/**
 * Existing article/book helpers share this context: cancellation is checked
 * before and after every preparation transaction without changing their cache
 * contracts. A DB transaction already committed is deliberately not rolled back.
 * Never wrap credential refresh: rotating tokens must finish publication even
 * when the reader who started a refresh stops waiting.
 */
export function cancellablePreparation(
  ctx: ActionCtx,
  signal: AbortSignal,
): ActionCtx {
  return {
    ...ctx,
    runQuery: async (query, ...args) => {
      signal.throwIfAborted();
      const result = await ctx.runQuery(query, ...args);
      signal.throwIfAborted();
      return result;
    },
    runMutation: async (mutation, ...args) => {
      signal.throwIfAborted();
      const result = await ctx.runMutation(mutation, ...args);
      signal.throwIfAborted();
      return result;
    },
    vectorSearch: async (table, index, search) => {
      signal.throwIfAborted();
      const result = await ctx.vectorSearch(table, index, search);
      signal.throwIfAborted();
      return result;
    },
  };
}

/** Owns a deadline and a parent-abort listener; dispose on every exit path. */
export function requestAttempt(
  parent: AbortSignal | undefined,
  timeoutMs: number,
) {
  const controller = new AbortController();
  const abort = () => controller.abort(parent?.reason);
  if (parent?.aborted) abort();
  else parent?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(
    () =>
      controller.abort(
        new DOMException("Generation deadline exceeded", "TimeoutError"),
      ),
    timeoutMs,
  );
  return {
    signal: controller.signal,
    abort: (reason?: unknown) => controller.abort(reason),
    dispose() {
      clearTimeout(timer);
      parent?.removeEventListener("abort", abort);
    },
  };
}

export const ANSWER_DEADLINES = {
  quick: { firstTokenMs: 30_000, idleMs: 30_000, totalMs: 180_000 },
  deep: { firstTokenMs: 120_000, idleMs: 60_000, totalMs: 600_000 },
  web: { firstTokenMs: 90_000, idleMs: 60_000, totalMs: 420_000 },
} as const;
