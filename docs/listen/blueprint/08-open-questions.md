# 08: Open questions and spikes

## Spikes (phase 0; run against BK's real OpenRouter key)

For each, record the request, the response (with private text removed), the date and the conclusion in `docs/research/spikes/`, then update the document it affects. Use a public article, not one from a library.

Kokoro parts of S1–S3 ran on 2026-10-22: [../../research/spikes/2026-10-22-kokoro.md](../../research/spikes/2026-10-22-kokoro.md). BK picked Kokoro · Heart from the samples (D-TTS-024).

| # | Question | Why it matters | Affects | Blocks |
|---|---|---|---|---|
| S1 | Read the same three public articles (an essay with quotes, a technical post with a list, a piece with numbers and abbreviations) with every catalog model and two or three voices each. Does each read verbatim, with the `instructions` text below where the model takes it, and which voices sound like a good narrator? | Rung 1 needs only the Kokoro part: which Kokoro voice is the default (D-TTS-021). The other models' voices and the verbatim check for Gemini feed the catalog (D-TTS-004). A model that paraphrases or speaks its instructions is broken for an article reader. | [03](03-voices-and-providers.md) | Rung 1 (Kokoro), rung 3 (the rest) |
| S2 | For each model, how many bytes and seconds of MP3 does 1,000 characters make? | Confirms a clip fits the action's return limit (D-TTS-022), and sets the storage budget and the per-hour cost shown in the picker (D-TTS-007, D-TTS-014). | [03](03-voices-and-providers.md), [04](04-synthesis-and-cache.md) | Rung 1 (Kokoro), rung 3 (the rest) |
| S3 | Time from request to complete audio for a 300-character and a 2,000-character block, per model, from a Convex action. | If the first clip takes over 2 seconds, the first block is split at its first sentence ([05](05-player.md#starting)). Sets the lead of three clips (D-TTS-008). | [05](05-player.md) | Rung 1 |
| S4 | On BK's iPhone, in the installed PWA and in Safari: with the screen locked, does playback continue from one clip to the next when `src` changes in the `ended` handler? Do lock-screen controls and AirPods taps reach the Media Session handlers? Repeat on Android Chrome. | The main reason to leave Web Speech for an audio element (D-TTS-009). If iOS stops between clips, rung 2 joins clips before playing them ([05](05-player.md#background-playback)). | [05](05-player.md) | Rung 2 |
| S5 | Which voice names does OpenRouter accept for `elevenlabs/eleven-v4-turbo`, and does `provider: { data_collection: "deny" }` leave a provider for each catalog model? | The ElevenLabs entry (D-TTS-004) and the data setting (D-TTS-015). | [03](03-voices-and-providers.md) | Rung 3 |

The narrator instructions S1 tests, sent as `instructions` to models that accept them:

> Read the text exactly as written, word for word, as a calm, attentive narrator reading an essay aloud. Do not add, skip or rephrase anything.

## Product questions for BK

| # | Question | Status |
|---|---|---|
| Q1 | Which voice should a reader hear first? The choice is between price and quality: Gemini 3.8 Flash-Lite (about $0.59 an hour, eighth on the leaderboard), Kokoro (about $0.03 an hour, clearly a step down but still natural) or Eleven v4 Turbo (about $2.16 an hour, the best). | Answered by BK 2026-10-22: Kokoro (D-TTS-021). S1 picks which Kokoro voice. |
| Q2 | Is "Read to you" the right idea for listening: the narrator lends a voice to the print, the highlighter follows the voice, and nothing else on the page changes? | Open; blueprint assumes yes (D-TTS-020) |
| Q3 | When there's no OpenRouter key, or synthesis keeps failing, should Listen offer the device voice at all, named as such, or say Listen needs a key? | Open; blueprint assumes it offers the device voice, named, never as a silent switch (D-TTS-013) |
| Q4 | Should the voice read the title and byline before the first paragraph, and read figure captions? | Open; blueprint assumes title and byline when starting from the top, and captions read (D-TTS-011) |
| Q5 | Is 30 days after last play the right time to keep clips? Longer makes re-listening free; shorter keeps storage inside the free 1 GB. | Open, needed by rung 3; blueprint assumes 30 days (D-TTS-007, D-TTS-022) |
| Q6 | Readers with only an Anthropic or OpenAI key get the device voice. Is that acceptable for now, or is a second path needed before release to other readers? | Open; blueprint assumes acceptable (D-TTS-002, D-TTS-005) |
| Q7 | What one or two words describe each Kokoro voice? The catalog says only accent and speaker (D-TTS-028). | Answered by BK 2026-10-28: keep accent and speaker. Words for a voice can be added later in `character` in `packages/backend/convex/lib/speechVoices.ts` |
