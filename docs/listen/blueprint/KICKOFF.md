# Kickoff prompt for the first build session

Paste this to the coding agent, in a fresh worktree of `planetaryescape/marginalia` from a freshly fetched `origin/main`:

---

You're replacing Marginalia's robotic Listen voice with natural speech, synthesized through each reader's own OpenRouter key. It was fully planned in an earlier session you didn't see. Everything from that session is in this repo.

1. Read `docs/listen/blueprint/README.md` and every document it lists, in order, then `docs/research/text-to-speech.md`. Read `07-decisions.md` before proposing any change of direction; most alternatives were already considered and rejected there. Read the design blueprint's `02-design-concept.md` too: this feature works inside its concept and tokens.
2. Check the code references in `01-current-state.md` still hold at the current `origin/main`; they were read at `a1c3b87`.
3. Phase 0: ask BK whether A1 and A2 in `06-roadmap.md` are done. Don't create accounts, keys or billing yourself. Run S1, S2 and S3, recording them in `docs/research/spikes/` and `08-open-questions.md` with private content removed. Bring BK the S1 samples to listen to, and ask him Q1.
4. Before building the bar, read `02-design-concept.md` and make an HTML comp of the pill's states in all six themes. Show it to BK and build to the approved comp.
5. Build rung 1, then climb `06-roadmap.md` one rung at a time. A rung ends only when its done-when checks are observed on the deployed app and BK has listened. Commit using `type: description`, BK as the only author.

Ask me about the product questions in `08-open-questions.md` when they come up. Don't guess.

---
