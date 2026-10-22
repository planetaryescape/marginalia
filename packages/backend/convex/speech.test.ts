/// <reference types="vite/client" />
import { ConvexError } from "convex/values";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  saveTestCredential,
  secondReaderTest,
  TEST_ENCRYPTION_KEY,
} from "../test/owner";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { speechRequestBody } from "./speech";
import {
  DEFAULT_SPEECH_VOICE,
  findSpeechVoice,
  SPEECH_VOICES,
} from "./lib/speechVoices";
import { READER_LIMITS } from "./limits";

const modules = import.meta.glob("./**/*.ts");
const OWNER = "default_user";
const READER_KEY = "sk-or-reader-speech-fixture-0001";
const OWNER_KEY = "sk-or-owner-speech-fixture-0002";
const TEXT = "The zebra stands in the grass, and the grass is long.";
const MP3 = new Uint8Array([0xff, 0xfb, 0x90, 0x00, 1, 2, 3]).buffer;
const KOKORO = "openrouter:hexgrad/kokoro-82m#af_heart";

const COPY = {
  noKey: "Natural voices need an OpenRouter key. Add one in Your account.",
  unreadable: "The voice couldn't read this paragraph.",
  unreadableArticle: "The voice couldn't read this article.",
  unknownVoice: "That voice isn't available.",
  refused: "Your OpenRouter key was refused. Check it in Your account.",
  noCredit: "Your OpenRouter credit has run out.",
  busy: "The voice stopped: OpenRouter is busy. Try again in a moment.",
  unanswered: "The voice stopped: OpenRouter didn't answer.",
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("PROVIDER_KEYS_ENCRYPTION_KEY", TEST_ENCRYPTION_KEY);
  // A developer's shell must not supply a key the reader doesn't own
  vi.stubEnv("OPENROUTER_API_KEY", "");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

interface Call {
  url: string;
  headers: Headers;
  body: ReturnType<typeof speechRequestBody>;
  at: number;
}
type Step = () => Response;

const audio: Step = () =>
  new Response(MP3, {
    headers: { "content-type": "audio/mpeg", "x-generation-id": "gen-test-1" },
  });
const status =
  (code: number): Step =>
  () =>
    new Response(null, { status: code });
const networkError: Step = () => {
  throw new TypeError("fetch failed");
};

/** Answers each OpenRouter call with the next step; no real provider is called. */
function stubFetch(...steps: Step[]): Call[] {
  const calls: Call[] = [];
  const queue = [...steps];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({
        url: String(input),
        headers: new Headers(init?.headers),
        body: JSON.parse(String(init?.body)),
        at: Date.now(),
      });
      const step = queue.shift() ?? audio;
      return step();
    }),
  );
  return calls;
}

/** Runs an action under fake time, stepping the clock until it settles. */
async function settled<T>(work: Promise<T>): Promise<T> {
  let done = false;
  const tracked = work.finally(() => {
    done = true;
  });
  tracked.catch(() => {});
  for (let step = 0; !done && step < 1000; step++)
    await vi.advanceTimersByTimeAsync(100);
  return work;
}

async function setup() {
  const { t, reader, readerLibraryId } = await secondReaderTest(modules);
  const articleId: Id<"articles"> = await t.run((ctx) =>
    ctx.db.insert("articles", {
      userId: readerLibraryId,
      guid: "g:zebra",
      url: "https://example.com/zebra",
      title: "The Zebra",
      extractionStatus: "extracted",
      createdAt: 0,
      annotationStatus: "skipped",
    }),
  );
  await saveTestCredential(t, readerLibraryId, "openrouter", READER_KEY);
  const clip = (
    args: { text?: string; voice?: string; articleId?: Id<"articles"> } = {},
  ) =>
    settled(
      reader.action(api.speech.clip, {
        articleId: args.articleId ?? articleId,
        text: args.text ?? TEXT,
        ...(args.voice === undefined ? {} : { voice: args.voice }),
      }),
    );
  return { t, reader, readerLibraryId, articleId, clip };
}

describe("speech.clip", () => {
  it("returns the MP3 bytes and sends the reader's key with the exact body", async () => {
    const { clip } = await setup();
    const calls = stubFetch(audio);

    const bytes = await clip();

    expect(new Uint8Array(bytes)).toEqual(new Uint8Array(MP3));
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://openrouter.ai/api/v1/audio/speech");
    expect(calls[0].headers.get("authorization")).toBe(`Bearer ${READER_KEY}`);
    expect(calls[0].body).toEqual({
      model: "hexgrad/kokoro-82m",
      input: TEXT,
      voice: "af_heart",
      response_format: "mp3",
      provider: { sort: "price", data_collection: "deny" },
    });
  });

  it("logs the generation, size and voice of a clip, never the text or key", async () => {
    const { clip } = await setup();
    stubFetch(audio);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    await clip();

    expect(log).toHaveBeenCalledWith("Speech clip", {
      generationId: "gen-test-1",
      characters: TEXT.length,
      voice: KOKORO,
    });
    const logged = JSON.stringify([
      ...log.mock.calls,
      ...error.mock.calls,
    ]);
    expect(logged).not.toContain(TEXT);
    expect(logged).not.toContain(READER_KEY);
  });

  it("accepts text of exactly 2,000 characters and refuses 2,001", async () => {
    const { clip } = await setup();
    const calls = stubFetch(audio, audio);

    await expect(clip({ text: "a".repeat(2000) })).resolves.toBeDefined();
    await expect(clip({ text: "a".repeat(2001) })).rejects.toThrow(COPY.unreadable);
    expect(calls).toHaveLength(1);
  });

  it.each(["", "   \n\t"])("refuses empty text (%j) without calling OpenRouter", async (text) => {
    const { clip } = await setup();
    const calls = stubFetch(audio);

    await expect(clip({ text })).rejects.toThrow(COPY.unreadable);
    expect(calls).toHaveLength(0);
  });

  it("uses the default voice when none is named", async () => {
    const { clip } = await setup();
    const calls = stubFetch(audio);

    await clip();
    expect(DEFAULT_SPEECH_VOICE).toBe(KOKORO);
    expect(calls[0].body.voice).toBe("af_heart");
  });

  it.each(["bm_george", "openrouter:hexgrad/kokoro-82m#bm_george", "constructor", "__proto__", "toString"])(
    "refuses the voice %s without calling OpenRouter",
    async (voice) => {
      const { clip } = await setup();
      const calls = stubFetch(audio);

      await expect(clip({ voice })).rejects.toThrow(COPY.unknownVoice);
      expect(calls).toHaveLength(0);
    },
  );

  it("refuses another reader's article without calling OpenRouter", async () => {
    const { t, clip } = await setup();
    const ownersArticle: Id<"articles"> = await t.run((ctx) =>
      ctx.db.insert("articles", {
        userId: OWNER,
        guid: "g:owner",
        url: "https://example.com/owner",
        title: "The Owner's",
        extractionStatus: "extracted",
        createdAt: 0,
        annotationStatus: "skipped",
      }),
    );
    const calls = stubFetch(audio);

    const refused = await clip({ articleId: ownersArticle }).catch(
      (error: unknown) => error,
    );
    // A string ConvexError, so the bar can show it; never the internal message
    expect(refused).toBeInstanceOf(ConvexError);
    expect((refused as ConvexError<string>).data).toBe(COPY.unreadableArticle);
    expect(calls).toHaveLength(0);
  });

  it("refuses without the reader's own OpenRouter key, never another's or the server's", async () => {
    const { t, reader, readerLibraryId } = await secondReaderTest(modules);
    const articleId: Id<"articles"> = await t.run((ctx) =>
      ctx.db.insert("articles", {
        userId: readerLibraryId,
        guid: "g:keyless",
        url: "https://example.com/keyless",
        title: "Keyless",
        extractionStatus: "extracted",
        createdAt: 0,
        annotationStatus: "skipped",
      }),
    );
    // The owner has an OpenRouter key and the reader only an OpenAI one
    await saveTestCredential(t, OWNER, "openrouter", OWNER_KEY);
    await saveTestCredential(t, readerLibraryId, "openai", "sk-openai-reader-fixture-0003");
    vi.stubEnv("OPENROUTER_API_KEY", "server-key-fixture-0004");
    const calls = stubFetch(audio);

    await expect(
      settled(reader.action(api.speech.clip, { articleId, text: TEXT })),
    ).rejects.toThrow(COPY.noKey);
    expect(calls).toHaveLength(0);
  });

  it("treats a saved key that won't open as no key", async () => {
    const { t, readerLibraryId, clip } = await setup();
    await t.run(async (ctx) => {
      const row = await ctx.db
        .query("providerCredentials")
        .withIndex("by_userId_and_provider", (q) =>
          q.eq("userId", readerLibraryId).eq("provider", "openrouter"),
        )
        .unique();
      if (row) await ctx.db.patch("providerCredentials", row._id, { ciphertext: "AAAA" });
    });
    const calls = stubFetch(audio);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(clip()).rejects.toThrow(COPY.noKey);
    expect(calls).toHaveLength(0);
    expect(error).toHaveBeenCalledWith("Couldn't open the saved OpenRouter key");
  });

  it("an unknown voice spends no budget", async () => {
    const { t, readerLibraryId, clip } = await setup();
    stubFetch(audio);

    await expect(clip({ voice: "nope" })).rejects.toThrow(COPY.unknownVoice);
    const row = await t.run((ctx) =>
      ctx.db
        .query("readerLimits")
        .withIndex("by_userId_and_bucket", (q) =>
          q.eq("userId", readerLibraryId).eq("bucket", "speech"),
        )
        .unique(),
    );
    expect(row).toBeNull();
  });

  it("stops at the speech budget and spends nothing on refused requests first", async () => {
    const { t, readerLibraryId, clip } = await setup();
    // One request left in the window; a bad request must not take it
    await t.run((ctx) =>
      ctx.db.insert("readerLimits", {
        userId: readerLibraryId,
        bucket: "speech",
        startedAt: Date.now(),
        count: READER_LIMITS.speech.max - 1,
      }),
    );
    const calls = stubFetch(audio, audio);

    await expect(clip({ text: "" })).rejects.toThrow(COPY.unreadable);
    await expect(clip()).resolves.toBeDefined();
    await expect(clip()).rejects.toThrow(READER_LIMITS.speech.message);
    expect(calls).toHaveLength(1);
  });

  it("spends one budget unit per call, not per retry", async () => {
    const { t, readerLibraryId, clip } = await setup();
    stubFetch(status(429), status(429), audio);

    await clip();
    const row = await t.run((ctx) =>
      ctx.db
        .query("readerLimits")
        .withIndex("by_userId_and_bucket", (q) =>
          q.eq("userId", readerLibraryId).eq("bucket", "speech"),
        )
        .unique(),
    );
    expect(row?.count).toBe(1);
  });

  it("retries a rate-limited request after 1 s and then 3 s, and succeeds", async () => {
    const { clip } = await setup();
    const calls = stubFetch(status(429), status(429), audio);

    await clip();

    expect(calls).toHaveLength(3);
    expect(calls.map((call) => call.at - calls[0].at)).toEqual([0, 1000, 4000]);
  });

  it("gives up on rate limits after two retries", async () => {
    const { clip } = await setup();
    const calls = stubFetch(status(429), status(429), status(429), audio);

    await expect(clip()).rejects.toThrow(COPY.busy);
    expect(calls).toHaveLength(3);
  });

  it.each([
    ["400", status(400), COPY.unreadable, 1],
    ["401", status(401), COPY.refused, 1],
    ["403", status(403), COPY.refused, 1],
    ["402", status(402), COPY.noCredit, 1],
    ["404 (not a listed status)", status(404), COPY.unreadable, 1],
    ["413", status(413), COPY.unreadable, 1],
    ["422", status(422), COPY.unreadable, 1],
  ])("shows the right sentence for %s and does not retry", async (_, step, sentence, calls) => {
    const { clip } = await setup();
    const seen = stubFetch(step, audio);

    await expect(clip()).rejects.toThrow(sentence);
    expect(seen).toHaveLength(calls);
  });

  it("does not retry a refused key", async () => {
    const { clip } = await setup();
    const calls = stubFetch(status(401), audio);

    await expect(clip()).rejects.toThrow(COPY.refused);
    expect(calls).toHaveLength(1);
  });

  it("logs the length and voice of a refused text, not the text", async () => {
    const { clip } = await setup();
    stubFetch(status(400));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(clip()).rejects.toThrow(COPY.unreadable);
    expect(error).toHaveBeenCalledWith("Speech request failed", {
      reason: "status",
      status: 400,
      characters: TEXT.length,
      voice: KOKORO,
    });
    expect(JSON.stringify(error.mock.calls)).not.toContain(TEXT);
  });

  it.each([
    ["a timeout", "timeout", () => { throw new DOMException("The operation timed out.", "TimeoutError"); }],
    ["a network error", "network error", networkError],
  ])("logs %s with its own reason", async (_, reason, failing) => {
    const { clip } = await setup();
    stubFetch(failing, failing);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(clip()).rejects.toThrow(COPY.unanswered);
    expect(error).toHaveBeenCalledWith("Speech request failed", {
      reason,
      status: null,
      characters: TEXT.length,
      voice: KOKORO,
    });
  });

  it.each([
    ["a 500", status(500)],
    ["a network error", networkError],
    [
      "a timeout",
      () => {
        throw new DOMException("The operation timed out.", "TimeoutError");
      },
    ],
    ["an empty body", () => new Response(new Uint8Array(0), { headers: { "content-type": "audio/mpeg" } })],
    ["a non-audio body", () => Response.json({ error: "bad" })],
  ])("retries %s once at once, then says OpenRouter didn't answer", async (_, failing) => {
    const { clip } = await setup();
    const calls = stubFetch(failing, failing);

    await expect(clip()).rejects.toThrow(COPY.unanswered);
    expect(calls).toHaveLength(2);
    expect(calls[1].at).toBe(calls[0].at);
  });

  it("succeeds when the one immediate retry works", async () => {
    const { clip } = await setup();
    const calls = stubFetch(status(500), audio);

    await expect(clip()).resolves.toBeDefined();
    expect(calls).toHaveLength(2);
  });
});

describe("speechRequestBody", () => {
  it("sends instructions only when the catalog entry takes them", () => {
    const [kokoro] = SPEECH_VOICES;
    expect(kokoro.instructions).toBe(false);
    expect(speechRequestBody(kokoro, TEXT)).not.toHaveProperty("instructions");

    const withInstructions = { ...kokoro, instructions: true };
    expect(speechRequestBody(withInstructions, TEXT)).toHaveProperty("instructions");
  });
});

describe("speech voice catalog", () => {
  it("finds catalog voices by id and misses prototype keys", () => {
    expect(findSpeechVoice(KOKORO)?.voice).toBe("af_heart");
    expect(findSpeechVoice("constructor")).toBeUndefined();
    expect(findSpeechVoice("__proto__")).toBeUndefined();
    expect(findSpeechVoice("hasOwnProperty")).toBeUndefined();
  });
});
