# Historical kickoff prompt for the first build session

Review identity clarification: upstream auth [#100](https://github.com/planetaryescape/marginalia/pull/100) replaced historical [#95](https://github.com/planetaryescape/marginalia/pull/95) at the identical original `bed850d` commit in native [stack #101](https://github.com/planetaryescape/marginalia/stack/101). Original #95 references describe ancestry, not a current base; consult [Delivery](04-delivery.md).

Historical context, not current authority. Follow [README](README.md#rules-for-coding-agents) and [Delivery](04-delivery.md) for the current workflow and explicit per-target permissions. Writable remotes and the prompt below do not authorize schema changes, deployment, live writes or backfills; review-fix and merge permission has only the scope recorded there.

Paste this to the coding agent in `~/source/oss/marginalia` (remotes: `origin` is `planetaryescape/marginalia`, now writable with approved admin access; `fork` is `guidefari/marginalia`):

---

You're adding EPUB books to Marginalia: EPUBs read in the existing reader with their structure and images, and a Mac CLI that imports DRM-free books from Apple Books with their highlights and notes. It was fully planned in an earlier session you didn't see. Everything from that session is in this repo.

1. Read `docs/epub/blueprint/README.md` and every document it lists, in order. Read `02-decisions.md` before proposing any change of direction; the obvious alternatives (embedding foliate-js, text-only import, in-browser Apple Books import) were already rejected there. Read `docs/design/blueprint/02-design-concept.md` and `apps/web/DESIGN.md` too.
2. Skim Leaf in `../epub`: `README.md`, `PROVENANCE.md`, `scripts/import-annotations.py`, `scripts/import-book.py` and the CFI expansion in `src/reader/`. That is the Apple Books knowledge being ported. Don't copy its renderer.
3. Ask Guide Q1 to Q3 in `03-open-questions.md` if they're still open. Then answer V1 to V6 against the current `origin/main` and record the findings in `03-open-questions.md`.
4. Include the blueprint in `feat/epub-parser`, built on upstream auth #100, replacing #95 (D-EPUB-015, D-EPUB-016, D-EPUB-021). `origin` is writable with approved admin access and reviews use native upstream stack #101, not fork review or one cumulative integration PR. The updated `README.md` and `04-delivery.md` describe that chain. Preserve historical discussion and pending findings; registration does not authorize merging or deployment.
5. Then climb the stack in `04-delivery.md` one PR at a time, each branch cut from the previous one. Before writing any schema change, show Guide the diff and wait for approval. Never deploy the backend.
6. Commit using `type(scope): description`, Guide as the only author, no co-author lines. Run `bun run check` before each commit.

Ask Guide about anything in `03-open-questions.md` when it comes up. Don't guess.

---
