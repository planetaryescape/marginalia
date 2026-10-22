# 05: Player

The player turns the article's blocks into a queue of clips, keeps the next three ready, plays them through one audio element, moves the highlighter with the voice, and answers the bar, the keyboard, the lock screen and headphones. How each moment should feel is in [02](02-design-concept.md#key-moments); this document is how it works.

## Where it lives

- `apps/web/src/lib/listen-queue.ts`: pure logic. Builds the queue from blocks, decides what to fetch next, and computes the state after each event. No DOM, no React; unit-tested.
- `apps/web/src/lib/use-natural-voice.ts`: the hook that owns the audio element, the fetches, Media Session and follow.
- `apps/web/src/lib/device-voice.ts`: today's Web Speech code from `reading-modes.ts` (`pickVoice` and the body of `useListen`), moved verbatim. It's the fallback (D-TTS-013).
- `useListen` in `lib/reading-modes.ts` keeps its name and return shape (`supported`, `index`, `paused`, `active`, `speakFrom`, `togglePause`, `stop`) so `app/read/[articleId]/page.tsx` and the engagement tracker barely change. It adds `speed`, `setSpeed`, `following`, `follow`, `status`, `error`, `retry` and `mode` (`"natural"` or `"device"`), and delegates to one of the two implementations.
- `components/listen-bar.tsx` gains the states in [02](02-design-concept.md#the-listen-bar).

## The queue

When Listen starts at block `s`:

1. `getParagraphs(getArticleBody(container))` gives the blocks, as today.
2. Each block becomes zero or more items through `spokenText` ([04](04-synthesis-and-cache.md#spoken-text)): none for skipped blocks, several for long ones. Each item is `{ block, part, text }`.
3. If `s` is 0, the title item comes first (Q4).

The queue is built once per start. Article, unit and prose changes stop the player, exactly as today's effect at `reading-modes.ts:171` does, because they make the captured blocks stale.

## Fetching ahead

For each item the player needs a playable object URL. In rung 1, `speech.clip` returns the MP3 bytes, which become a `Blob` directly (D-TTS-022). From rung 3, with the cache:

1. `speech.cachedClip` (query). On a hit, fetch the file URL into a `Blob`.
2. Otherwise `speech.clip` (action), then fetch its URL into a `Blob`.

Either way, then `URL.createObjectURL(blob)`.

The player keeps the playing item plus the next three ready or in flight (D-TTS-008), with at most two requests at once, and never requests an item twice. Clips are held as blobs, not remote URLs, so moving to the next clip never waits on the network, which matters most with the screen locked. Object URLs are revoked once their item is two behind the voice or the player stops.

A voice change in settings while listening drops every ready item after the playing one and fetches them again in the new voice. The playing clip finishes in the old voice.

## Playing

One `HTMLAudioElement`, created on the first Listen and kept for the page's life (D-TTS-009). `preservesPitch = true`. `playbackRate` is the reader's speed.

States:

```
idle ──start──▶ preparing(i) ──clip ready──▶ playing(i) ──ended──▶ gap ──▶ playing(i+1) or preparing(i+1)
                    │                          │  ▲                          (last item) ──▶ finished ──▶ idle
                    │                          ▼  │
                    │                        paused
                    └──fetch failed──▶ failed(i) ──retry──▶ preparing(i)
stop (any state) ──▶ idle
```

- **Gap.** Between blocks the player waits `--listen-gap` (350 ms, 700 ms after a heading), divided by the speed. Parts of one block play with no added gap. When `document.hidden`, the gap is skipped and the next `src` is set inside the `ended` handler, because background timers are throttled; the silence at the ends of each clip is pause enough (S4).
- **Highlight.** `data-speaking` moves to the item's block on `playing`, not when the request starts. While preparing, the block gets `data-speaking-pending` (the 30% wash in [02](02-design-concept.md#visual-language)).
- **Previous.** Restarts the current block if `currentTime` is over 3 s, else goes to the previous block's first item.
- **Next.** Goes to the next block's first item.
- **Pause.** `audio.pause()`; resume continues mid-clip, unlike today's Web Speech pause.
- **Finished.** After the last item: clear the highlight, hide the bar, and scroll the back matter into view if the page was following.

`active` is true from `preparing` to `finished`, so reading time is counted while the first clip is made (D-TTS-019).

## Starting

`toggleListen` keeps its current start point: `position.current ?? position.firstVisible ?? 0`.

Time to first sound is the clip time for the first item (S3). S3 showed Kokoro taking 1.1–2.7 s for a 450–550-character block and about 4 s for 2,000, so the first item of a listen is the starting block's leading sentences, packed up to 300 characters (always at least one sentence), and the rest of that block follows as its next item or items. Every other block is packed normally, up to 2,000 characters (D-TTS-023). That costs a slightly worse cache key on the starting block only, and only from rung 3.

The first `audio.play()` call happens inside the Listen click or keypress, before any await, with a silent data URL, so mobile browsers count the element as user-activated for the rest of the session.

## Follow

`following` starts true. While following, each new block that sits outside the band from 80 px below the top to the top of the bar is scrolled to the reading line (40% down the viewport, the line `useReadingPosition` uses), at most once per block (D-TTS-012).

The player marks its own scrolls (a flag set before `scrollTo` and cleared on `scrollend`, or after 1 s where `scrollend` isn't supported). Any other scroll — wheel, touch, keyboard, scrollbar, paragraph navigation with `j`/`k` — while the voice is active sets `following` to false. **Follow** in the bar scrolls the speaking block to the reading line and sets `following` back to true.

Tapping a paragraph doesn't move the voice. Moving the voice is the bar's job; a tap belongs to selection and the margin.

## Speed

`setSpeed` clamps to 0.8–2.0, sets `playbackRate` at once and saves to `localStorage` under `marginalia.listenSpeed` (D-TTS-010). Reads and writes are wrapped in try/catch, so a blocked storage just means 1× next time. The bar's speed button steps through 1, 1.2, 1.5, 1.75, 2, 0.8. The device voice uses `utterance.rate` from the same value, from the next paragraph.

## Media Session

When the first clip plays:

```ts
navigator.mediaSession.metadata = new MediaMetadata({
  title: article.title,
  artist: article.author ?? new URL(article.url).hostname,
  album: "Marginalia",
  artwork: article.imageUrl ? [{ src: article.imageUrl }] : [],
});
```

Handlers: `play`, `pause`, `stop`, `previoustrack` and `nexttrack` (paragraph), `seekbackward` and `seekforward` (also paragraph, because a paragraph is the unit). `playbackState` follows the state. Handlers are removed and metadata cleared on stop, so the lock screen doesn't keep a dead player.

## Background playback

S4 decides between two shapes:

- **A (expected).** One clip per `src`, switched in `ended`. If iOS keeps playing across switches with the screen locked, this is the design.
- **B (if A stops on iOS).** The player concatenates the ready clips into one MP3 `Blob` (MP3 frames join without re-encoding) and keeps a table of each item's start offset. The highlight follows `timeupdate` against that table, and new clips are appended by rebuilding the blob at the next block boundary. B keeps the same queue, fetch and Media Session code; only the playing step changes.

## Failure

A failed fetch after its retries ([03](03-voices-and-providers.md#errors)) puts the player in `failed(i)`, with the server's sentence from `failureSentence`. Audio stops at the end of the playing clip, not mid-word. The bar shows the sentence, Retry and Stop. Retry re-requests item `i` and continues. The device voice is never started on its own (D-TTS-013).

## No key

`speech.clip` throws `NO_SPEECH_KEY` when the reader has no OpenRouter key. The client learns this before the first fetch, from the same reader-providers query the settings use, so the choice in the bar ("add an OpenRouter key" or "use the device voice") appears at once without a failed request. Choosing the device voice sets `mode: "device"` for the rest of the browser session (`sessionStorage`, try/catch).

## Tests

- `listen-queue` unit tests: building from blocks with skipped and long ones, the title item, previous and next across parts, lead and concurrency decisions, voice change.
- DOM tests with a fake `Audio` and stubbed Convex calls, in the style of `reading-modes.dom.test.tsx`: start from a middle block, highlight moves on `playing`, follow stops on a user scroll and not on our own, speed persists, failure and retry, stop on prose change, object URLs revoked.
- The existing `reading-modes.dom.test.tsx` cases keep passing against `mode: "device"`.
