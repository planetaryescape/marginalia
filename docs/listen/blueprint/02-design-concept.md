# 02: Design concept

This document sits inside the design blueprint's concept, "Print, pencil and pen" ([../../design/blueprint/02-design-concept.md](../../design/blueprint/02-design-concept.md)). Its tokens, type and motion durations apply unchanged. What follows is only what listening adds.

## What this is to the person

BK reaches for Listen when he wants the article but can't, or doesn't want to, keep his eyes on it: walking, cooking, eyes tired at the end of the day, or wanting to take in a long piece while doing something with his hands. Sometimes he reads along; often the phone is in his pocket. What he cares about is the voice: whether it sounds like a person reading to him or like a machine reading at him. Today it's the machine, and he called it "a joke" (D-TTS-001).

## The concept: "Read to you"

A good narrator reading the author's words aloud in a quiet room. The narrator adds no voice of their own: no commentary, no asides, no reading out the furniture. On the page, the paragraph being read carries the reader's highlighter, a soft wash that moves down the page with the voice, the way a finger follows a line when someone reads to a child. Everything else stays where it was. Off the page, listening is a small pill at the bottom of the screen and the lock screen of the phone, and nothing else (D-TTS-020).

It fits Marginalia rather than any app because it adds no new hand. The voice belongs to the print. Pencil stays silent, because Marginalia's notes are for when you're looking. The pen (your marks) stays yours. The highlighter, which already means "this is where attention is", is what follows the voice.

## How the whole fits together

**Mental model.** Four nouns: *the article*, *the voice* (who reads it), *where the voice is* (a paragraph), and *your speed*. The reader never thinks in clips, models, caches or keys. Settings say "voice", the bar says where it is, errors talk about the voice.

**The map.**

```
Reader page ──l / Listen──▶ Listen bar (pill, bottom centre; over the phone bar)
     ▲                         │ Follow · ⏮ · ⏯ · ⏭ · 1.2× · ■
     │                         ▼
     └──── Follow ◀──── voice paragraph (highlighter)

Lock screen / headphones / car ──▶ the same play, pause, previous, next

Settings (,) › Listening ──▶ voice list with ▶ samples, speed, (device voice note)
```

The bar exists only while the voice is reading or paused. Settings is where the voice is chosen, never the bar, because choosing a voice is a once-in-a-while act and the bar must stay small.

**Journeys, end to end.**

1. *First listen with a natural voice.* Article → `l` → the voice starts at the paragraph at the reading line in about two seconds → the page follows → lock the phone → keep listening → unlock: the page has followed, the speaking paragraph is in view. What carries over: the paragraph. Nothing restarts.
2. *Choosing a voice.* Settings › Listening → press ▶ beside three voices, each reading the paragraph you were on → pick one → close settings → the next clip uses it. If the voice is reading when the choice changes, the clip playing finishes in the old voice and the next one starts in the new.
3. *Reading ahead, then coming back.* Listening → scroll down to look at a figure → the page stops following, and the bar shows Follow → press Follow → the page eases back to the voice and follows again.
4. *Skipping.* ⏭ or the headphone double-tap → the next paragraph starts at once, because its clip is already made. ⏮ restarts the current paragraph if it's more than three seconds in; otherwise it goes back one, as music players do.
5. *Finishing by ear.* The last paragraph ends → the highlighter fades → the bar slides away → the page scrolls to the back matter, so "Before you go" and the impression are there when he looks at the phone.

**Shared patterns.** Listen reuses what the reader already has: the highlighter for "here", the floating pill (`.reader-float`) for transient controls, the design blueprint's in-place failure line (one sentence, a terracotta dot, Retry) and its pencil line for waiting. Settings › Listening uses the one settings form pattern from the design blueprint's [06](../../design/blueprint/06-sources-and-settings.md).

**Across surfaces.** The same words everywhere: the bar, the lock screen, settings, errors and the reader guide say "voice", "Listen", "Follow" and "device voice". The lock screen shows the article title, the author (or the site's domain) as artist, "Marginalia" as album, and the article image when there is one.

**What the person always knows.** Whether the voice is reading or paused (the dot pulses or holds still), where it is (the highlight, and `¶n/total` in the bar), and whether the page is following it (Follow appears only when it isn't).

## Principles

1. **The voice is the hero; the page stays the page.** Listening adds one highlight and one pill. If a change makes the page itself look different, it's wrong.
2. **No machinery in sight.** Clips, caching and models never appear in the bar. Waiting looks like a breath, not a spinner.
3. **Respond at once.** Pause, skip and speed answer in under 100 ms, because the next clips are already made and speed is free.
4. **The reader leads, the page follows.** Auto-scroll yields the moment the reader scrolls (D-TTS-012).
5. **Say it once, plainly.** A failure is one sentence where the voice was, with what to do. Never a stack of toasts, never a silent change of voice (D-TTS-013).
6. **Hear before you choose.** Every voice in settings plays a sample from the open article. A list of names alone is a guess.

## Key moments

| Moment | What the person should feel | What makes it land |
|---|---|---|
| Pressing Listen | "It starts where I am." | The paragraph at the reading line takes a faint highlighter wash at once (30% instead of 60%). The pill rises 12 px over `--motion-quick`. Its dot breathes slowly while the first clip is made. When the voice starts, the wash deepens to 60% over 300 ms, in time with the first word. |
| The voice moving on | "Someone is reading to me." | The highlighter cross-fades from one paragraph to the next over 300 ms as the new clip starts, not before. A natural pause of about 350 ms sits between paragraphs, longer after a heading. |
| Scrolling away | "I can look around without losing my place." | Following stops at the first scroll of your own. **Follow** fades into the pill's left end. The highlight stays where the voice is. |
| Follow | "Back with the voice." | The page eases the speaking paragraph to 40% down the viewport (the reading line) over `--motion-move`, and Follow fades out. |
| Speed | "Exactly the pace I want." | Tapping the speed steps 1× → 1.2× → 1.5× → 1.75× → 2× → 0.8× → 1×, applied instantly with pitch preserved. The slider in settings sets any value in 0.05 steps. |
| Locked phone | "It just keeps going." | Lock screen and Control Centre show the title, source and image, with play, pause and previous/next paragraph. AirPods and car buttons do the same. |
| Waiting on a slow clip | "It's thinking; it'll come." | The dot keeps breathing. If the wait passes 4 seconds, a pencil line writes under the pill: "Still preparing this paragraph." Nothing else moves. |
| Failure | "I know what happened and what to do." | The pill becomes one sentence with a terracotta dot: "The voice stopped: OpenRouter didn't answer." Retry, and Stop. The highlight holds on the paragraph that failed. |
| No key | "I know the one step." | The pill offers two choices: "Listen with a natural voice: add an OpenRouter key" (opens Your account) and "Use the device voice". The second is remembered for the session. |
| The end | "Done. That was worth it." | The last highlight fades over 600 ms, the pill sinks away, and the page eases to the back matter, the same finish as reading. |

## Visual language

Inherits every token from the design blueprint. Listen adds:

| Token | Value | Use |
|---|---|---|
| `--listen-wash` | `--highlighter` at 60% (today's value) | The speaking paragraph |
| `--listen-wash-pending` | `--highlighter` at 30% (D-TTS-025) | The paragraph waiting for its first clip |
| `--listen-gap` | 350 ms; 700 ms after a heading | Silence between clips. Shorter at higher speeds (divided by `playbackRate`) |

The pill keeps `.reader-float` and today's shape: full radius, `--type-meta` for "Listening" and `--type-label` mono for `¶n/total` and the speed. Icons are Lucide at 14 px inside 32 px targets (44 px on touch). The voice name doesn't appear in the pill, because the voice is chosen once, not watched.

## Motion

Motion shows where the voice is and nothing else. The highlighter's cross-fade (300 ms, `ease-out`) is the main motion. The pill rises and sinks 12 px over `--motion-quick`. The breathing dot runs a 1.6 s opacity cycle between 35% and 100%. Auto-scroll uses smooth scrolling and moves at most once per clip.

With `prefers-reduced-motion`, the highlight swaps without a fade, the pill appears without movement, the dot holds still at 60% while waiting, and auto-scroll jumps instead of easing.

## Hierarchy and restraint

On the page, the eye goes to the text, then to the highlighted paragraph. The pill is third: small, low-contrast and out of the reading column.

In the pill, play/pause is primary. Previous, next and speed are secondary. Stop is last and quieter. Follow appears only when it means something. Left out on purpose:

- A scrubber or a time remaining. Paragraphs are the unit, and the reading map already shows progress.
- The voice name and a voice switcher. That's settings' job.
- Volume. The device has it.
- Any mention of cost in the bar. Cost is shown once, where the voice is chosen (D-TTS-014).

## Taste references

BK named none in this session, so these are proposals:

- **Readwise Reader's text-to-speech.** BK imports from Reader, so he knows it. Its docs describe "top-tier AI voices", and its player has a "jump to current position" button that returns the page to where the audio is. We take that button as Follow. We don't take word-by-word highlighting, if a reference offers it (D-TTS-006): it turns listening into watching.
- **Overcast.** Speed that sounds natural at 1.5× and a player with very few controls. We take the restraint and the speed steps.
- **A good audiobook narrator.** The voice disappears behind the text. This is the bar for choosing the default voice in S1.

## Screens

### The Listen bar

```
Playing, following:
        ╭──────────────────────────────────────────────╮
        │  ● Listening  ¶12/48    ⏮   ⏸   ⏭   1.2×   ■ │
        ╰──────────────────────────────────────────────╯

Playing, reader scrolled away:
        ╭────────────────────────────────────────────────────────╮
        │  ↧ Follow  │  ● ¶12/48    ⏮   ⏸   ⏭   1.2×   ■        │
        ╰────────────────────────────────────────────────────────╯

Failed:
        ╭──────────────────────────────────────────────────────────╮
        │  ● The voice stopped: OpenRouter didn't answer.  Retry  ■ │
        ╰──────────────────────────────────────────────────────────╯

No OpenRouter key:
        ╭───────────────────────────────────────────────────────────────╮
        │  Natural voice: add an OpenRouter key   ·   Use device voice  ✕ │
        ╰───────────────────────────────────────────────────────────────╯
```

The eye lands on the dot and the pause button. The pill sits 24 px above the bottom edge on desktop, and directly above the phone's bottom bar on phones. It never covers the line being read: if the speaking paragraph would end up behind it, auto-scroll places it higher.

### Settings › Listening

```
Listening
  Voice
    ◉ Kokoro · Heart                  warm, clear      about $0.03 an hour   ▶
    ○ Kokoro · George                 low, steady      about $0.03 an hour   ▶
    ○ Gemini Flash-Lite · Charon      calm, rich       about $0.59 an hour   ▶
    ○ Gemini Flash · Charon           richer still     about $0.89 an hour   ▶
    ○ Eleven v4 Turbo · (S5)          the best         about $2.16 an hour   ▶
  Speed   0.8× ───●────────── 2×   1.2×
  Uses your OpenRouter key. Clips are kept 30 days so replays are free.
```

The voices, their one-word characters and the rates are placeholders until S1 and S2. ▶ plays the open article's current paragraph in that voice, or a fixed sentence when no article is open. A playing sample shows ■ and stops when another sample starts. The list is a radio group, so arrow keys move and Space plays the focused sample.

## The design gate

A rung that touches Listen is done when, on the deployed app:

1. A comp or HTML prototype of its moments was approved by BK before building (the pill states and settings).
2. Screenshots of the pill in every state, in all six themes, at desktop and phone widths, read against this document.
3. BK listens to a real article for five minutes on his phone with the screen locked, and the moments in the table are checked by doing them: starting, scrolling away and Follow, speed, skip from headphones, a forced failure, the end.
4. Journeys 1–5 are walked end to end without a break in wording or state.
5. With reduced motion on, every moment still reads.
