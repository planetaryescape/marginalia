# 09: Open questions and spikes

## Spikes (run against the real app before the rung that needs them)

For each spike, record what was tried, the result, the date and the conclusion under a `### Sn result (<date>)` heading here. Then update the document it affects.

| # | Question | Why it matters | Affects | Blocks |
|---|---|---|---|---|
| S1 | Can the View Transitions API morph an article title from a desk row into the reader heading in Next.js App Router? What happens in Safari and in the installed PWA, and what is the fallback when it's unsupported? | The desk-to-reader hand-off is the moment that makes the app feel fast and whole (D-DES-009). | [02](02-design-concept.md#motion), [04](04-desk.md) | Rung 7 |
| S2 | Margin layout under load: with every annotation shown as a sidenote, how are collisions resolved at 1280 px and 1440 px, how much reflow and scroll jank does a 100+ paragraph article cause, and does in-flow unfolding on a phone keep the reading place? | Sidenotes are the concept's main bet (D-DES-019, D-DES-026). A crowded or janky margin defeats it. | [03](03-reader.md#the-margin) | Rung 2 |
| S3 | Does prefetching `suggestions.forWindow` on hover or focus of a time choice bring perceived wait under 150 ms? Is a layout skeleton better than the current loader for the first sign-in load? | Choosing time is the desk's core action. The 2026-10-15 pass measured 0.47–1.1 s per window. | [04](04-desk.md#choosing-time) | Rung 3 |
| S4 | When scrolled to the end of an article at 1440×900, does the top progress bar reach the end? In the 2026-10-16 audit it stayed at about a fifth of the width after an automated scroll. It may be an artifact of the automation. | If it's real, the finishing moment is broken. If not, no action. | [03](03-reader.md#finishing) | Rung 1 |
| S5 | How long does topic search take today from the last keystroke to the first result, and how fast can the first card appear from search alone? | The first card must land before BK bounces (D-DES-036). | [04](04-desk.md#topic-search-the-second-way-in) | Rung 3 |
| S6 | What fingerprint tells cheaply whether anything relevant changed since an article was last annotated, and what does a reading-time pass cost per article? | The pass must cost nothing when nothing changed (D-DES-046). | [03](03-reader.md#reading-alongside) | Rung 2c |
| S7 | Which PDF text extraction runs in Convex (or beside it) and keeps headings and paragraphs well enough to read and annotate? | PDFs become articles (D-DES-043). | [04](04-desk.md#bringing-your-own) | Rung 3b |

## Product questions for BK

| # | Question | Status |
|---|---|---|
| Q1 | Is "Print, pencil and pen" the concept? The author speaks in print, Marginalia in pencil, you in your own pen. Or is there a different idea of what Marginalia is to you? | Answered by BK 2026-10-16: yes, "Print, pencil and pen" (D-DES-029) |
| Q2 | Which reading products or physical objects do you admire, and for what? No references were recorded. | Answered by BK 2026-10-16: Tufte / gwern.net sidenotes, iA Writer and Things 3. Readwise Reader stays the dense counterexample (D-DES-029) |
| Q3 | Navigation: three rooms (Desk, Library, Notes), with Saved as a Library shelf and This week as Notes → Your week? | Open; blueprint assumes yes (D-DES-024) |
| Q4 | Sources, Account and Readers grouped as Settings behind the account menu? | Open; blueprint assumes yes (D-DES-025) |
| Q5 | On a phone, should a margin note unfold under its paragraph instead of opening a bottom sheet? | Answered by BK 2026-10-16: unfold under the paragraph (D-DES-030) |
| Q6 | On wide screens, should margin notes always show as quiet sidenotes, or stay hidden behind markers until you click? | Answered by BK 2026-10-16: always shown, quietly (D-DES-030) |
| Q7 | Should the interface stop using your pen colour for links, buttons, drop caps and progress, so the pen colour only marks your own highlights and notes? | Answered by BK 2026-10-16: yes (D-DES-029) |
| Q8 | Hide keycap hints by default (`?`, tooltips and holding a modifier reveal them)? | Answered by BK 2026-10-16: hide; reveal on `?` or holding Alt (D-DES-030) |
| Q9 | Remove the GitHub link from the header and the reader toolbar? | Answered by BK 2026-10-16: yes; it moves to the account page footer (D-DES-029) |
| Q10 | The decorative drop cap is on by default (`dropCap: "text"` in `@planetaryescape/reader`) and drawn in the pen colour. Should it default to off, or be drawn in ink? | Answered by BK 2026-10-16: drawn in ink, on by default, kept as a reader setting (D-DES-029) |
| Q11 | Move "Re-annotate with latest vault" into the article's overflow menu? | Answered by BK 2026-10-16: yes (D-DES-029) |
| Q12 | When you choose a time, should the pick appear on the desk itself instead of on a separate full-screen page? | Answered by BK 2026-10-16: on the desk, in the main slot (D-DES-030) |
| Q13 | Should Up next leave the desk entirely, so the desk is only the question, the slot and search? Three rows are a small queue, which is what D-DES-033 avoids. | Answered by BK 2026-10-16: remove Up next from the desk; it lives in Library (D-DES-035) |
| Q14 | With a time chosen, should a topic search offer only articles that fit it? | Decided by Claude, delegated by BK 2026-10-16: yes (D-DES-052) |
| Q15 | When no article on a topic fits the time, should it say so and offer the shortest on that topic? | Decided by Claude, delegated by BK 2026-10-16: yes (D-DES-052) |
| Q16 | Should Library keep the full list of topic matches for deliberate browsing? | Decided by Claude, delegated by BK 2026-10-16: yes (D-DES-052) |
| Q17 | In the link menu, are "bookmark" and "add to reader" one action, Save for later into Marginalia's library? | Decided by Claude, delegated by BK 2026-10-16: one action, Save for later (D-DES-052) |

### S4 result (2026-10-16)

Tried on the live reader at origin/main `3794180`, 1440×900, Night, on a long article (8,442 px body): 40 wheel scrolls of 1,500 px with `agent-browser scroll`, which fire real scroll events. At the end `scrollY` was 7,542 of a 7,542 maximum and `.reading-progress` had `width: 100%`. The audit's fifth-of-the-width reading came from scrolling without scroll events, so `use-engagement-tracker.ts` never re-measured. Conclusion: not a bug; no action. Rung 1 still recolours the bar, which today uses the crossref-to-question annotation gradient (`globals.css` `.reading-progress`).

### S2 result (2026-10-16)

**Question.** If every annotation shows as a right-margin sidenote at its line, how are collisions resolved at 1280 and 1440 px, what does a 100+ paragraph article cost in layout and scroll, and does in-flow unfolding on a phone keep the reading place?

**Short answer.** Greedy push-down with the blueprint's three-line collapsed note works at both widths for any realistic density, and costs about 1 to 25 ms per layout pass with no scroll cost. It fails only when anchors sit closer than about 80 px on average, which is more than one note per three lines of text. The blueprint's 240 px collapse rule is the right backstop but needs a second fallback for that case. On a phone, unfolding below the paragraph never moves the reading place, and the browser's scroll anchoring covers the case where the unfold happens above the viewport.

#### What was measured, and how

- **Real data is thin.** The library's most annotated article has 9 annotations in about 14 body paragraphs and 8.4k px of height. The other articles I opened had 4 each. Nobody has a 100+ paragraph article with many annotations yet, so the stress test is synthetic.
- **Stress article.** The 9-annotation article was cloned in the page (local DOM only, no app writes) to 112 body paragraphs and 54k px of height. The paragraphs in this article are long (about 480 px each), so a per-paragraph density is tame. I therefore also placed notes by vertical spacing: one note per N px at jittered line positions (`px400` to `px60`) and a clustered case (2 to 3 notes in every third paragraph).
- **Prototype.** Absolutely positioned boxes in the right gutter at `left = column right + 24`, `width = min(300, gutter − 48)`, each with a kind label and 120 to 260 characters of placeholder text (the real note text isn't in the DOM, so none was used). Greedy placement: `top = max(anchor, previousBottom + 8)`. I used 8 px, the blueprint's gap, rather than the 12 px in the brief.
- **Gutters.** 1440 px: column right edge 1032, gutter 408, note width 300 (capped). 1280 px: column right edge 952, gutter 328, note width 280.
- **Strategies.**
  - `full`: unclamped text, greedy. Median note 106 px tall (70 to 125).
  - `greedy`: label plus 3-line clamp, greedy. Every note 70 px tall. This is the blueprint's collapsed note.
  - `collapse`: `greedy` plus the blueprint rule. A note pushed more than 240 px collapses to its label line only.
  - `merge`: `collapse` plus merging anchors within 40 px into one stacked box.
- **Environment.** `agent-browser` on production, headless Chrome. Layout times are `performance.now()` around DOM creation, one forced layout read and the placement pass.

#### Collision results (displacement from the anchor line, px)

Notes in the table are counts of anchors. "Displaced" means moved more than 1 px. "Past end" is the last note's bottom minus the article's bottom; negative means it fits.

| Density | Width | Strategy | Anchors | Displaced | Max | Median (displaced) | Past end | Layout ms |
|---|---|---|---|---|---|---|---|---|
| real (9 marks) | 1440 | full / greedy | 9 | 1 | 96 / 78 | 96 / 78 | fits | 0.5 |
| real (9 marks) | 1280 | full / greedy | 9 | 1 | 114 / 78 | 114 / 78 | fits | 0.4 |
| real (9 marks) | both | merge | 9 | 0 | 0 | 0 | fits | 0.4 |
| 1 per paragraph (112) | 1440 | all | 112 | 0 | 0 | 0 | fits | 3.7 |
| 1 per paragraph (112) | 1280 | full | 112 | 2 | 18 | 18 | fits | 3.5 |
| clustered (94) | 1440 | full | 94 | 51 | 247 | 78 | +22 | 3.3 |
| clustered (94) | 1440 | greedy / collapse | 94 | 51 | 156 | 48 | fits | 3.4 |
| clustered (94) | 1440 | merge | 55 boxes | 12 | 46 | 6 | fits | 5.5 |
| clustered (94) | 1280 | full | 94 | 51 | 247 | 97 | +41 | 3.2 |
| clustered (94) | 1280 | greedy / collapse | 94 | 51 | 156 | 48 | fits | 3.2 |
| clustered (94) | 1280 | merge | 55 boxes | 12 | 46 | 6 | fits | 3.2 |
| 1 per 400 px (133) | both | all | 133 | 0 | 0 | 0 | fits | 4.5 to 5 |
| 1 per 250 px (212) | 1440 | full | 212 | 1 | 25 | 25 | fits | 7 |
| 1 per 250 px (212) | 1280 | full | 212 | 3 | 25 | 7 | fits | 6.6 |
| 1 per 150 px (354) | 1440 | full | 354 | 94 | 115 | 30 | fits | 12 to 15 |
| 1 per 150 px (354) | 1280 | full | 354 | 106 | 153 | 31 | fits | 12.5 |
| 1 per 150 px (354) | both | greedy | 354 | 35 | 12 | 6 | fits | 13 to 17 |
| 1 per 100 px (531) | 1440 | full | 531 | 530 | 2,483 | 1,080 | +2,494 | 18 |
| 1 per 100 px (531) | 1280 | full | 531 | 530 | 5,266 | 2,635 | +5,277 | 20 |
| 1 per 100 px (531) | both | greedy | 531 | 226 | 66 | 12 | fits | 19 to 22 |
| 1 per 100 px (531) | both | merge | 500 boxes | 195 | 64 | 6 | fits | 19 |
| 1 per 80 px (662) | both | greedy | 662 | 553 | 186 | 48 | +4 | 24 |
| 1 per 80 px (662) | both | merge | 561 boxes | 443 | 166 | 38 | +2 | 23 to 25 |
| 1 per 60 px (887) | both | greedy | 887 | 886 | 15,324 | 7,596 | +15,280 | 31 to 34 |
| 1 per 60 px (887) | both | collapse | 887 | 886 | 305 | 229 | +155 | 118 to 124 |
| 1 per 60 px (887) | both | merge | 543 boxes | 542 | 374 | 220 | +148 | 59 to 69 |

Observations, all from the table above:

1. **Unclamped notes are the problem, not the density.** At 1 per 100 px the unclamped notes drift 2.5k to 5.3k px and run past the article end. The same anchors with the 3-line clamp stay within 66 px and fit. The 3-line collapsed note in the blueprint is therefore load-bearing, not cosmetic.
2. **A clamped note is 70 px tall, so a 78 px pitch (70 + 8) is the margin's capacity.** Above roughly one note per 80 px sustained, drift grows without bound (1 per 80 px ends 2 to 4 px past the end; 1 per 60 px ends up to 15k px past it). That density is about one note per two lines of text, which is not a real reading margin.
3. **Clusters are the realistic stress.** Three notes in one paragraph give a 156 px maximum displacement with clamping, under one screen (800 to 900 px) and under the 240 px collapse threshold. With full text the maximum is 247 px, one note over the threshold.
4. **No case displaced a note by more than one screen** except the unclamped 1-per-100-px-or-denser runs and the 1-per-60-px clamped run, so the "second strategy if greedy displaces by more than a screen" step was only needed for those. Merging anchors within 40 px cut boxes from 94 to 55 and displaced notes from 51 to 12 in the clustered case. It did nothing for even spacing (1 per 100 px: 531 to 500 boxes).
5. **The 240 px collapse rule does its job and costs time.** At 1 per 60 px it reduces maximum drift from 15,324 px to 305 px but still ends 155 px past the end, and layout takes 118 to 124 ms because a second measure is needed per collapsed note. That is outside any realistic input.
6. **Layout time is small.** 531 notes: 19 to 22 ms for the full build (create, measure, place). A relayout of the existing 531 boxes (set width, read heights, re-place) took 4.7 to 5.1 ms, over three runs, going 280, 300, 280 px.

#### Scroll jank

- **Setup.** 112-paragraph, 55.6k px article, 1440×900. A `requestAnimationFrame` delta recorder plus a `longtask` PerformanceObserver. Scroll was 60 real `agent-browser scroll down 1000` wheel commands from the top, about 36k px of travel per run, about 10 s wall.
- **Conditions.** No notes; 94 notes (clustered, clamped); 531 notes (1 per 100 px, clamped); 531 notes (unclamped); no notes again.
- **Result, identical in all five.** About 610 frames per run, p50 16.7 ms, p99 16.8 ms, max 16.8 ms, zero frames over 20 ms, zero long tasks.
- **Limit of this measurement.** Headless Chrome held every frame at 16.7 ms, so it shows the main thread never blocked, not paint cost on a real GPU or a mid-range phone. The notes are plain absolutely positioned boxes in normal flow scroll, with no scroll listeners of mine, so I would not expect them to cost anything, but I did not measure a real device. Chrome DevTools on a throttled CPU, or a trace on the owner's laptop, would settle it. A builder should check long tasks while scrolling the final component once.
- **Reflow.** Adding the margin notes does not change the text column, so the paragraphs do not reflow. The notes sit beside the column in the gutter and the column's width is unchanged by them.
- **Resize.** After a viewport change the column's anchors move, so the whole pass reruns: 0.5 to 25 ms depending on density, as in the table. That is well inside one frame for any real article (under 4 ms up to 133 notes).

#### Recommended collision strategy

1. **Anchor each note to the top of the line holding its mark.** Take the position from the mark's first client rect (`range.getClientRects()[0]`), not from the paragraph. Recompute on resize and on font-size or theme changes.
2. **Place in anchor order, greedy.** `top = max(anchor, previousBottom + 8)`. Measure all heights first, then write all tops in one pass, so a pass is one forced layout.
3. **Always render the collapsed note at the 3-line clamp.** Label line plus at most three lines, so every note is 70 px at the blueprint's type sizes (re-measure if the type tokens change). The unclamped numbers above are the reason: do not let a margin note grow with its text until it is opened.
4. **Collapse to one line when displaced more than 240 px**, as in the blueprint. Recompute the following notes after each collapse, so a single collapsed note frees its neighbours.
5. **Merge notes whose anchors are within 40 px into one stacked box.** They share one connector. This is cheap and worth having because clusters (several notes on one passage) are the likely real pattern: it cut displaced notes from 51 to 12 and maximum displacement from 156 to 46 px.
6. **Add a third rule the blueprint lacks.** If the last note would end more than one note-height below the article's last line, collapse every remaining displaced note to one line. In the synthetic 1-per-60-px case collapse and merge both still ended about 150 px past the end. That is a density no reader will reach, but the rule is two lines of code and prevents notes hanging below the back matter.
7. ~~Open notes float above their neighbours.~~ Replaced by D-DES-049: an opened note keeps its place in the stack at its open height and pushes the notes below it down.
8. **Rerun on resize**, debounced to one frame. A relayout of 531 notes costs about 5 ms, so there is no need for virtualisation or windowing at these sizes. Only the arrival animation (notes appear as their line enters the 40% zone) needs an IntersectionObserver.

Both widths behave the same. 1280 px has a 280 px note width against 300 at 1440 px, so unclamped notes wrap more at 1280 px (the real-data maximum displacement is 114 px against 96 px), but it did not change any outcome with the 3-line clamp. No separate 1280 rule is needed.

#### Phone: in-flow unfolding (390×844)

Method: a 132 px block (16 px left indent, 1 px rule) inserted after a paragraph with `after()`, measuring the paragraph's viewport top and `scrollY` after six frames. Scroll jumps used `behavior: 'instant'`. (An earlier run with smooth scrolling gave wrong numbers because the scroll was still animating; I discarded it.) `html` and `body` both compute `overflow-anchor: auto`.

| Case | overflow-anchor | scrollY shift | Reading place moved? |
|---|---|---|---|
| Note below a mid-screen paragraph (top at 300 px) | auto | 0 | No. Paragraph top stayed at 300 px. |
| Same | none | 0 | No. |
| Note below a paragraph straddling the viewport top (top −108 px) | auto | 0 | No. Paragraph top stayed at −108 px. |
| Same | none | 0 | No. |
| Note inserted below a paragraph entirely above the viewport (about −950 px) | auto | +156 | No. The first visible block stayed at −149 px; the browser added 156 px to `scrollY`. |
| Same | none | 0 | Yes. The first visible block jumped from −149 px to +7 px, 156 px down. |

Conclusion:

- **Inserting below the tapped paragraph never moves that paragraph**, with or without scroll anchoring. A tap on a dot in the visible part of a paragraph keeps the reading place, including when the top of the paragraph is already scrolled off.
- **Scroll anchoring is only needed for insertions entirely above the viewport** (a programmatic open from the Notes panel, or a note arriving for a line that has scrolled past). With the default `overflow-anchor: auto`, Chrome keeps the reading place there. Builders must not set `overflow-anchor: none` on the article or any ancestor, and must not wrap the unfolded block in a container whose `overflow` is anything other than `visible`, which would drop it out of anchoring.
- **Not tested:** Safari/iOS WebKit, which I could not run here, so I have no evidence either way on its scroll anchoring. Until someone checks on a device, add a manual fallback for insertions above the viewport: record the first visible block's top, insert, then `scrollBy(0, newTop − oldTop)`. For taps below the paragraph no fallback is needed on any engine, because nothing above the insertion changes.
- **Folding** is the same operation in reverse. A fold of a note above the viewport relies on the same anchoring.

#### Cleanup and caveats

Everything injected was removed by a full reload (verified: 0 clone nodes and 0 prototype wrappers after reload). No notes, highlights, ratings or finishes were written. Four articles were opened, one of them several times. Production showed the signed-out screen once mid-run, then recovered after a reload with the same profile (the session in the profile was still valid). Prototype code and raw outputs are in the scratchpad (`/private/tmp/claude-501/-Users-bhekanik-code-planetaryescape-marginalia/ea7c940c-dd4b-4eb6-9d8b-27b90f1e0199/scratchpad/s2/`: `proto.js`, `phone.js`, `rec.js`, `m1280.txt`, `m1440b.txt`).

# Marginalia design spikes S3 and S5

Measured 2026-10-16 on the live app at 1440x900. Code read at origin/main 037e305. No notes, highlights, saves, reads or skips were pressed. Four time choices were made (the session budget): cold 5, warm 5, cold 10, warm 10. Three topic searches were run (budget 8).

### S3 result (2026-10-16)

**What I tried**

- Clicked a time choice on Home with an injected script (`performance.now()` plus a per-frame poll for the first card heading). "Cold" was a fresh page load of `/`; "warm" was a client-side return to `/` from a session page, then a second click.
- Timed the existing-session page on hard loads (no new session records) for first paint and first heading.
- Tried to time a client-side `/session` route change to an existing session using back/forward. The result was invalid: the router kept the previous tree, so the card showed at 0 ms. I discarded it.

**Numbers** (from click, `performance.now()`, poll resolution about 16 ms)

| Run | Session route (`/session` shown) | First card heading |
|---|---|---|
| Cold, 5 min | 274 ms | 484 ms |
| Warm, 5 min | 211 ms | 311 ms |
| Cold, 10 min | 166 ms | 333 ms |
| Warm, 10 min | 164 ms | 347 ms |

Route-to-card (the post-route part, which is the subscription, the `getById` and `suggestions.forWindow` round trips, and the render): 210, 100, 167 and 183 ms.

Hard load of an existing session URL (no record created, 3 runs): first paint 100–184 ms after navigation start. First heading 708–1317 ms after navigation start. This is an upper bound, because the poll starts after the load event.

**Why the 150 ms target does not fit**

`startSession` in `apps/web/src/app/(desk)/page.tsx` awaits `api.sessions.create` before `router.push`. The route therefore cannot change until the session mutation round trip has finished, and that is 164–274 ms before any query runs. Query prefetch on hover cannot remove that part. Even with the query at zero, the click-to-route segment is above 150 ms in all four runs.

I could not split the 164–274 ms into mutation round trip and route render. That needs send-timestamp logging on the WebSocket, which needs a fresh session and I had none left. Treat the split as unmeasured.

Hover prefetch can only save the route-to-card part (100–210 ms). For it to work, the prefetch must hold a live subscription in Convex. A one-off `client.query` does not populate the reactive cache that `useQuery` reads. The 200–400 ms hover-to-click window is larger than the query time, so the card would be ready at click if the subscription were held.

**Skeleton versus loader**

The current loader (`apps/web/src/app/session/[id]/page.tsx`, around L187) is a pulsing text line ("Finding something for your N minutes...") and it shows for 100–480 ms in the warm and cold runs. On a first sign-in hard load, the wait before the first heading is 0.7–1.3 s, and nearly all of it is WebSocket connect and auth, which a skeleton does not shorten. I did not measure perceived wait, so I cannot say the skeleton is better.

**Conclusion and recommendation**

- Do not gate rung 3 on the 150 ms target as written. It fails because `sessions.create` is awaited before navigation, not because of query time.
- Next step: make the route change first and create the session in the background (or generate the session id client-side). That is a server-visible change, so it needs a decision first.
- Prefetch on hover is worth it only with a held subscription, and it saves at most 100–210 ms. Measure again after the route change, not before.
- Keep the loader for now. Test a skeleton only after the route change is fixed, with a perceived-wait check.
- What would settle the open points: a timestamped WebSocket log (outgoing mutation, outgoing `ModifyQuerySet`, incoming transition) on one cold run.

### S5 result (2026-10-16)

**What I tried**

Typed three generic topics ("attention", "software design", "writing") into the Home search bar with real keystrokes (`agent-browser keyboard type`). The page's `fetch` was wrapped to time the request. A `MutationObserver` recorded the first `role=option` row. Times are measured from the last `input` event.

**Numbers** (from last keystroke)

| Topic | Request starts (debounce) | Response headers | First result row | Rows |
|---|---|---|---|---|
| attention | 603 ms | 8827 ms | 8828 ms | 5 |
| software design | 602 ms | 7285 ms | 7286 ms | 6 |
| writing | 603 ms | 6742 ms | 6743 ms | 6 |

The debounce is 600 ms, as coded in `apps/web/src/components/article-finder.tsx` (L63 area). The request is a single POST to `/api/reader/library/search` with status 200. The first row appears in the same frame as the response, so rendering adds about 1 ms.

**Where the time goes**

The route is `packages/backend/convex/http.ts` (L488 onwards) and the retrieval is `packages/backend/convex/lib/library.ts` (`retrieveLibraryContext`). The response is only `{ matches }`, with no timings. So the split is not observable from the browser.

By code shape, the stages are:

1. `loadReaderAI` (reader's provider and key lookup).
2. `embedText`: one external embedding call (`lib/embeddings.ts`).
3. Five vector searches in parallel (articles 24, impressions 10, notes 8, highlights 8, threads 6).
4. `recentActivity` and `loadMatches` queries, then `loadArticles` for up to `MAX_ARTICLES = 40` articles, which build a context block.
5. `completeJson` with the quick model, JSON schema, 3000 max tokens, and the full context.
6. `parseLibrarySearch`.

I estimate stage 5 is most of the 6.7–8.8 s, because it is the only stage that generates tokens. That is inference from the code, not a measurement. I did not measure the embedding call or the vector search on their own. Nothing I could reach from the browser isolates them.

**Target and design**

- Target: first result under about 1 s after the 600 ms debounce, from a search-only path (embedding plus vector search, then articles from the hits, with no ranking or explanation call). Stretch: under 300 ms. I would not commit to 300 ms before the embedding round trip is measured, because it is one external API call.
- Design: return the vector hits immediately as an unexplained list. Send the model's ranking and reason as a second, optional update (second request, or streamed JSON), and merge them when they arrive. The current `parseLibrarySearch` already maps results to article ids, so a second call can refine the order without new fetches.
- Server changes needed:
  - A search-only route, or a `mode` flag on `/api/library/search`, that returns after step 4.
  - A `Server-Timing` header (or a timings field) with per-stage durations for steps 1–6. This is the one change that would settle the split.
  - Optional: a short `Cache-Control` for repeated queries (the client already caches for 5 minutes).

**Conclusion**

The current search takes 6.7–8.8 s from the last keystroke, and the model call is the likely cause. Adding `Server-Timing` first is cheap and would confirm the split before any redesign. Then build the search-only path behind a flag and compare its first-result time to the target above.
