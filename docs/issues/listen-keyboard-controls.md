# Listen is hard to control from the keyboard, and Previous gives no sign it worked

Status: done 2026-10-28. Decision D-TTS-027 in `docs/listen/blueprint/07-decisions.md`. The pill follows the toolbar in Tab order; Space, `[` and `]` control Listen while it's on; Media Session handlers took the media keys; the pill says Paused; Previous replays the wash when it restarts a paragraph.

Found in the 2026-10-28 QA run on reader.bhekani.com (frontend `06cae83`), in the keyboard-only charter. It's usability friction, not a broken requirement.

## What happens

- **Controls come last in Tab order.** `ListenBar` is rendered after the article and its back matter (`apps/web/src/app/read/[articleId]/page.tsx`, the `<ListenBar` near the end of the page), so it is last in Tab order. From the article, a keyboard reader passed more than 90 stops (header, every link and note, reflection, rating, Done, Mark unread) before reaching Previous. Passing the back matter scrolls the page to the end, away from the paragraph being read.
- **Only `l` has a key.** It starts and stops Listen; nothing pauses, skips or goes back. There is no Media Session either, so AirPods and keyboard media keys don't control Listen. Rung 2 of `docs/listen/blueprint/06-roadmap.md` plans the lock screen and headphone controls.
- **Previous looks like it does nothing.** More than 3 seconds into a paragraph, Previous restarts it, as `docs/listen/blueprint/05-player.md` specifies. The highlight doesn't change, and two QA charters read it as broken. Within 3 seconds it does go back (¶7 → ¶6).
- **Paused still says Listening.** Only the dot changes, as `02-design-concept.md` intends, and that's easy to miss.

## What would fix it

- Give the reader keys while Listen is active, for example Space to pause and resume, and `[` / `]` for previous and next, checked against the reader's existing keys (`j k o r v u n l ,` and Backspace). List them in the shortcut help under Reading.
- Do Media Session as planned in rung 2, so headphone buttons work.
- Show that Previous restarted, for example by replaying the highlight's cross-fade on the same paragraph.

## Open questions

- ~~Should Space pause Listen? In the reader it scrolls the page today.~~ Yes while Listen is on, and scrolling otherwise (D-TTS-027). BK confirmed on 2026-10-28.
