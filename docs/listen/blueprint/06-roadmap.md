# 06: Roadmap

## Build philosophy

- Skateboard → scooter → bicycle. Each rung is a deployed Listen that lets BK do something new from start to finish, sized to one working session.
- Every rung ships to the live app through the deploy in `docs/operations.md`, with a snapshot and BK's approval before any backend deploy.
- At most two new unknowns per rung. A rung that needs a third is split.
- Stop after any rung and Listen still works, better than before.
- A rung added later gets a letter (2b), so cited numbers keep their meaning.
- "Tests pass" is required but never counts as done on its own, and nor does "it behaves as specified". A rung is done when it also feels the way [02](02-design-concept.md) says, judged by listening.

## Phase 0: accounts and spikes (before product code)

| # | Action | Needed by |
|---|---|---|
| A1 | BK confirms his OpenRouter key has credit for the spikes (a few dollars covers all of them) | S1 |
| A2 | BK sets aside 10 minutes to listen to the Kokoro samples from S1 and pick the default voice (D-TTS-021) | Rung 1 |

Spikes S1, S2 and S3 gate rung 1. S4 gates rung 2. S5 gates rung 3 ([08](08-open-questions.md)). The spike scripts call OpenRouter directly with `curl` or a short Bun script, read the key with `op read`, and save samples outside the repo, because the repo is public.

## Rung 1: Skateboard: "I press Listen and a person reads me the article"

**Previously:** a device voice, often robotic. **Now:** Kokoro, in the voice BK picked, starting where he is reading, following paragraph by paragraph, for about 3 cents an hour.

**Promise:** "I opened an article, pressed L, and it sounded like a narrator, not a machine."

**Build:**

- `speech.clip` returning MP3 bytes, with no cache, and the `speech` budget ([04](04-synthesis-and-cache.md#rung-1-returns-the-audio-rung-3-adds-the-cache); D-TTS-006, D-TTS-016, D-TTS-022).
- The catalog with the Kokoro voice from S1 only, and the request with `data_collection: "deny"` ([03](03-voices-and-providers.md); D-TTS-015, D-TTS-021).
- `spoken-text.ts` with its fixtures (D-TTS-011).
- `listen-queue.ts` and `use-natural-voice.ts`: queue, lead of three, one audio element, highlight, previous, next, pause, stop, finish, failure and Retry ([05](05-player.md); D-TTS-008, D-TTS-009).
- `device-voice.ts` moved verbatim, and the no-key choice in the bar (D-TTS-013).
- `docs/reader-guide.md`, `PRODUCT.md` and `docs/limitations.md` updated to describe natural voices and the OpenRouter key.

**Design:** the pill's preparing, playing, paused, failed and no-key states, and the pending and speaking washes ([02](02-design-concept.md#the-listen-bar)). Comp them in all six themes and get BK's approval first. Starting and the voice moving on are the moments to get right here.

**New unknowns:** OpenRouter's speech endpoint in production (settled by S1–S3); returning audio bytes from a Convex action to the browser.

**Demo:** open a long public article on desktop, scroll to the middle, press `l`. The voice starts at the reading-line paragraph within the S3 target. Skip forward twice, back once, pause and resume mid-sentence. Stop.

**Done when:**

- On the deployed app, the demo runs on desktop Chrome and on BK's phone with the screen on.
- OpenRouter's activity log shows one Kokoro request per paragraph heard plus the lead of three, and none beyond it after Stop.
- A forced failure (an invalid key in a test account) shows one sentence and Retry, and never the device voice.
- `bun run typecheck` and `bun run test` pass.
- The design gate passes ([02](02-design-concept.md#the-design-gate)), items 1, 2, 4 and 5.

**Left out:** lock screen, speed, Follow, choosing a voice.

## Rung 2: Scooter: "I lock my phone and keep listening"

**Previously:** listening only with the screen on, at one speed, with the page pulling BK back. **Now:** lock-screen and headphone controls, speed, and Follow.

**Promise:** "I put my phone in my pocket, went for a walk at 1.5×, and skipped a paragraph from my AirPods."

**Build:**

- Media Session metadata and handlers ([05](05-player.md#media-session); D-TTS-009).
- Shape A or B from S4 ([05](05-player.md#background-playback)).
- Speed: `setSpeed`, the bar's speed button and storage (D-TTS-010).
- Follow: the own-scroll flag, `following`, and Follow in the bar (D-TTS-012).
- `docs/mobile-and-pwa.md` updated with what S4 found.

**Design:** the Follow state of the pill, the speed button, and the lock-screen metadata. The moments here are scrolling away, Follow, speed and the locked phone.

**New unknowns:** iOS background playback (S4); Media Session behaviour across iOS and Android.

**Demo:** on BK's iPhone in the installed PWA, start Listen, set 1.5×, lock the phone, walk for five minutes. Skip forward from the lock screen and with an AirPods tap. Unlock: the page has followed. Scroll up to reread a heading, press Follow.

**Done when:**

- The demo runs on BK's iPhone in the installed PWA and in Safari, and on an Android phone in Chrome.
- The full design gate passes, including item 3: five minutes listened with the screen locked.

**Left out:** choosing a voice.

## Rung 3: Bicycle: "I choose the voice I like by hearing it"

**Previously:** Kokoro for everyone. **Now:** Settings › Listening with the curated catalog, samples and cost per hour, and a clip cache so the pricier voices are paid for once.

**Promise:** "I tried three voices on the paragraph I was reading and picked the one I'd happily listen to for an hour."

**Build:**

- The full catalog with S1's voices and S2's rates (D-TTS-004, D-TTS-014).
- The clip cache: `speechClips`, `speech.cachedClip`, the URL-returning `speech.clip`, the retention job, and deletion with articles and accounts ([04](04-synthesis-and-cache.md); D-TTS-007, D-TTS-022). Ask BK Q5 first.
- `userSettings.speechVoice` and its mutation, validated against the catalog.
- Settings › Listening: voice radio list with samples, speed slider, note ([03](03-voices-and-providers.md#settings--listening)).
- A voice change mid-listen ([05](05-player.md#fetching-ahead)).
- Models that lose all providers under `data_collection: "deny"` shown as unavailable (S5, D-TTS-015).

**Design:** the Listening section in the settings form pattern; the sample's play and stop. The moment to get right is hearing a voice before choosing it.

**New unknowns:** ElevenLabs voice names through OpenRouter (S5); clip storage and serving from Convex.

**Demo:** open settings in an article, play four samples, choose Gemini Flash-Lite, close settings while listening: the next paragraph is in the new voice. Replay a paragraph: no new OpenRouter request. Open settings on a phone and do the same with the keyboard closed.

**Done when:**

- The demo runs on the deployed app on desktop and phone.
- The chosen voice follows BK from desktop to phone.
- The design gate passes for the settings section.

**Left out:** everything in "After the bicycle".

## After the bicycle (not planned yet)

Each needs its own validated problem first (D-TTS-018): a listening queue that moves on to the next article; downloading an article's clips to listen offline; in-browser Kokoro for readers without a key or for offline use (D-TTS-017); an OpenAI successor on the plain speech endpoint (D-TTS-005); word-level timing if a provider returns it through OpenRouter.
