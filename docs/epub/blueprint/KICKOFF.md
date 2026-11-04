# Historical kickoff prompt for the first build session

Historical context only, not current execution instructions. Follow native upstream auth #100 and stack #101 in later follow-up #106. The prompt originally went to the coding agent in `~/source/oss/marginalia`. At this historical slice, `origin` (`planetaryescape/marginalia`) was read-only and `fork` was `guidefari/marginalia`; later [#106](https://github.com/planetaryescape/marginalia/pull/106) records approved writable upstream heads and native stack #101. Do not treat the old access restriction as current.

---

You're adding EPUB books to Marginalia: EPUBs read in the existing reader with their structure and images, and a Mac CLI that imports DRM-free books from Apple Books with their highlights and notes. It was fully planned in an earlier session you didn't see. Everything from that session is in this repo.

1. Read `docs/epub/blueprint/README.md` and every document it lists, in order. Read `02-decisions.md` before proposing any change of direction; the obvious alternatives (embedding foliate-js, text-only import, in-browser Apple Books import) were already rejected there. Read `docs/design/blueprint/02-design-concept.md` and `apps/web/DESIGN.md` too.
2. Skim Leaf in `../epub`: `README.md`, `PROVENANCE.md`, `scripts/import-annotations.py`, `scripts/import-book.py` and the CFI expansion in `src/reader/`. That is the Apple Books knowledge being ported. Don't copy its renderer.
3. Ask Guide Q1 to Q3 in `03-open-questions.md` if they're still open. Then answer V1 to V6 against the current `origin/main` and record the findings in `03-open-questions.md`.
4. Include the blueprint in `feat/epub-parser`, built on `fix/local-auth-onboarding` (D-EPUB-015, D-EPUB-016). The independent-stack proposal was D-EPUB-014, superseded by D-EPUB-016; D-EPUB-015 folded docs into the parser. D-EPUB-019 records this slice's fork reviews. Later [follow-up #106](https://github.com/planetaryescape/marginalia/pull/106) supersedes that workflow with upstream auth #100 replacing #95 and native stack #101. Consult that current workflow rather than opening a cumulative integration PR; preserve historical auth discussion and unresolved findings.
5. Historically, the agent was to climb the original stack below one PR at a time. That table is not current instructions; subsequent work follows upstream auth #100 and native stack #101 in later follow-up #106. Before writing any schema change, show Guide the diff and wait for approval. Never deploy the backend.
6. Commit using `type(scope): description`, Guide as the only author, no co-author lines. Run `bun run check` before each commit.

Ask Guide about anything in `03-open-questions.md` when it comes up. Don't guess.

---
