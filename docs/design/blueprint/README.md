# Marginalia: design blueprint

> The design layer for an app whose features already work. It sets a concept ("Print, pencil and pen"), a map of three rooms, the journeys, and each screen's look and feel. It ships in rungs to the live reader.

Marginalia was built feature by feature, and on 2026-10-16 BK judged that the design had never been considered (D-DES-001). This blueprint was written that day from four sources: his request, his remarks while using the app on 2026-10-14 and 2026-10-15, the requests recorded in `docs/decisions.md`, and an audit of the live app at origin/main `bc23f5e`. No design conversation preceded it, so the concept and most screen decisions are proposals that BK must confirm ([09](09-open-questions.md)). It's meant for a coding agent that saw none of this, so it carries the reasoning as well as the result.

## Reading order

| # | Document | What it covers |
|---|---|---|
| 00 | [Overview](00-overview.md) | What this work is, how it should feel, principles, scope, non-goals |
| 01 | [Current state](01-current-state.md) | The audit: what works and what's wrong, with code references at `bc23f5e` |
| 02 | [Design concept](02-design-concept.md) | The concept, the map, journeys, shared patterns, key moments, tokens, motion, the design gate |
| 03 | [Reader](03-reader.md) | The page, margin sidenotes, toolbar, front and back matter, finishing, phone |
| 04 | [Desk](04-desk.md) | Hierarchy, time choices, the pick on the desk, Continue, Up next, empty and error |
| 05 | [Library, Notes and Your week](05-library-notes-week.md) | The two rooms, shelves, the commonplace book |
| 06 | [Sources and settings](06-sources-and-settings.md) | The avatar menu and one form pattern for Sources, Account and Readers |
| 07 | [Roadmap](07-roadmap.md) | Seven rungs, each deployed and gated on design |
| 08 | [Decisions](08-decisions.md) | Every decision with its attribution and rejected options |
| 09 | [Open questions](09-open-questions.md) | Spikes and BK's product questions |
| — | [Kickoff](KICKOFF.md) | The prompt for the first build session |

Related docs outside this folder: [apps/web/DESIGN.md](../../../apps/web/DESIGN.md) (the current shipped system, to be rewritten in rung 7), [docs/decisions.md](../../decisions.md), [docs/reader-guide.md](../../reader-guide.md) and [docs/operations.md](../../operations.md) (how to deploy).

## Summary

- **Concept:** "Print, pencil and pen". The author speaks in print, Marginalia in pencil in the margin, and the reader in their own pen colour (D-DES-018, Q1).
- **Margin:** on wide screens, margin notes are quiet sidenotes beside their line, without a click. On phones they unfold in the flow (D-DES-019, D-DES-026).
- **Colour:** the pen colour belongs to the reader's marks only. Chrome is ink (D-DES-020).
- **Desk:** one question, one slot, four numerals, search and three rows. Choosing a time answers on the desk (D-DES-002, D-DES-028).
- **Map:** three rooms (Desk, Library, Notes). Settings sit behind the avatar menu (D-DES-024, D-DES-025).
- **Restraint:** keycaps hidden until asked, GitHub and maintenance actions off the main surfaces, rules instead of boxes (D-DES-021, D-DES-022, D-DES-023).
- **Kept:** themes, type families, the shared reader package and annotation colours (D-DES-017). Behaviour is unchanged except for the named exceptions (D-DES-015).
- **Dropped:** a functional rewrite, and new features alongside the redesign (D-DES-001).

## Rules for coding agents

1. **Design is the deliverable.** A rung isn't done when it behaves. It's done when it passes the design gate in [02](02-design-concept.md#the-design-gate), on the deployed app, in all six themes, at desktop and phone widths (D-DES-027).
2. **Comp before code.** Make a comp or HTML prototype of the rung's screens and moments and get BK's approval first. Brief any worker with [02](02-design-concept.md) and the comp, not only the behaviour.
3. **Colour belongs to a hand.** Never use `--pen` for chrome. If you're unsure where something goes or how loud it is, ask whose hand it belongs to (D-DES-020).
4. **Run the spikes first.** S1–S4 gate specific rungs ([09](09-open-questions.md)).
5. **Don't change behaviour silently.** Only the exceptions named in D-DES-015 change behaviour. Anything else needs a new decision entry.
6. **Keep personal content out.** The repo is public. No screenshots, library content or account details in commits (D-DES-016).
7. **Update the decision log.** If you change a decision, add an entry to [08](08-decisions.md) with the reason.
8. **Follow the house rules.** Deploy and verify per `docs/operations.md`, with a snapshot and BK's approval before any backend deploy. Commits use `type: description`, with BK as the only author.
