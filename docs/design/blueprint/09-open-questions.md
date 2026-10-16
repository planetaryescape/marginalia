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
| S8 | How should long documents be split (PDF outline, headings, fixed size), what does indexing a book cost in embeddings, and how well does searching within one document find the passages a question needs? | Books and long PDFs (D-DES-055). | [03](03-reader.md#books-and-long-documents) | Rung 3b |
| S9 | What embedding similarity threshold maps a proposed tag onto an existing tag or alias without merging distinct topics, measured on BK's library and vault tags? | The tag vocabulary must resist growth without blurring topics (D-DES-059). | [02](02-design-concept.md#tags) | Rung 2c |

## Product questions for BK

| # | Question | Status |
|---|---|---|
| Q1 | Is "Print, pencil and pen" the concept? The author speaks in print, Marginalia in pencil, you in your own pen. Or is there a different idea of what Marginalia is to you? | Answered by BK 2026-10-16: yes, "Print, pencil and pen" (D-DES-029) |
| Q2 | Which reading products or physical objects do you admire, and for what? No references were recorded. | Answered by BK 2026-10-16: Tufte / gwern.net sidenotes, iA Writer and Things 3. Readwise Reader stays the dense counterexample (D-DES-029) |
| Q3 | Navigation: three rooms (Desk, Library, Notes), with Saved as a Library shelf and This week as Notes → Your week? | Answered by BK 2026-10-16: yes, four rooms, Desk, Library, Notes and Your reading (D-DES-061) |
| Q4 | Sources, Account and Readers grouped as Settings behind the account menu? | Answered by BK 2026-10-16: yes, behind the avatar (D-DES-061) |
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

## S9 and S6 spikes (aggregate only, no titles, notes, tag names or URLs)

Code read at `origin/main` d1d580f (`marginalia-deploy` worktree). Data read with `convex data ... --format jsonl` into the session scratchpad, not the repo. No mutations, no commits.

### S9 result (2026-10-16)

**Blocker: no embedding key.** The 1Password item "OpenAI API" exists, but its `OPENAI_API_KEY` and `credential` fields are empty (read with `op read` and `op item get --reveal`; length 0). No `OPENAI_API_KEY` or OpenRouter variable is set in the environment. I made no embedding calls and spent $0. The only embeddings available are the stored 1536-dimension `noteChunks.embedding` vectors, which embed note content, not tag names. So the precision/recall of *name* embeddings at 0.70 to 0.95 is **not measured**. Ollama has only chat models, and a different embedding space would not transfer a threshold.

**What the data shows (1,772 chunks, 1,496 with tags):**
- 120 distinct tags. 82 contain `/` (hierarchical paths) and 26 start with `#`. 62 of 120 appear on exactly one note.
- Per-note frequency is steeply skewed: top tags cover 160, 140, 138, 79, 66, 62, 58, 55 notes, then it falls under 20 by rank 17.
- Most of these are not a topic vocabulary. They are vault structure (archive/area/project/resource folders, daily/meeting markers) plus a smaller set of real topics. The seed list needs a filter before it becomes a topic vocabulary, for example "leaf of the path, minus structural roots".
- String near-duplicates after lowercasing, stripping `#` and punctuation, and singularising:
  - Full path equal: 6 groups covering 13 tags (`#x` vs `x`, `knowledge-management` vs `knowledgemanagement`, `resource` vs `resources`).
  - Same last path segment: 21 groups covering 55 of 120 tags, collapsing to 86 distinct leaves. The same leaf appears under different roots (for example `areas/x`, `resources/x`, `#x`).
- That is a different problem from "llm"/"llms". The seed's duplicates are mostly hierarchy and prefix variants, and plain string normalisation resolves them without any embedding.

**Proxy test (weak, reported only for completeness).** I built 23 same and 25 different tag pairs from real tags, 4 further pairs dropped because a tag is absent. The first score was the cosine of the tags' content-centroids, which says nothing about name similarity. Precision/recall: at 0.70 P=0.50, R=0.26; at 0.75 P=0.33, R=0.13; at 0.80 P=0.38, R=0.13; at 0.90 P=0.25, R=0.04. Same-median cosine was 0.63 against 0.39 for different. Notes that share one tag set give 1.0 for unrelated tags. So centroids cannot stand in for names, and I ignore these numbers for the threshold.

String normalisation alone (lowercase, strip `#` and punctuation, singularise, compare last path segment) matched 21 of 23 same pairs and falsely merged 1 of 25 different pairs. The false merge was the same leaf under two parents (a work-area prefix on one and none on the other), which is arguably the owner's call.

**Conclusion.** Normalise first: it is cheap, deterministic, and catches most of the seed's duplicates. Run the embedding check only for what survives normalisation.

**Recommendation**
1. Pipeline: normalise (lowercase, strip `#`, split on `/` and keep the leaf, strip punctuation and hyphens, singularise) → exact match against tags and aliases → embedding check.
2. Embed `name + one-line description` for each tag, not the bare name. Short single tokens (`llm`, `ai`) sit in a crowded neighbourhood in text-embedding-3-small, and hiring/interviewing-type pairs are the case where a description helps separate them. Bare names are unverified. Test both once a key exists.
3. Threshold (unmeasured prior, not a result): auto-merge at >= 0.90, queue for owner confirmation between 0.80 and 0.90, treat as new below 0.80. Rung 2c should ship the thresholds as config, plus the queue, rather than a hard-coded merge.
4. To close S9: a key in 1Password, then embed about 120 tags plus descriptions (under 5k tokens, under $0.001), score the labelled pairs, and fill in P/R from 0.70 to 0.95. I can rerun this with the same pairs.

### S6 result (2026-10-16)

**What the context builder reads** (`packages/backend/convex/lib/marginaliaContext.ts` at d1d580f):
- Article text capped at 120,000 chars (`MAX_ARTICLE_CHARS`), split into up to 12 sections (min 3,000 chars each). Each section is embedded and vector-searched in `noteChunks` (8 per section, floor 0.5, max 12 chunks, max 2 per note) and in `userNotes`, `highlights` and `companionThreads` (5 per section, floor 0.45, max 5 of each, other articles only).
- Plus the reader's own highlights, notes and threads on this article (10/10/8 caps), and today's date, publish date and source.
- The vault search is per library (`userId` filter), and nothing in the context depends on the article's annotation status.

**Which signals change what the model sees**
- Change the output: new or edited `userNotes` (has `updatedAt`), `companionThreads` (`updatedAt`; a kept thread has `keptAt`), new highlights on this article, and newly indexed vault chunks (`noteChunks.indexedAt`).
- Change often but rarely matter: library article count (an import adds an article but only matters if it is related; its notes and highlights are not yet there); `userNotes`/threads on unrelated topics.
- Gaps: `highlights` has `createdAt` only, no `updatedAt`, so edits and deletions are invisible to a max-timestamp; pair it with a count. `noteChunks` deletions have the same problem.

**Recommendation: two layers.**
1. Cheap gate (decides whether to run retrieval at all), stored on `articles`: `marginaliaFingerprint { notesMax, threadsMax, highlightsMax, highlightsCount, vaultIndexedMax, passAt }`, a handful of numbers read from existing indexes (`by_user_recent` on notes). Skip if equal. Not a library article count.
2. Precise gate (runs after retrieval, still before the model call): hash the *ids retrieved* for the upcoming section (sorted vault chunk ids, note ids, highlight ids, thread ids plus their `updatedAt`), compare with `articles.marginaliaContextHash`. This catches the case where the fingerprint moved but the retrieval for this section did not. Retrieval costs embeddings only (about $0.02 per 1M tokens, negligible).
- Store both on `articles` (or a small `marginaliaPasses` table if per-section state is wanted, which I recommend for per-section triggers: key by `articleId + sectionIndex`).

**Cost of today's import call** (default annotations chain is `openrouter:anthropic/claude-haiku-5.5`, then `anthropic:claude-haiku-5-5`, then `openai:gpt-6-luna`; `lib/providers.ts`, `ROLE_DEFAULTS`). Prices are not in the code. From the claude-api skill model table (cached 2026-10-06): Haiku 5.5 $0.10 in / $0.50 out per 1M tokens up to a 100K-token prompt ($0.50/$2.50 beyond), Sonnet 5.5 $2 / $10. OpenRouter adds its own fee, which I did not model.
- Article length (2,188 articles with content; 2,032 with 100+ words, the annotation floor): median 1,358 words, 75th percentile 2,338, 90th 3,910, 99th 11,230; about 6.0 chars/word in the stored text; 8 articles exceed the 120k-char cap.
- Token estimates: chars/4. System prompt 3,366 chars (about 840 tokens). Context 1.8k tokens typical (4 vault chunks of about 1,260 chars mean plus 3 short items) to 5.2k tokens full. Output assumed 1.5k visible plus 2k adaptive-thinking tokens (an assumption: I did not measure real output usage).
- Input tokens per article: mean 5.7k (typical context) to 9.2k (full), p90 8.8k to 12.2k, max 33k to 36k.
- Cost per article on Haiku 5.5: about $0.0023 mean to $0.0027 (full context), max $0.005. Backlog of 2,032 articles: about $4.70 to $5.40. Sonnet 5.5 for comparison: about $0.047 to $0.053 per article (about $95 to $108 for the backlog). Output tokens are about 45% of the Haiku cost, so the output assumption matters.
- Reading-time pass: next section about 2.5k words (about 3.75k tokens) + outline (about 500) + system + context re-retrieved for that section only (1.8k to 5.2k) + about 400 instructions = about 7.3k to 10.7k input tokens; output 0.7k visible + 1k thinking. Haiku 5.5: about $0.0016 to $0.0019 per pass. Sonnet 5.5: about $0.032 to $0.038. A full read of a median article in section passes (about 1 to 2 passes) is therefore about the same cost as today's one-shot call, since the saving on input is offset by repeating the system prompt and context each time. On Haiku, 10 passes a day is about $0.02.
- Prompt caching would help the reading pass: system prompt plus outline is a stable prefix (Haiku 5.5 cache-read price not in the skill table; Sonnet 5.5 is $0.20/M). I did not model it.

**Recommended trigger and budget**
- Trigger per section, not on open: when the reader's scroll reaches about 40% of the current section, queue the next section's pass; do it only if the cheap fingerprint changed or this section has no pass yet. On open alone wastes the call on readers who bounce; a fixed 40% of the whole article repeats the import pass.
- Budget rule: cap at N passes per article (suggest 8) and a daily spend cap (suggest $0.25 on Haiku, which allows about 130 passes), counted in the table above. When the budget is hit, stop quietly and show nothing rather than an error. Pass results go to the existing annotation quality gate unchanged.
- Rung 2f should keep the model on Haiku 5.5: Sonnet is about 20x the cost per pass.

**Not verified:** real output token counts (needs a usage log from the import action); OpenRouter pricing for `anthropic/claude-haiku-5.5`; Haiku cache-read price; whether import runs have the vault context populated for most articles (annotated: 134 of 2,202 rows; 1,855 skipped, 213 failed in the snapshot).

### S7 result (2026-10-16)

**Question.** Which PDF text extraction runs in Convex, or beside it, and keeps headings and paragraphs well enough to read and annotate?

**Setup.** Repo read at `origin/main` 574f3912303da152351a991654b3a12bef5e2125 (clean checkout). Nothing written to the repo, no Convex call made. Throwaway code is in (local scratchpad) (`lib/bench.ts`, `lib/structure.ts`). Samples, all openly licensed:
- Pro Git 2.1.450 (CC BY-NC-SA, github.com/progit/progit2 release), 501 pages, Asciidoctor PDF, has an outline of 22 chapters and 123 entries in total.
- "Attention Is All You Need" (arXiv 1706.03762, 15 pages, single column, footnotes, rotated arXiv stamp).
- "Deep Residual Learning" (arXiv 1512.03385, 12 pages, two-column CVPR). Added because the Attention paper is single column.

**Candidates and what they are.** `unpdf` 1.8.1, `pdfjs-dist` 6.4.299, `pdf-parse` 2.4.5 (installed with bun). All three are pdf.js underneath, so their text is nearly the same. Differences are packaging and API.

**Measured, plain-text extraction** (bun 1.3.14, Apple silicon; `bench.ts`, one candidate per process):

| | Attention (15p) | ResNet (12p) | Pro Git (501p) |
|---|---|---|---|
| unpdf `extractText` | 405 ms, 39,605 chars | 307 ms, 59,486 | 780 ms, 869,998; peak RSS 480 MB (bun), 386 MB (node 26) |
| pdfjs-dist legacy | 508 ms, 39,636 | 249 ms, 59,511 | 668 ms, 871,001; RSS 395 MB (bun), 348 MB (node) |
| pdf-parse `getText` | 401 ms, 39,970 | 242 ms, 59,765 | 1,945 ms, 879,410; RSS 398 MB (bun), 349 MB (node) |

Findings that changed the choice:
- Speed is not a differentiator: the whole book is under 2 s on any of them.
- Running `unpdf` and `pdfjs-dist` in one process fails with `The API version "6.4.299" does not match the Worker version "6.1.200"`. `unpdf` bundles its own pdf.js. Pick one library per bundle.
- Bundle size (`bun build --target=node --minify`): `unpdf` entry 1.62 MB (507 KB gzipped); `pdfjs-dist` legacy 0.50 MB entry plus a separate worker file. Install size on disk: unpdf 2.5 MB, pdfjs-dist 62 MB, pdf-parse 57 MB. Convex's cap is 90 MB compressed / 230 MB uncompressed per deployment, and external packages count toward it (https://docs.convex.dev/functions/bundling). `unpdf` is far inside it, `pdf-parse` and `pdfjs-dist` take a large share.
- `pdf-parse` returns text only (v2 adds `getText`/`getInfo`); it hides the position and font data needed for headings. `extractText` in `unpdf` does the same. The structure work needs the pdf.js proxy: `getDocumentProxy` from `unpdf`, then `page.getTextContent()`.
- Memory: `extractText` on the whole book peaks near 386 MB in node, uncomfortably close to Convex's 512 MiB Node action RAM. Reading page by page with `page.cleanup()` and building lines as I go (`structure.ts`) peaked at 259 MB in node (`/usr/bin/time -l`, 672 ms). Memory scales with page count and image-heavy pages; I did not test a 1,000-page or image-heavy file.

**Convex limits (docs.convex.dev/production/state/limits, fetched today).** Node actions: 512 MiB RAM, 10 minute timeout. Node action arguments max 5 MiB (16 MiB for other functions), return value 16 MiB. Document size 1 MiB. Code 90 MB compressed / 230 MB uncompressed. File storage (https://docs.convex.dev/file-storage/upload-files): "The file size is not limited, but upload POST request has a 2 minute timeout"; upload URLs live one hour. Consequence: the browser uploads the PDF to storage with an upload URL, and the Node action reads it with `ctx.storage.get` (a Blob). Never pass PDF bytes as an action argument (5 MiB cap).

**Structure rebuild prototype** (`structure.ts`, ~100 lines, on the `unpdf` proxy). Results with the numbers it produced:
- Attention: 133 blocks, 32 headings, all numbered sections and subsections found (`3.2.1 Scaled Dot-Product Attention`, `7 Conclusion`, `References`); 14 header/footer lines dropped; rotated arXiv stamp removed by skipping rotated text items.
- ResNet (two-column): 307 blocks, 18 headings (`1. Introduction` ... `4.3. Object Detection...`, appendix headings). Columns come out in the right order, because pdf.js returns items in content-stream order and LaTeX writes column by column. I did not test PDFs whose streams interleave columns (Word exports, scanned-then-OCR'd files); that needs a column splitter by x-gap.
- Pro Git: 4,875 blocks, 396 headings, 4,479 paragraphs, median paragraph 151 chars, 498 header/footer lines dropped, 3 words with a stray `- ` left. Headings found include chapters and sections, but heading levels are unreliable (most land at the same level), so use the PDF outline for hierarchy when one exists (Pro Git has one).
- Admonition icon glyphs in the private-use Unicode block (U+E000 to U+F8FF) became empty headings until I stripped that range. Keep the strip.

**Recipe for the reader's HTML.**
1. Lines: per page, group `getTextContent()` items by baseline y within 2 pt, in stream order; insert a space when the x gap exceeds about 0.15 x font size; skip rotated items (`transform[1]` far from 0).
2. Body size: the font size with the most characters. Body font id likewise.
3. Headings: size above 1.15 x body and under 120 chars; or a numbered pattern `^(\d+\.)*\d+\.?\s+[A-Z]` in a font other than the body font, under 80 chars, not ending in `.,;`. Level from the number of dots, or from size rank. Real font names are not available from text content (`commonObjs` gives "Requesting object that isn't resolved yet"), only ids like `g_d0_f2`, and `styles[].fontFamily` only says serif or sans-serif (it did not flag monospace in Pro Git code listings). So bold and code blocks cannot be detected by name; compare font ids against the body font id.
4. Paragraphs: a new paragraph on a vertical gap above 1.7 x line height, or a first-line indent after a line ending in terminal punctuation. Join a line ending in `[a-z]-` to the next line without the hyphen (measured: 3 leftovers in 4,479 paragraphs of Pro Git; this wrongly merges real compounds such as `well-` `known`, which I did not count).
5. Emit `<h1..h3>` and `<p>`, escape `&` and `<`, run through `slimHtml` and `htmlToPlainText` in `lib/ingest.ts` as today.
6. Running headers and footers: only lines in the top or bottom 9% of the page are candidates. Normalise digits to `#`, lowercase. Drop when the pattern appears on at least max(3, 25% of pages) pages, or the line is just a page number or roman numeral. Result: 14 lines dropped across the 15 Attention pages (page numbers), 498 lines across Pro Git's 501 pages. Risk seen: roman-numeral rule dropped a lone `c` line on Pro Git; use `^[ivxlcdm]+$` only when 2+ characters or when the page-number sequence is consistent.
7. Not handled (seen): footnotes stay inline where the PDF places them (ResNet footnote 1 followed by figure axis labels `0 1 2 3 4 5 6`); figures contribute stray axis text; TOC pages come out as dot-leader paragraphs (filter lines with 4+ dots; I did this in the S8 code); equations flatten (`softmax( QK T √ dk )V`). Tables flatten into one paragraph per row.

**Scanned PDFs.** Test: `sips` converted a rendered page of the paper to an image-only PDF; `unpdf` returned 0 characters (`scan.ts`: "pages 1 chars 0 chars/page 0") against 2,584 chars/page for the real paper. Rule: after extraction, if total characters per page averages under about 100 (or most pages are under 20), refuse with "This PDF is scanned images with no text layer; Marginalia can't read it yet". OCR is out of scope as asked.

**Hosted parsers (nothing sent).** LlamaParse: "1,000 credits = $1.25", basic parsing "as low as 1 credit" per page, 10K free credits a month (llamaindex.ai/pricing, fetched today); agentic modes cost more, figures not on that page. Mistral OCR: billed per 1,000 pages, rate not shown on mistral.ai/pricing when fetched. Also exist and not priced: Reducto, Unstructured, Adobe PDF Extract. They matter only for scanned files and high-fidelity layout.

**Recommendation.** Use `unpdf` (via `getDocumentProxy`), in a Convex Node action (`"use node"`), not a Vercel route and not the client.
- Why Convex Node: the file is already in `ctx.storage`, the action has 512 MiB and 10 minutes against the 260 MB and 0.7 s measured for a 501-page book, and it sits beside `ingestArticle`. A Vercel route adds a second place holding user files and the Convex key; the client would ship 1.6 MB of pdf.js to every reader and cannot be trusted for the import record.
- Process page by page with `page.cleanup()`; destroy the document at the end; set a page ceiling (for example 1,500 pages) until a larger file has been measured.
- Mark `unpdf` as an external package or let the bundler include it; I could not test an actual Convex push (not allowed), so "bundles and runs inside Convex's esbuild" is unverified. A `bun build --target=node` succeeded at 1.62 MB. Verify with a dev deployment before rung 3b commits to it.
- Storage: Pro Git is 852,211 characters of text and the HTML for it is 912,437 bytes. `ingestArticle` refuses anything where HTML plus text reaches `MAX_STORED_BYTES = 900_000` (`lib/ingest.ts`), so a 500-page book cannot be one `articles` row. Books need their text in sections (a table, or one storage file per book) and an `articles` row that holds only the outline and summary. This feeds S8.

### S8 result (2026-10-16)

**Question.** How should long documents be split, what does indexing a book cost, and how well does searching inside one document find the passages a question needs?

**Setup.** Same sample as S7: Pro Git 2.1.450, 501 pages, extracted with the S7 prototype, TOC pages filtered. 139,495 words, 852,211 characters, 201,335 tokens (js-tiktoken `cl100k_base`, the tokenizer of `text-embedding-3-small`; `lib/s8.ts`). Embedding model in the repo: `text-embedding-3-small`, 1536 dimensions, direct to OpenAI or as `openai/text-embedding-3-small` via OpenRouter (`packages/backend/convex/lib/embeddings.ts#L13-L20`). Annotation today cuts at `MAX_ARTICLE_CHARS = 120_000` (`lib/marginaliaContext.ts#L8`): that is 14% of this book's characters, about the first 2.5 chapters.

**1. Splitting three ways** (sizes in cl100k tokens; `s8.ts`):

| Rule | Units | Median | p90 | Max | Under 100 tok | Over 8,191 | Start mid-sentence (lowercase first letter) |
|---|---|---|---|---|---|---|---|
| Outline depth 0 (22 chapters) | 22 | 5,926 | 21,287 | 46,606 | 4 | 9 | 0 |
| Outline depth 0 and 1 (123 entries) | 123 | 884 | 4,035 | 16,590 | 15 | 2 | 1 |
| Detected headings, every heading | 396 | 272 | 1,151 | 6,776 | 86 | 0 | 50 |
| Detected headings, merge runs under 300 tok | 230 | 650 | 1,598 | 6,776 | 0 | 0 | 14 |
| Fixed 1,000 tok, 100 overlap, raw token window | 224 | 1,000 | 1,000 | 1,000 | 0 | 0 | 153 |
| Fixed 1,000 tok, 100 overlap, paragraph-aligned | 247 | 982 | 1,006 | 1,436 | 0 | 0 | 15 |
| Fixed 3,000 tok, 200 overlap, paragraph-aligned | 74 | 2,995 | 3,022 | 3,038 | 0 | 0 | 4 |

Boundary quality:
- The outline is exact: all 123 entries resolved to a page (0 unresolved), and starts never fall mid-sentence. Its weakness is size: chapters run to 46,606 tokens (Git Tools), and two sections exceed the 8,191-token embedding input limit (the largest is "Git as a Client", 16,590). The 15 sections under 100 tokens are chapter introductions before the first subsection.
- Detected headings found 15 of the 15 chapter starts I checked by page (the other 7 outline chapters are front and back matter), but over-split (396 units, 86 tiny) and some starts are mid-sentence because of false headings. Merging runs under 300 tokens fixes tiny units but still leaves 14 mid-sentence starts.
- Fixed size with overlap: the raw window starts mid-sentence in 153 of 224 chunks; paragraph-aligned fixes that (15 of 247). 10 of 15 chapter starts coincided with a chunk start page at 1,000 tokens and 3 of 15 at 3,000, so fixed chunks routinely straddle chapters. (I did not get a working "chunks spanning two chapters" count; that function was wrong and I discarded its output.)

**2. Cost of indexing** (tokens counted above; prices from developers.openai.com/api/docs/pricing, fetched today: text-embedding-3-small $0.02 per 1M tokens, no batch price listed for embeddings; OpenRouter reported the same rate, `cost: 2e-08` for one token):
- Whole book: 201,335 tokens x $0.02/M = $0.0040.
- With 100-token overlap at 1,000 tokens: 239,740 tokens = $0.0048. Per paragraph (3,341 units over 60 chars): 189,778 tokens = $0.0038.
- Measured: embedding all seven schemes above, 1,333,191 tokens in total, cost $0.02666 on OpenRouter. So one scheme costs about 0.4 to 0.5 cent per 500-page book. Embedding cost is negligible against everything else; do not choose a scheme on cost.
- Units of roughly 650 to 1,000 tokens did best on embeddings (section 3 below). Sizes over 8,191 tokens must be split before embedding or the call fails; I truncated at 8,000 in the test, which scores a 16,590-token section on its first half only.

**3. Retrieval quality.** An OpenAI key was not available ("OpenAI API" in 1Password has empty credential fields; checked field lengths only, nothing printed). The OpenRouter item holds a key, and the app itself supports OpenRouter embeddings, so I used it for the real model, `openai/text-embedding-3-small`, on public text only. 10 hand-written questions against Pro Git, each with a gold phrase from the passage that answers it (found by grep before scoring; e.g. "Do not rebase commits that exist outside your repository" for "Why is rebasing dangerous once other people have my commits?"). A unit counts as a hit if it contains the gold phrase. Questions were worded away from the gold text, but this is 10 questions on one book by one author (me), so treat differences of one question as noise. BM25 is a self-written implementation (`k1=1.2`, `b=0.75`, stopwords, crude stemming). Hits among 10 questions:

| Unit | Units | BM25 top-1 / top-3 / top-5 | Embedding top-1 / top-3 / top-5 |
|---|---|---|---|
| Outline chapters | 22 | 4 / 8 / 9 | 5 / 8 / 9 |
| Outline sections (depth 0 and 1) | 123 | 5 / 8 / 9 | 7 / 8 / 8 |
| Headings merged (300+ tok) | 230 | 6 / 7 / 8 | 7 / 9 / 9 |
| Fixed 3,000 tok | 74 | 4 / 6 / 8 | 2 / 3 / 5 |
| Fixed 1,000 tok | 247 | 2 / 6 / 8 | 6 / 8 / 8 |
| Heading plus ~300-tok paragraph windows | 922 | 4 / 6 / 6 | 6 / 8 / 9 |
| Single paragraphs | 3,341 | 1 / 1 / 2 | 3 / 5 / 5 |

(Paragraphs: 8 of 10 gold phrases fit inside one paragraph, so two questions can never hit there.)

What this shows:
- Embeddings beat or tied BM25 at top-1 for every unit except 3,000-token chunks (2 vs 4), and the gain is largest on small units (paragraph windows 4 to 6, fixed 1,000 from 2 to 6). Top-5 differences are within one question for most rows.
- Structure-aligned sections (outline sections, merged headings) gave the best embedding scores (7 / 8 / 8 and 7 / 9 / 9). Fixed 3,000-token chunks did worst (2 / 3 / 5): a vector over 3,000 tokens averages several topics.
- Per-paragraph search is poor on its own for this test (top-5 of 5 with embeddings). Search a section, then show the passage inside it.
- Two questions are weak in most rows even with embeddings: the stash one ("set it aside" while the passage says "stashing"; section ranks 8 to 10 with embeddings) and the protocols one (ranks 2 to 37 depending on unit). The answer is a sentence inside a section about something else, or uses different vocabulary, so a section vector and BM25 both miss it. Other rows give ranks per question in `lib/eval.ts` output.
- Not measured: whether a cross-encoder or hybrid (BM25 plus embeddings) beats either alone. A reasonable next step, but I have no number for it.

**4. Recommendation.**

*Sectioning rule* (per D-DES-055):
1. If the PDF has an outline with page destinations, use it: depth 0 and 1 entries, text from each start page (matched by heading text on that page) to the next entry. Pro Git resolved 123 of 123.
2. Group consecutive small sections within a chapter into reading units so they are worth offering: with a 1,500-token minimum and 4,000 maximum (never crossing a chapter), Pro Git gives 69 units, median 2,275 tokens (about 1,570 words, about 7 min at `WORDS_PER_MINUTE = 220`, `lib/constants.ts`); 2,500/6,000 gives 49 units, median 3,822 (about 2,640 words, 12 min). Pick the target from the desk's time choices.
3. Split any unit over about 6,000 tokens (2 in Pro Git, up to 16,590) on paragraph boundaries into parts of at most 1,500 to 3,000 tokens, never beyond 8,000.
4. No outline: use detected headings, merging runs under 300 tokens, with the same size caps (S7 heading detection; Pro Git 230 units, 14 mid-sentence starts).
5. Neither: fixed 1,000 tokens (about 700 words) paragraph-aligned with a 100-token overlap, titled "Part N". Never use the raw token window.
6. HTML books (EPUB-like): headings play the outline's role; not measured here.

*What to embed:* the reading unit's text split into passages of about 300 tokens preceded by their heading (the "heading plus paragraph window" row: 6 / 8 / 9 with embeddings, 922 vectors, about 203,600 tokens, $0.004), so a hit points at a passage, and store the passage's section id. Whole-section vectors scored similar or higher in this small test (7 / 8 / 8) and need fewer vectors (123 vs 922; storage and query cost not measured). If rung 3b needs the passage anyway, take the 300-token window and roll up by section. Either choice costs under a cent per book; storage and index size matter more than price. Convex documents are 1 MiB; one vector row per passage fits.

*Storage:* text must live outside the `articles` row (S7: the book's HTML alone is 912 KB against `MAX_STORED_BYTES = 900_000`). Store sections as rows or one file per book; keep the outline, summary and per-section summaries on the article.

*Per-section summaries at import:* one Haiku 5.5 call per reading unit, prices from the claude-api skill model table (cached 2026-10-06): $0.10 in / $0.50 out per 1M tokens for prompts under 100K tokens; Message Batches run at 50% cost. For Pro Git's 123 outline sections: 201,317 input tokens plus about 300 tokens of instructions each (36,900) = 238,000 x $0.10/M = $0.024; output assumed 120 tokens per summary (an assumption, not measured; adaptive thinking on by default for this model could add) = 14,760 x $0.50/M = $0.007. Total about $0.03 for the book, about $0.016 on batch. Chapter summaries and the book's one point are then written from the section summaries (22 chapters x about 150 tokens of input plus a final call): well under a cent more. Together with embeddings the whole import costs about 3 to 4 cents for a 500-page book; the bill is the summary calls, not the vectors. Reasoning: the summaries are small, structured and run once, so use the cheap model, queue them after the book is readable, and let the outline fill in as they land.

*"Next section" for book picks (D-DES-055):* the next reading unit after the last one BK read, in book order, where the reading unit is the grouped unit from step 2 (so "Chapter 4" in the desk copy is shown only when a unit is a whole chapter; otherwise show the unit title and its chapter, "Distributed Git, Contributing to a Project, part 2 of 3 - 12 min"). It is "last read" by furthest scroll position or done flag, not by what BK opened; the minutes shown are `ceil(unit words / 220)`. A unit is offered only when its minutes fit the chosen time, otherwise nothing from that book is offered. Never offer a unit past the next one.

**What is not settled.** Real Convex deploy of `unpdf` (S7). Page-destination matching on PDFs whose outline points at wrong pages or uses named destinations (Pro Git's all resolved). Retrieval on a book that is not technical documentation, and on questions that need several passages. Embedding index size and query latency in Convex's vector index. A hybrid BM25 plus embeddings test.
