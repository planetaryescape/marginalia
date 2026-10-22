# Marginalia Listen: feature blueprint

> Listen reads the open article aloud in a natural voice, synthesized paragraph by paragraph through the reader's own OpenRouter key and played through one audio element with lock-screen controls.

Planned on 2026-10-22 from one request by BK: "the text to speech on this app is a joke, it's some wacky robotic voice. there's lots of great and cheap and even free sometimes services that can do some brilliant text to speech when i want to listen to an article. Do some research and create a /blueprint for a more sensible TTS please". He delegated the design, so most decisions are ours and marked for him to confirm where they're his call. The current code was read at origin/main `a1c3b87`. This blueprint is for a coding agent that never saw the session, so it carries the reasoning as well as the result.

## Reading order

| # | Document | What it covers |
|---|---|---|
| 00 | [Overview](00-overview.md) | What changes, the listening loop, how it should feel, principles, scope, non-goals |
| 01 | [Current state](01-current-state.md) | Today's Web Speech Listen and the backend it will use, with code references at `a1c3b87` |
| 02 | [Design concept](02-design-concept.md) | "Read to you": journeys, key moments, the bar, settings, motion, the design gate |
| 03 | [Voices and providers](03-voices-and-providers.md) | The speech catalog, the OpenRouter request, errors, Settings › Listening, cost |
| 04 | [Synthesis and cache](04-synthesis-and-cache.md) | Spoken text, the `speechClips` table, the action, budget and retention |
| 05 | [Player](05-player.md) | Queue, fetching ahead, playback states, Follow, speed, Media Session, background playback |
| 06 | [Roadmap](06-roadmap.md) | Phase 0 and three rungs, each deployed |
| 07 | [Decisions](07-decisions.md) | Every decision with its attribution and rejected options |
| 08 | [Open questions](08-open-questions.md) | Spikes and BK's product questions |
| — | [Kickoff](KICKOFF.md) | The prompt for the first build session |

Research behind these decisions:

- [../../research/text-to-speech.md](../../research/text-to-speech.md): what natural voices cost and how they rank, what OpenRouter's speech endpoint does, why OpenAI-direct and in-browser options were set aside, and Convex's storage limits.

Related: the design blueprint ([../../design/blueprint/README.md](../../design/blueprint/README.md)), whose concept, tokens and gate this feature works inside.

## Summary

- **Voice:** a current TTS model replaces the device voice (D-TTS-001). The default is Kokoro at about $0.03 an hour, BK's call (D-TTS-021).
- **Key:** the reader's own OpenRouter key; no new account, no app-paid key (D-TTS-002). No OpenAI-direct speech, whose models shut down 2027-01-06 (D-TTS-005).
- **Catalog:** four models, two or three voices each, chosen by hearing a sample, each with its cost per hour (D-TTS-004, D-TTS-014).
- **Unit:** one clip per paragraph, long ones split at sentences (D-TTS-006), at most three clips ahead (D-TTS-008). No cache in rung 1; from rung 3, cached per reader, article, voice and text for 30 days after last play (D-TTS-007, D-TTS-022).
- **Playback:** one audio element with Media Session, so it carries on with the phone locked; speed 0.8–2× at no cost (D-TTS-009, D-TTS-010).
- **Page:** the highlighter follows the voice until the reader scrolls, then Follow brings it back (D-TTS-012). The voice reads the print only (D-TTS-011).
- **Concept:** "Read to you", inside "Print, pencil and pen" (D-TTS-020, Q2).
- **Dropped or deferred:** in-browser Kokoro (D-TTS-017), listening queues, offline, cloning, word highlighting (D-TTS-018). The device voice stays only as a named fallback (D-TTS-013).

## Rules for coding agents

1. **Listening is the deliverable.** A rung is done when BK has listened on the deployed app and it passes the design gate in [02](02-design-concept.md#the-design-gate), not when the tests pass.
2. **Run the spikes first.** S1–S3 (the Kokoro parts) gate rung 1, S4 rung 2, S5 and the rest of S1–S2 rung 3 ([08](08-open-questions.md)).
3. **Never switch to the device voice on your own.** That's the voice BK called a joke (D-TTS-013).
4. **Keep the catalog short.** Add or change a voice in `speechVoices.ts` only, with a decision entry.
5. **Keep personal content out.** The repo is public. Spike samples, article text and account details stay out of commits.
6. **Update the decision log.** If you change a decision, add an entry to [07](07-decisions.md) with the reason.
7. **Follow the house rules.** Deploy and verify per `docs/operations.md`, with a snapshot and BK's approval before any backend deploy. Commits use `type: description`, with BK as the only author.
