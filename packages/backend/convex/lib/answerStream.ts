import { isTerminalChatGPTError } from "./chatgptResponses";
import {
  type ChatMessage,
  type StreamEvent,
  sourcesFooter,
  streamChat,
} from "./companionStream";
import { resolveTarget } from "./providerTarget";
import {
  ANSWER_DEADLINES,
  interruptible,
  type PreparationOwner,
  requestAttempt,
} from "./requestControl";
import type { ProviderTarget } from "./router";
import type { Timings } from "./serverTiming";

const TRUNCATED_NOTICE =
  "\n\n(The answer was cut short. Ask again for the rest.)";

/** Aborting first interrupts fetch/read. Returning must never hold Stop hostage. */
async function closeEvents(events: AsyncGenerator<StreamEvent>) {
  const cleanup = requestAttempt(undefined, 100);
  try {
    await interruptible(events.return(undefined), cleanup.signal);
  } catch {
    // A non-cooperative adapter may never resolve return after a pending read.
  } finally {
    cleanup.dispose();
  }
}

/** Prime one token, then advance only on downstream demand. Never replay text. */
export async function streamWithFallback(
  chat: ChatMessage[],
  targets: ProviderTarget[],
  web: boolean,
  signal: AbortSignal,
  onFailure: (error: unknown) => Promise<void>,
  maxTokens = 1200,
  options: {
    depth?: "quick" | "deep";
    timings?: Timings;
    deadlines?: { firstTokenMs: number; idleMs: number; totalMs: number };
    publication?: PreparationOwner;
  } = {},
): Promise<Response> {
  const deadlines =
    options.deadlines ??
    ANSWER_DEADLINES[web ? "web" : (options.depth ?? "quick")];
  for (const [index, target] of targets.entries()) {
    signal.throwIfAborted();
    const attempt = requestAttempt(signal, deadlines.totalMs);
    const firstWait = requestAttempt(attempt.signal, deadlines.firstTokenMs);
    let events: AsyncGenerator<StreamEvent> | undefined;
    const citations: { url: string; title?: string }[] = [];
    let first: string | null = null;
    try {
      // Do not detach a rotating-token refresh when Stop wins the token wait.
      // The browser cancels immediately; this server waiter still joins lease
      // publication before returning. API-key targets have no refresh work.
      const resolved = await resolveTarget(target);
      attempt.signal.throwIfAborted();
      events = streamChat({
        target: resolved,
        messages: chat,
        web,
        maxTokens,
        signal: attempt.signal,
      });
      while (first === null) {
        const next = await interruptible(events.next(), firstWait.signal);
        if (next.done) throw new Error("Provider returned no answer");
        if (next.value.type === "text" && next.value.text)
          first = next.value.text;
        else if (next.value.type === "citation") citations.push(next.value);
        else if (next.value.type === "error") throw next.value.error;
      }
    } catch (error) {
      // The previous attempt is always aborted before another provider starts.
      attempt.abort(error);
      firstWait.dispose();
      if (events) await closeEvents(events);
      attempt.dispose();
      options.timings?.mark(`attempt-${index + 1}-failed`);
      signal.throwIfAborted();
      await onFailure(error).catch(() => {});
      if (isTerminalChatGPTError(error))
        return Response.json(
          { code: `chatgpt_${error.kind}`, error: error.readerMessage },
          { status: error.responseStatus },
        );
      continue;
    }
    firstWait.dispose();
    const activeEvents = events;
    options.timings?.mark("first-token");
    let answer = first;
    let pending: string | null = first;
    let finished = false;
    let cleanup: Promise<void> | undefined;
    const encoder = new TextEncoder();
    let removeAbort = () => {};
    const finish = (cancelPublication = false) => {
      if (cancelPublication) options.publication?.abort(attempt.signal.reason);
      if (cleanup) return cleanup;
      finished = true;
      removeAbort();
      attempt.abort();
      cleanup = (async () => {
        await closeEvents(activeEvents);
        await options.publication?.settle();
      })().finally(() => {
        attempt.dispose();
        options.publication?.dispose();
      });
      return cleanup;
    };
    const body = new ReadableStream<Uint8Array>(
      {
        start(controller) {
          const aborted = () => {
            const reason = attempt.signal.reason;
            // The stream owns this cleanup even without another downstream pull.
            finish(true).then(() => controller.error(reason));
          };
          attempt.signal.addEventListener("abort", aborted, { once: true });
          removeAbort = () =>
            attempt.signal.removeEventListener("abort", aborted);
          if (attempt.signal.aborted) aborted();
        },
        async pull(controller) {
          if (finished) return;
          try {
            attempt.signal.throwIfAborted();
            if (pending !== null) {
              controller.enqueue(encoder.encode(pending));
              pending = null;
              return;
            }
            // Idle is provider wait, not time a slow consumer spends reading.
            const idle = requestAttempt(attempt.signal, deadlines.idleMs);
            try {
              for (;;) {
                const next = await interruptible(
                  activeEvents.next(),
                  idle.signal,
                );
                if (next.done) {
                  const footer = sourcesFooter(answer, citations);
                  if (footer) controller.enqueue(encoder.encode(footer));
                  await finish();
                  signal.throwIfAborted();
                  controller.close();
                  return;
                }
                const event = next.value;
                if (event.type === "citation") citations.push(event);
                else if (event.type === "error")
                  throw new Error("The answer was interrupted. Try again.");
                else if (event.type === "truncated") {
                  controller.enqueue(encoder.encode(TRUNCATED_NOTICE));
                  return;
                } else {
                  answer += event.text;
                  controller.enqueue(encoder.encode(event.text));
                  return;
                }
              }
            } finally {
              idle.dispose();
            }
          } catch (error) {
            await finish(true);
            controller.error(error);
          }
        },
        async cancel(reason) {
          removeAbort();
          attempt.abort(reason);
          await finish(true);
        },
      },
      { highWaterMark: 0 },
    );
    return new Response(body, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Companion-Model": target.id,
      },
    });
  }
  return new Response("Every model failed. Try again shortly.", {
    status: 502,
  });
}
