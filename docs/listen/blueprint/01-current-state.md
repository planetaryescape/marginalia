# 01: Current state

Read at origin/main `a1c3b87` (2026-10-20). Paths are under `apps/web/src/` unless they start with `packages/`.

## Listen is the Web Speech API with a name-pattern voice picker

`lib/reading-modes.ts:81` `pickVoice()` filters `speechSynthesis.getVoices()` by the page language, then takes the first voice whose name matches `natural|premium|enhanced`, then `google|samantha|daniel`, then the default. What the reader hears therefore depends on the operating system and browser, and on most it's a robotic voice. Enhanced voices on macOS and iOS exist only if the reader downloaded them in system settings.

`useListen` (`lib/reading-modes.ts:98`) speaks one `SpeechSynthesisUtterance` per paragraph from `getParagraphs()`, chaining on `onend`. It marks the speaking paragraph `data-speaking` and scrolls it to centre whenever it sits within 80 px of the viewport edge (`:146`). A session counter discards completions from a cancelled run. A change to article ID, book part or prose stops speech (`:171`).

What that design can't do:

- **Lock screen.** The Web Speech API has no Media Session integration, so there are no lock-screen or headphone controls. Whether speech survives a locked screen depends on the browser, and `docs/mobile-and-pwa.md:62` records that speech playback and background behaviour were never checked on a physical phone.
- **Speed.** There's no rate control, and changing `utterance.rate` would only apply from the next paragraph.
- **Reading ahead.** It scrolls back to the voice even after the reader scrolled away on purpose.
- **Cleaning the text.** `paragraphText(el)` is spoken as is, including footnote markers, URLs and `pre` blocks.

## The bar and the page

`components/listen-bar.tsx` is a fixed pill at the bottom centre: a pulsing dot, "Listening", `¶n/total`, and previous, pause, next and stop buttons. It slides up 12 px with framer-motion.

`app/read/[articleId]/page.tsx:645` `toggleListen` starts from `position.current ?? position.firstVisible ?? 0`, and shows a six-second notice when speech isn't supported (`:639`). The `l` shortcut and the phone bar's Listen button call it (`:704`, `:1061`). `ListenBar` is mounted at `:1418`.

`app/globals.css:961` paints `[data-speaking]` with the reader's highlighter at 60% and a 6 px spread. Focus mode keeps the speaking paragraph lit (`:957`).

## Engagement

`lib/use-engagement-tracker.ts` passes `listening` to `ReadingClock.speech()` (`lib/reading-clock.ts:136`), so listening counts as active reading. The new player must report the same flag (D-TTS-019).

## The backend it will use

- `packages/backend/convex/lib/providers.ts` defines `PROVIDERS = ["openrouter", "openai", "anthropic"]` and a short `MODEL_CATALOG` for text models, with the comment "Keep this short and current." The speech catalog follows that pattern (D-TTS-004).
- `packages/backend/convex/lib/router.ts` `loadReaderAI` decrypts the reader's keys inside the action that makes the call. A request never falls back to another reader's key.
- `packages/backend/convex/limits.ts` `READER_LIMITS` holds per-reader fixed-window budgets (`ai`: 30 a minute).
- Convex file storage is already used for PDF imports (`documentImports.ts`, `account.ts:416` deletes stored files with the account).
- `packages/backend/convex/crons.ts` runs daily jobs; clip retention joins them.

## Docs that describe Listen

`docs/reader-guide.md:29` ("Listen uses the browser's speech synthesis; voices and availability depend on your device"), `PRODUCT.md:27`, `docs/limitations.md:23` and `docs/mobile-and-pwa.md:62`. Each changes in the rung that changes the behaviour it describes ([06](06-roadmap.md)).
