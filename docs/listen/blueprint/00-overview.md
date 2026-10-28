# 00: Overview

## What this is

Listen reads the open article aloud. Today it uses the browser's speech engine, which on most devices sounds robotic (D-TTS-001). This work replaces that voice with a natural one, synthesized by a current TTS model through the reader's own OpenRouter key (D-TTS-002), and rebuilds playback so it works the way listening to an article should: it starts where you are, keeps going with the phone locked, runs at your speed, and costs pennies.

It touches four parts:

- **Settings › Listening:** choose a voice by hearing it, with its cost per hour ([03](03-voices-and-providers.md)).
- **The speech action:** turns one block of text into an MP3 clip, and from rung 3 caches it ([04](04-synthesis-and-cache.md)).
- **The player:** plays clips in order, follows the voice on the page, and answers lock-screen and headphone controls ([05](05-player.md)).
- **The Listen bar:** the pill that appears at the bottom of the page while the voice is reading ([02](02-design-concept.md), [05](05-player.md)).

The article stays the record. A clip is a cache of the article's words in a voice, and can always be made again.

## Who it's for

The first user is BK, who wants to listen to an article instead of reading it, on a walk or with his eyes tired. Then every invited reader with an OpenRouter key. A reader without one keeps the device voice, named as such (D-TTS-013).

## The listening loop

1. In an article, press Listen (or `l`). The voice starts at the paragraph at the reading line within about two seconds.
2. The speaking paragraph carries the highlighter. The page scrolls with the voice until you scroll yourself.
3. Lock the phone or put it in a pocket. The voice carries on; the lock screen shows the article and its controls.
4. Skip a paragraph, change speed, pause from headphones. Each responds at once.
5. The voice reaches the end and stops. The back matter is there when you look ("Before you go", the impression).

## What it should feel like

Like being read to by a good narrator. You stop noticing the voice and hear the author. The page is quiet: one soft highlight that moves with the voice and a small pill at the bottom. Nothing about listening should make you think about the machinery, its cost or its waits.

## Principles

1. **The voice is the author's.** The narrator reads the print and nothing else. Margin notes, chrome and code stay silent (D-TTS-011), because a voice that interrupts the author breaks listening.
2. **Start where I am.** Listen begins at the reading line, not the top, because that's where the reader's attention already is.
3. **Never surprise me with the old voice.** A failure says what happened. It never falls back to the device voice on its own (D-TTS-013).
4. **The reader's key, the reader's choice.** Every clip is paid for by the reader, so the cost of each voice is in plain sight (D-TTS-002, D-TTS-014).
5. **Pay for what you hear.** The default voice costs about 3 cents an hour (D-TTS-021). Synthesis stays a few clips ahead of the voice and never runs off to the end (D-TTS-008). Once pricier voices can be chosen, a clip heard once is never paid for again (D-TTS-007, D-TTS-022).
6. **Listening is reading.** It counts as reading time and leads to the same finish as reading does (D-TTS-019).

## Scope

- Kokoro as everyone's default voice (D-TTS-021), then four curated OpenRouter models (D-TTS-004), chosen in Settings and previewed by ear.
- Block-by-block synthesis (D-TTS-006), cached in Convex file storage from rung 3 (D-TTS-007, D-TTS-022).
- One audio element with Media Session controls on desktop, Android and iPhone, installed or in the browser (D-TTS-009).
- Speed from 0.8× to 2× (D-TTS-010).
- Follow-along: highlight, auto-scroll and Follow (D-TTS-012).
- Articles and book parts, anywhere today's Listen works.

## Non-goals

- A listening queue across articles, podcast feeds, offline downloads (D-TTS-018). Deferred, not rejected.
- Voice cloning or custom voices (D-TTS-018).
- Word-by-word highlighting (D-TTS-006, D-TTS-018).
- Reading Marginalia's notes or answers aloud (D-TTS-011).
- OpenAI-direct speech (D-TTS-005) and in-browser models (D-TTS-017). Deferred, not rejected.

Don't expand this into "everything audio" without a separate validated problem.

## Glossary

| Term | Meaning |
|---|---|
| Block | One numbered paragraph of the article (`[data-para]`): a paragraph, list item, heading, quote or caption |
| Clip | The MP3 of one block, or of one part of a long block, in one voice |
| Voice | A catalog model plus one of its named voices, such as Kokoro · Heart |
| Device voice | The browser's Web Speech API voice, today's Listen |
| Lead | How many clips are synthesized ahead of the one playing (three) |
