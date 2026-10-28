# Listen gets keyboard controls and a choice of voice

Released 2026-10-28 to https://reader.bhekani.com. The backend runs `6462ce4` on `dev:stoic-hare-718`, deployed at 18:49. The frontend runs Vercel deployment `dpl_4qAfVwN5oH1Yc1GaBBqNr3UA8yTb`, built from `6462ce4`. The keyboard change (#70, `1447755`) went out first, as frontend `dpl_42muVbxP47BmApneVpDGuAE69TtU`.

## What changed for readers

- **Keyboard and media keys (#70).** While Listen is on, Space pauses and resumes, and `[` and `]` go to the previous and next paragraph; Space scrolls when Listen is off. Media keys and headphone buttons reach the same controls through Media Session. The pill says **Paused** when paused, Previous that restarts a paragraph replays its highlight, and the pill follows the toolbar in Tab order. Decision D-TTS-027.
- **Choosing a voice (#71).** Reading settings have a **Listen** tab with the eight Kokoro voices. Play, or Space on a voice, reads the start of the paragraph being heard. The choice is saved to the account; a clip already playing finishes in the old voice and every clip not yet heard uses the new one. A sample pauses Listen until the tab closes. Rung 1b of [the Listen blueprint](../listen/blueprint/06-roadmap.md), decision D-TTS-028.

## Rollback

- The snapshot before the backend update is `marginalia-before-voice-choice.zip` (46.8 MB, with file storage and auth components, owner-only, ZIP-validated).
- The schema change is one optional field, `userSettings.speechVoice`. Older code ignores it, so reverting the code needs no data restore.
- The previous frontend is `dpl_BXu56huMSRxk9kbSxTgDGogzoZXD` (`5a3c2bd`), and before voice choice `dpl_42muVbxP47BmApneVpDGuAE69TtU` (`1447755`).

## Live checks

- **Keyboard, 16:10–16:12, in Dia on an 81-paragraph article.** `l` started at ¶18. Space showed Paused without scrolling and resumed. `]` moved on, `[` five seconds into a paragraph kept its number, and `[` again within a second went back one. `l` stopped it, then Space scrolled the page. No leave-site prompt. The live stylesheet carries the restart animation; a still capture can't show the fade itself.
- **Voice choice:** `userSettings:getSpeechVoice` and `userSettings:setSpeechVoice` are listed by `convex function-spec` on the live deployment, and the reader page's live bundle contains the Listen tab.

- **Voice choice, 22:23–22:25, in Dia on an 83-paragraph article.** The Listen tab listed all eight voices. Emma's sample turned its button to Stop within a second and the pill said Paused; George's sample followed. Choosing Emma (`setSpeechVoice` at 22:23:51) and closing settings returned the pill to Listening. The `Speech clip` log lines show `af_heart` for the clips before, `bf_emma` and `bm_george` for the two samples (271 characters each), then `bf_emma` for every clip after the change, including the clips ahead asked for again. Heart was chosen again at 22:25:03. Earlier attempts at 18:56 and 19:00 couldn't start, because Computer Use found no Dia window it could drive.

## Review

Voice choice went through seven rounds of independent cross-model review (gpt-6.1-sol, max effort; reports kept outside the repo). Every finding was fixed with a regression test that fails without the fix, except one left as is in D-TTS-028: switching A, B, then A asks again for A's clips ahead, about a hundredth of a cent each.
