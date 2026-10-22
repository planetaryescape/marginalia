# 03: Voices and providers

Speech goes through one endpoint, OpenRouter's `POST /api/v1/audio/speech`, using the reader's own saved OpenRouter key (D-TTS-002). The facts and prices here were checked on 2026-10-22 and are in [../../research/text-to-speech.md](../../research/text-to-speech.md).

## The speech catalog

A new file, `packages/backend/convex/lib/speechVoices.ts`, holds the catalog. It follows `MODEL_CATALOG` in `lib/providers.ts`: a short, current list, with any model ID corrected here only (D-TTS-004).

```ts
export interface SpeechVoice {
  id: string;            // "openrouter:google/gemini-3.8-flash-lite-tts#Charon"
  model: string;         // OpenRouter model id
  voice: string;         // the provider's voice name
  name: string;          // "Kokoro · Emma"
  character: string;     // one or two words: "calm, clear"
  centsPerHour: number;  // from S2, shown in settings (D-TTS-014)
  instructions: boolean; // whether the model takes `instructions`
  maxChars: number;      // per-request cap, used by block splitting
}
```

| Model | OpenRouter id | Role | Voice candidates for S1 | `maxChars` |
|---|---|---|---|---|
| Kokoro 82M | `hexgrad/kokoro-82m` | Default (D-TTS-021) | `af_heart`, `bf_emma`, `bm_george`, `am_michael` | 2,000 |
| Gemini 3.8 Flash-Lite TTS | `google/gemini-3.8-flash-lite-tts` | Better | Charon, Sulafat, Iapetus, Schedar | 2,000 |
| Gemini 3.8 Flash TTS | `google/gemini-3.8-flash-tts` | Richer | the two Flash-Lite winners | 2,000 |
| Eleven v4 Turbo | `elevenlabs/eleven-v4-turbo` | Best | from S5 | 2,000 |

Every model gets the same 2,000-character block cap, even where a model takes more, because the cap also bounds the wait for one clip and the cost of one failure (D-TTS-006). Kokoro's 4,096-token limit sits comfortably above it.

Each model keeps two or three voices after S1. A voice survives S1 only if it reads all three test articles verbatim and sounds like a narrator, not an announcer or an assistant. Rung 1 ships Kokoro alone, with the voice BK picks in S1 (D-TTS-021). The other three arrive in rung 3. If Gemini Flash-Lite fails the verbatim test, Voxtral 3 (`mistralai/voxtral-mini-tts-3-0`, about $0.70 an hour) takes its place in the catalog.

## The request

```http
POST https://openrouter.ai/api/v1/audio/speech
Authorization: Bearer <reader's OpenRouter key>
Content-Type: application/json

{
  "model": "hexgrad/kokoro-82m",
  "input": "<the block's spoken text>",
  "voice": "bf_emma",
  "response_format": "mp3",
  "instructions": "Read the text exactly as written, word for word, as a calm, attentive narrator reading an essay aloud. Do not add, skip or rephrase anything.",
  "provider": { "data_collection": "deny" }
}
```

- `response_format` is always `mp3`. PCM is OpenRouter's default and is several times larger, and we don't stream (D-TTS-009).
- `instructions` is sent only when the catalog entry says the model takes it: Gemini does, Kokoro doesn't, so rung 1 never sends it. S1 confirms the wording for Gemini.
- `speed` is never sent. Speed is applied at playback (D-TTS-010), so one clip serves every speed.
- `provider.data_collection: "deny"` asks OpenRouter to route only to providers that don't keep data for training (D-TTS-015). S5 confirms each catalog model still has a provider under it; a model that doesn't is shown in settings as "Not available with private routing" and can't be chosen.
- The response body is the MP3. `X-Generation-Id` is logged with the clip, so a reader's question about a charge can be traced.

## Errors

| Response | Meaning | What happens |
|---|---|---|
| 200 | Audio | Return the clip; from rung 3, store it first ([04](04-synthesis-and-cache.md)) |
| 400 | Bad input (usually text too long or an unsupported voice) | Not retried. The block is logged with its length and the voice. The bar shows "The voice couldn't read this paragraph" and offers skip. That's a bug in splitting or the catalog. |
| 401, 403 | Key rejected | Not retried. "Your OpenRouter key was refused. Check it in Your account." |
| 402 | Out of credit | Not retried. "Your OpenRouter credit has run out." |
| 429 | Rate limited | Retried twice, after 1 s and 3 s, then shown as a failure |
| 502, timeout | Provider failed (not billed) | Retried once at once, then shown as a failure |
| Empty or non-audio body | Provider bug | Treated as 502 |

A request times out after 30 seconds. The action throws a `ConvexError` carrying the sentence, and the client shows it with `failureSentence` (`apps/web/src/lib/failure-copy.ts`), once, in the bar ([05](05-player.md#failure)), never as a toast.

## Readers without an OpenRouter key

A reader with only OpenAI or Anthropic keys has no natural voice in v1. OpenAI's own TTS models shut down on 2027-01-06 (D-TTS-005), and Anthropic has no speech endpoint. These readers see the no-key choice in the bar (Q3, Q6).

The device voice keeps today's `pickVoice()` unchanged. It's a fallback, and polishing it is not this work.

## Settings › Listening

A new section in reader settings, below Models, built with the design blueprint's settings form pattern ([02](02-design-concept.md#settings--listening) has the layout and feel):

- **Voice.** A radio list of the catalog voices. Each row has its name, character, cost per hour and a ▶ sample. The choice is stored as `speechVoice` (a catalog `id`) in `userSettings`, beside `annotationModel`, `quickModel` and `deepModel`, because it's an account choice that should follow the reader across devices. A stored ID that's no longer in the catalog falls back to the default.
- **Sample.** ▶ synthesizes the open article's current paragraph, or a fixed sentence when no article is open, and plays it in the settings panel. Samples go through the same action and cache as listening, so a second press is free. (Settings arrive in rung 3, with the cache.)
- **Speed.** A slider from 0.8× to 2× in 0.05 steps, mirrored by the bar's speed button. Stored in browser storage with the other reader settings (D-TTS-010).
- **Note.** "Uses your OpenRouter key. Clips are kept 30 days so replays are free." When the reader has no OpenRouter key, the list is shown disabled, with "Add an OpenRouter key in Your account to use these voices."

## Cost shown to the reader

`centsPerHour` comes from S2's measured characters per minute and the model's OpenRouter price, rounded to the nearest cent, and is shown as "about $0.59 an hour". It's a guide, not a bill. The catalog comment records the date the prices were read, so a later agent knows when to check them again.
