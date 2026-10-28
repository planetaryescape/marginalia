// Reads one block of article text aloud through OpenRouter, with the reader's
// own key. Rung 1 returns the MP3 and keeps no copy (blueprint 04).

import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { ActionCtx } from "./_generated/server";
import { requireArticle } from "./access";
import { action, internalQuery } from "./functions";
import { decryptProviderKey } from "./lib/providerKeys";
import {
  DEFAULT_SPEECH_VOICE,
  findSpeechVoice,
  type SpeechVoice,
} from "./lib/speechVoices";
import { requireReaderLimit } from "./limits";

const ENDPOINT = "https://openrouter.ai/api/v1/audio/speech";
const TIMEOUT_MS = 30_000;
const MAX_CHARS = 2000;
// Waits before the second and third try of a rate-limited request
const BUSY_RETRY_DELAYS_MS = [1_000, 3_000];

const NARRATOR_INSTRUCTIONS =
  "Read the text exactly as written, word for word, as a calm, attentive narrator reading an essay aloud. Do not add, skip or rephrase anything.";

const COPY = {
  noKey: "Natural voices need an OpenRouter key. Add one in Your account.",
  unreadable: "The voice couldn't read this paragraph.",
  unreadableArticle: "The voice couldn't read this article.",
  unknownVoice: "That voice isn't available.",
  refused: "Your OpenRouter key was refused. Check it in Your account.",
  noCredit: "Your OpenRouter credit has run out.",
  busy: "The voice stopped: OpenRouter is busy. Try again in a moment.",
  unanswered: "The voice stopped: OpenRouter didn't answer.",
} as const;

/** "backoff" waits and retries, "immediate" retries once at once, "none" stops. */
type Retry = "backoff" | "immediate" | "none";
interface Failure {
  sentence: string;
  retry: Retry;
}
type Attempt =
  | { ok: true; audio: ArrayBuffer; generationId: string | null }
  | ({ ok: false } & Failure);

const NO_ANSWER: Failure = { sentence: COPY.unanswered, retry: "immediate" };

function failureForStatus(status: number): Failure {
  if (status === 401 || status === 403)
    return { sentence: COPY.refused, retry: "none" };
  if (status === 402) return { sentence: COPY.noCredit, retry: "none" };
  if (status === 429) return { sentence: COPY.busy, retry: "backoff" };
  // A 5xx is the provider's failure and worth one more try. Any other refusal
  // (400, 404, 413, 422 and the like) is about the request, so it reads as the
  // paragraph and is not retried.
  if (status >= 500) return { sentence: COPY.unanswered, retry: "immediate" };
  return { sentence: COPY.unreadable, retry: "none" };
}

export function speechRequestBody(voice: SpeechVoice, input: string) {
  return {
    model: voice.model,
    input,
    voice: voice.voice,
    response_format: "mp3",
    // Only catalog entries that take instructions get them; Kokoro takes none
    ...(voice.instructions ? { instructions: NARRATOR_INSTRUCTIONS } : {}),
    // Cheapest provider for the model, and never one that keeps the text
    provider: { sort: "price", data_collection: "deny" },
  };
}

async function attemptRequest(
  apiKey: string,
  voice: SpeechVoice,
  input: string,
): Promise<Attempt> {
  const fail = (reason: string, status: number | null, failure: Failure) => {
    // Never the text or the key: only the size, the voice and what went wrong
    console.error("Speech request failed", {
      reason,
      status,
      characters: input.length,
      voice: voice.id,
    });
    return { ok: false as const, ...failure };
  };

  let response: Response;
  try {
    response = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(speechRequestBody(voice, input)),
      // Each attempt gets its own 30 seconds
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    const reason =
      error instanceof DOMException && error.name === "TimeoutError"
        ? "timeout"
        : "network error";
    return fail(reason, null, NO_ANSWER);
  }
  if (!response.ok)
    return fail("status", response.status, failureForStatus(response.status));

  try {
    const contentType = response.headers.get("content-type") ?? "";
    const audio = await response.arrayBuffer();
    if (!/^audio\//i.test(contentType) || audio.byteLength === 0)
      return fail("not audio", response.status, NO_ANSWER);
    return {
      ok: true,
      audio,
      generationId: response.headers.get("x-generation-id"),
    };
  } catch {
    // The body was cut off, or the timeout fired while it was still arriving
    return fail("body unreadable", response.status, NO_ANSWER);
  }
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Retries within each failure's own allowance, then throws its sentence. */
async function synthesize(
  apiKey: string,
  voice: SpeechVoice,
  input: string,
): Promise<{ audio: ArrayBuffer; generationId: string | null }> {
  let busyRetries = 0;
  let immediateRetries = 0;
  for (;;) {
    const attempt = await attemptRequest(apiKey, voice, input);
    if (attempt.ok) return attempt;
    if (
      attempt.retry === "backoff" &&
      busyRetries < BUSY_RETRY_DELAYS_MS.length
    ) {
      await sleep(BUSY_RETRY_DELAYS_MS[busyRetries]);
      busyRetries++;
      continue;
    }
    if (attempt.retry === "immediate" && immediateRetries < 1) {
      immediateRetries++;
      continue;
    }
    throw new ConvexError(attempt.sentence);
  }
}

/** The reader's own OpenRouter key, or null. A row that won't open counts as no key. */
async function openRouterKey(
  ctx: Pick<ActionCtx, "runQuery">,
  userId: string,
): Promise<string | null> {
  const sealed = await ctx.runQuery(internal.speech.sealedOpenRouterKey, {
    userId,
  });
  if (!sealed) return null;
  try {
    return await decryptProviderKey({
      userId,
      provider: "openrouter",
      ...sealed,
    });
  } catch {
    console.error("Couldn't open the saved OpenRouter key");
    return null;
  }
}

/** Throws requireArticle's error unless the article is this reader's. */
export const assertArticle = internalQuery({
  args: { articleId: v.id("articles"), userId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireArticle(ctx, args.articleId, args.userId);
    return null;
  },
});

/** The only key this action may use: the reader's own sealed OpenRouter key. */
export const sealedOpenRouterKey = internalQuery({
  args: { userId: v.string() },
  returns: v.union(
    v.object({ ciphertext: v.string(), iv: v.string() }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("providerCredentials")
      .withIndex("by_userId_and_provider", (q) =>
        q.eq("userId", args.userId).eq("provider", "openrouter"),
      )
      .unique();
    return row ? { ciphertext: row.ciphertext, iv: row.iv } : null;
  },
});

// Order matters: a bad request fails before it spends budget or opens a key
export const clip = action({
  args: {
    articleId: v.id("articles"),
    text: v.string(),
    voice: v.optional(v.string()),
  },
  returns: v.bytes(),
  handler: async (ctx, args): Promise<ArrayBuffer> => {
    // requireArticle throws a plain Error, which would reach the reader as no
    // sentence at all; ownership still comes first, before any spend
    try {
      await ctx.runQuery(internal.speech.assertArticle, {
        articleId: args.articleId,
        userId: ctx.readerId,
      });
    } catch {
      throw new ConvexError(COPY.unreadableArticle);
    }
    if (args.text.trim() === "" || args.text.length > MAX_CHARS)
      throw new ConvexError(COPY.unreadable);
    const voice = findSpeechVoice(args.voice ?? DEFAULT_SPEECH_VOICE);
    if (!voice) throw new ConvexError(COPY.unknownVoice);
    await requireReaderLimit(ctx, ctx.readerId, "speech");
    const apiKey = await openRouterKey(ctx, ctx.readerId);
    if (!apiKey) throw new ConvexError(COPY.noKey);

    const { audio, generationId } = await synthesize(apiKey, voice, args.text);
    console.log("Speech clip", {
      generationId,
      characters: args.text.length,
      voice: voice.id,
    });
    return audio;
  },
});
