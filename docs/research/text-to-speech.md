# Text-to-speech options for Listen (checked 2026-10-22)

Listen today speaks through the browser's Web Speech API, so the voice is whatever the device ships. This file records what better voices cost, where each fact came from, and what we didn't check. The decisions that rest on it are in [../listen/blueprint/07-decisions.md](../listen/blueprint/07-decisions.md).

## The reader's OpenRouter key already reaches 36 speech models

OpenRouter has a speech endpoint, `POST https://openrouter.ai/api/v1/audio/speech`, modelled on OpenAI's Audio Speech API. The request takes `model`, `input` and usually `voice`, plus optional `instructions` (delivery guidance, honoured by Gemini TTS, OpenAI and Fish Audio), `response_format` (`mp3` or `pcm`, default `pcm`), `speed` (honoured by some models only) and `provider` (routing options, including data collection and ZDR). The response body is raw audio, with `X-Generation-Id` naming the billed generation. Failed generations (502) aren't billed. The docs say long text should be split into segments and the audio concatenated. Source: [OpenRouter TTS guide](https://openrouter.ai/docs/guides/overview/multimodal/tts.md).

`GET https://openrouter.ai/api/v1/models?output_modalities=speech` returned 36 models on 2026-10-22. None of them is an OpenAI model, although the guide still uses `openai/gpt-4o-mini-tts-2025-12-15` as its example.

The docs also warn: "Some models treat a string as a prompt rather than verbatim text." That matters for an article reader, which must say exactly what the page says. It is spike S1.

## Quality and price of the candidates

Quality is the Elo score on the [Artificial Analysis TTS leaderboard](https://artificialanalysis.ai/text-to-speech/leaderboard), read on 2026-10-22. Its price column is per million characters at each creator's own API. The OpenRouter column is from the models API above: `pricing.prompt` is per input character, or per input token for Gemini, which also bills `pricing.completion` per audio token.

Cost per hour assumes a narrator at about 150 words a minute and 6 characters per word including the space, so an hour is about 54,000 characters. That's an estimate; S2 measures it.

| Model | Elo (rank) | Leaderboard $/1M chars | OpenRouter id and price | About $ per hour |
|---|---|---|---|---|
| Eleven v4 Turbo | 1335 (1) | $40 | `elevenlabs/eleven-v4-turbo`, $0.00004/char | 2.16 |
| Eleven v4 | 1329 (2) | $80 | `elevenlabs/eleven-v4`, $0.00008/char | 4.32 |
| Gemini 3.8 Flash TTS | 1278 (5) | $16.5 | `google/gemini-3.8-flash-tts`, $0.5/1M in tokens + $9/1M audio tokens | 0.89 |
| Gemini 3.8 Flash-Lite TTS | 1251 (8) | $11 | `google/gemini-3.8-flash-lite-tts`, $0.5/1M in tokens + $6/1M audio tokens | 0.59 |
| Fish Audio Drama 3 | 1248 (9) | $15 | `fish-audio/drama-3`, $0.000002/char | 0.81 at the leaderboard rate; 0.11 at OpenRouter's |
| Voxtral 3 TTS | 1218 (12) | $13 | `mistralai/voxtral-mini-tts-3-0`, $0.000013/char | 0.70 |
| Kokoro 82M v1.0 | 1065 (57) | $0.7 | `hexgrad/kokoro-82m`, $0.00000062/char | 0.03 |

Fish Drama 3's OpenRouter price is a seventh of its leaderboard price. We didn't find out why, and its voice is "built for directed voice performances" (bracketed stage directions), which isn't narration. We left it out of the catalog.

Other services we looked at and set aside:

- **OpenAI direct.** `gpt-4o-mini-tts` costs $0.60 per 1M text tokens plus $12 per 1M audio tokens ([OpenAI pricing](https://developers.openai.com/api/docs/pricing)). The [TTS guide](https://developers.openai.com/api/docs/guides/text-to-speech) says `gpt-4o-mini-tts`, `tts-1` and `tts-1-hd` are all deprecated and shut down on 2027-01-06, and points to `gpt-realtime-2.1-mini` over the Realtime API instead.
- **Google Cloud Chirp 3 HD.** 1M free characters a month, then $30 per 1M ([Google pricing](https://cloud.google.com/text-to-speech/pricing)). Elo 1061, below Gemini Flash-Lite at a third of the price, and it would need a new kind of key.
- **Azure HD 2.5** (Elo 1142, $22), **Amazon Polly Generative** (1066, $30), **Cartesia Sonic 3.6** (1289, $49), **Inworld Realtime TTS-2** (1267, $20.8). Each would be a new provider key for readers to get. Their strengths (low latency for voice agents, SSML) aren't what an article narrator needs.

## Free in the browser: Kokoro through kokoro-js

[kokoro-js](https://npmjs.com/package/kokoro-js) runs the same 82M-parameter Kokoro model in the browser through Transformers.js, on WebGPU or WASM, with `fp32`, `q8`, `q4` and `q4f16` builds. The author gave the smallest quantised build as 86 MB in a post that predates the v1.0 model, so the current download size is unverified. It costs nothing and sends no text anywhere. Against that: an 86 MB or larger first download, uneven WebGPU on phones, and the same Elo 1065 voice that OpenRouter sells at about three cents an hour. We deferred it (D-TTS-017).

## Convex limits that shape the cache

From [Convex limits](https://docs.convex.dev/production/state/limits), read 2026-10-22: file storage is 1 GB on Free and Starter (Starter adds $0.033 per GB-month) and 100 GB on Professional. Egress for serving files is 1 GB a month on Free and Starter and 50 GB on Professional, then $0.12–$0.132 per GB. HTTP action responses are capped at 100 MiB. Actions run up to 10 minutes in the Node runtime.

An hour of mono MP3 at 64 kbps is about 29 MB. The real bitrate per model is S2.

## What we didn't check

- How each model sounds on a real article, and whether it reads verbatim (S1).
- Actual bytes and seconds per character for each model (S2), and time to first audio through OpenRouter (S3).
- Whether an installed iPhone PWA keeps playing across clip changes with the screen locked (S4).
- The voice names OpenRouter accepts for ElevenLabs (S5). The Gemini and Kokoro voice lists came from OpenRouter's per-model API pages.
