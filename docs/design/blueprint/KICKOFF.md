# Kickoff prompt for the first build session

Paste this to the coding agent in a fresh checkout of `planetaryescape/marginalia`:

---

You're redesigning Marginalia, a personal reading app whose features already work but whose design was never considered as a whole. The design was planned in an earlier session you didn't see. Everything from it is in this repo.

0. Read [00 The foundation](00-overview.md#the-foundation-ai-as-a-thinking-partner) first: AI as a thinking partner. Every decision follows from it.
1. Read the repo `README.md`, `ARCHITECTURE.md` and `PRODUCT.md`, then `docs/design/blueprint/README.md` and every document it lists, in order. Read `08-decisions.md` before proposing any change of direction; most alternatives were already considered. Then read `apps/web/DESIGN.md` and `docs/operations.md`.
2. Check `09-open-questions.md`. Ask me the product questions the next rung needs (Phase 0 in `07-roadmap.md` says which). Don't guess them. Run the spike that gates the rung and record the result under its heading in `09-open-questions.md`.
3. Open https://reader.bhekani.com with `agent-browser` and look at the screens the rung touches, in Night and Paper, at 1440×900 and 390×844. Don't write test content into the live library. Opening an article records a visit; that's acceptable.
4. Before writing UI code, read `02-design-concept.md` again and make a comp or HTML prototype of the rung's screens and key moments. Show it to me and build to the approved comp.
5. Climb `07-roadmap.md` one rung at a time, starting with the first rung its status table doesn't mark done. A rung ends only when its Done-when checks and the design gate are observed on the deployed app, and its demo has been run. Deploy per `docs/operations.md`, and ask before any backend deploy. Commit using `type: description`, with me as the only author.

Ask me about the product questions in `09-open-questions.md` when they come up.

---
