# 04: Synthesis and cache

The backend turns one block of spoken text into one MP3 clip. It never decides what to read or when; the player does ([05](05-player.md)).

## Rung 1 returns the audio; rung 3 adds the cache

With Kokoro as the default, a replay costs a fraction of a cent, so rung 1 has no cache (D-TTS-022). Its `speech.clip` runs steps 1–3, 5 and 6 of [the action](#the-action), checks the body as in step 7, and returns the MP3 bytes:

```ts
export const clip = action({
  args: { articleId: v.id("articles"), text: v.string(), voice: v.optional(v.string()) },
  returns: v.bytes(),
  handler: async (ctx, args) => { ... },
});
```

A 2,000-character clip is about two minutes of audio, roughly 1 MB at 64 kbps, far under the 16 MiB return limit (S2 confirms). Everything below the spoken-text section — the table, the stored clips, the cache query, retention — is rung 3, when readers can pick voices that cost $0.59–$2.16 an hour. In rung 3 the action changes to the URL-returning form below.

## What the client sends

The text comes from the client, because the blocks are what the reader package renders in the browser (`getParagraphs()`), and the server has no copy of that DOM. Trusting client text is safe here: the clip is paid for on the reader's own key and stored in the reader's own space, so the worst a forged request can do is spend that reader's money on that reader's clip. The action still caps each text at 2,000 characters and applies the `speech` budget (D-TTS-016).

## Spoken text

`apps/web/src/lib/spoken-text.ts` turns a block element into what the voice says (D-TTS-011). It's a pure function on a DOM element, tested with fixtures:

1. Start from `paragraphText(el)`.
2. Skip `pre`, `code`-only blocks and tables entirely: they return `null` and the player passes over them.
3. Drop footnote markers: `sup` elements whose text is a number or symbol, and bracketed numbers such as `[12]`.
4. Replace a bare URL with "a link to <domain>" (`example.com`, without `www.`).
5. Collapse whitespace. End headings with a full stop if they have no closing punctuation, so the voice falls at the end.
6. Split a result over 2,000 characters at sentence ends with `Intl.Segmenter(lang, { granularity: "sentence" })`, packing sentences into parts of at most 2,000 characters. A single sentence over 2,000 characters splits at the last comma or space before the limit.

The title block is "<title>. By <author>." (or just "<title>." with no author), spoken before ¶1 when Listen starts from the top (Q4).

## Data model

One new table in `packages/backend/convex/schema.ts`:

```ts
speechClips: defineTable({
  userId: v.string(),
  articleId: v.id("articles"),
  voice: v.string(),          // catalog id, e.g. "openrouter:google/gemini-3.8-flash-lite-tts#Charon"
  textHash: v.string(),       // SHA-256 hex of the spoken text
  storageId: v.id("_storage"),
  chars: v.number(),
  bytes: v.number(),
  generationId: v.optional(v.string()), // OpenRouter X-Generation-Id
  createdAt: v.number(),
  lastPlayedAt: v.number(),
})
  .index("by_userId_and_articleId_and_voice_and_textHash", ["userId", "articleId", "voice", "textHash"])
  .index("by_lastPlayedAt", ["lastPlayedAt"])
  .index("by_articleId", ["articleId"]),
```

- The key is reader, article, voice and text hash. Text, not paragraph number, because re-extraction or an edited article can move paragraphs, and an unchanged paragraph should stay free.
- Clips are per reader, even for an article two readers share, because each paid with their own key.
- Book parts use the book's article ID. `unitKey` isn't part of the key: the text hash already separates parts.
- `lastPlayedAt` is set at creation and refreshed when a clip URL is handed out again, at most once an hour per clip, so playback doesn't write on every paragraph.

## The action

`packages/backend/convex/speech.ts`, an `action` from `convex/functions.ts` (the wrapper that sets `ctx.readerId`). It runs in the default Convex runtime like every other action in the repo: `fetch`, `Blob` and `ctx.storage.store` are all there, and a 2,000-character clip is a few megabytes at most, well inside the runtime's 64 MiB.

```ts
export const clip = action({
  args: { articleId: v.id("articles"), text: v.string(), voice: v.optional(v.string()) },
  returns: v.object({ url: v.string(), cached: v.boolean() }),
  handler: async (ctx, args) => { ... },
});
```

1. Check the article belongs to `ctx.readerId` (`requireArticle`, `access.ts:121`, through an internal query).
2. Reject text that's empty or over 2,000 characters.
3. Resolve the voice: the argument (used by settings samples), else `userSettings.speechVoice`, else the default. Reject an ID that isn't in the catalog.
4. Hash the text. Look up the clip by the index. If it exists and its file still exists, refresh `lastPlayedAt` (rule above) and return `ctx.storage.getUrl(storageId)` with `cached: true`.
5. Spend one unit of the `speech` budget (D-TTS-016). Load the reader's OpenRouter key through `loadReaderAI` (`lib/router.ts`). With none, throw a `ConvexError` with `NO_SPEECH_KEY` ("Natural voices need an OpenRouter key. Add one in Your account.").
6. Call OpenRouter ([03](03-voices-and-providers.md#the-request)), with the retries in [03](03-voices-and-providers.md#errors).
7. Check the body is non-empty and `Content-Type` is `audio/mpeg`. Store it with `ctx.storage.store(new Blob([bytes], { type: "audio/mpeg" }))`.
8. Insert the row through an internal mutation that first re-checks the index. If another request stored the same clip meanwhile, delete the new file and return the existing one. Two parallel requests for one clip can both pay; the player avoids that by never requesting a clip twice ([05](05-player.md)).
9. Return the URL with `cached: false`.

The cache check is a separate query, `speech.cachedClip`, which the player calls first. A cached clip then needs no action, no key decryption and no budget.

## Budget

`READER_LIMITS.speech = { max: 60, windowMs: 60_000, message: "Listening is paused for a minute to limit requests." }` (D-TTS-016). At the player's lead of three clips a listener uses one or two a minute. Sixty leaves room for fast skipping and samples, and stops a runaway loop within a minute.

## Retention

A daily job in `crons.ts`, `speech.pruneClips`, deletes clips whose `lastPlayedAt` is over 30 days old (Q5), 200 rows per run, rescheduling itself while a full page remains. Each deletion removes the file first, then the row.

Clips also go when their article does: the article deletion and feed removal paths, and the account purge (`account.ts:416` already deletes stored files), delete the article's clips by `by_articleId`.

## Storage and egress

Until S2 measures it, assume 64 kbps mono MP3: about 29 MB per hour of audio. Thirty hours a month of listening at 30-day retention holds under 1 GB, the included storage on Convex's Free and Starter plans, and serves under 1 GB of egress. S2 replaces these numbers; if they're much larger, the retention period drops before the cache does.

## Tests

- `spoken-text` fixtures: footnotes, URLs, headings, a `pre` block, a 5,000-character paragraph, a single 2,500-character sentence.
- `speech.clip` with a stubbed fetch: cache hit returns without a fetch; miss stores and inserts; 401, 402, 429 and 502 produce the right `ConvexError` and retry count; no key; foreign article; over-long text; the duplicate race in step 8.
- `pruneClips`: deletes files and rows past 30 days, keeps recent ones, pages.
