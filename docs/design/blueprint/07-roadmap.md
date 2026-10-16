# 07: Roadmap

## Build philosophy

- Skateboard → scooter → bicycle → motorbike → car. Each rung is a working, deployed Marginalia that BK uses the same day and that feels better in one way he'd notice.
- Each rung fits one working session and ships to https://reader.bhekani.com through `docs/operations.md`. Frontend-only rungs deploy with Vercel. A rung that touches Convex takes a snapshot first and needs BK's approval before the backend deploy.
- At most two new unknowns per rung. A rung that needs a third is split.
- Stop after any rung and the app is whole: no half-migrated screens, no two button systems on one page.
- A rung added later gets a letter (3b), so cited numbers keep their meaning.
- "Tests pass" is required but never enough on its own. "It behaves as specified" isn't enough either. A rung is done when it passes the design gate in [02](02-design-concept.md#the-design-gate) (D-DES-027).
- Every rung starts with a comp or HTML prototype of its screens and moments, in Night and Paper at 1440×900 and 390×844, approved by BK before code.

## Phase 0: answers and spikes (before any UI code)

| # | Action | Needed by |
|---|---|---|
| A1 | BK answers Q1 (the concept), Q7 (pen only for the reader's marks) and Q2 (references) | Rung 1 |
| A2 | BK answers Q6 and Q5 (sidenotes always shown; phone in-flow) | Rung 2 |
| A3 | BK answers Q8, Q12 and Q13 (keycaps hidden; the pick on the desk; Up next off the desk) | Rung 3 |
| A4 | BK answers Q3, Q4 and Q9 (three rooms; settings behind the avatar; GitHub link moves) | Rung 4 |

Spikes from [09](09-open-questions.md): S4 before rung 1, S2 before rung 2, S3 before rung 3, S1 before rung 7.

## Rung 1: Skateboard: "My pen is mine again, and the reader gets out of the way"

**Previously:** the pen colour paints links, drop caps, progress, hovers and settings actions. The reader toolbar has six equal icons, including GitHub and Re-annotate. The Ask pill covers Done at the end.
**Now:** the pen colour appears only on the reader's own marks. The reader toolbar is ← Desk, Aa, ★, ♡ and ⋯, and it fades while reading. The end of the article is clean.

**Promise:** "When I read, the only colour on the page is mine, and nothing sits on top of the text."

**Build:**
- Add the token layers from [02 Visual language](02-design-concept.md#visual-language) to `globals.css`: `--ink*`, `--pencil`, `--pencil-rule`, kind colours, `--danger`, type and motion tokens. Check `--pencil` contrast in all six themes.
- Replace chrome uses of `--pen` with ink or pencil across the about 25 files that use it ([01](01-current-state.md#the-pen-colour-paints-the-interface)). Keep the reader's marks and the pen settings swatches.
- Reader toolbar per [03 Toolbar](03-reader.md#toolbar), including the time-left tooltip on the map (D-DES-022, D-DES-023).
- The Ask pill hides while the back matter is in view ([03](03-reader.md#ask-about-this-article)). Quiet focus on "+ New".
- Run S4. Fix the progress line if it's real.

**Design:** reader screens in all themes. Key moments: opening, finishing (static part). This rung sets the colour rule every later rung follows.

**New unknowns:** contrast of `--pencil` across six themes; whether toolbar fade fights the reader package's own controls.

**Demo:** open an annotated article in Night on desktop and phone. Highlight a passage and see that it is the only saturated colour on screen. Scroll and see the toolbar fade, then scroll up and see it return. Reach the end and press Done without anything covering it.

**Done when:**
- `grep` shows `--pen` used only for marks, the pen and highlighter settings and the reader's notes.
- The design gate passes for the reader in all six themes at both widths.

**Left out:** the margin itself, the desk and navigation.

## Rung 2: Scooter: "The margin talks"

**Previously:** margin notes hide behind underlines and superscript numbers, and one card opens on click.
**Now:** on wide screens, every margin note sits in the margin beside its line in pencil. The reader's own notes and marks show as pen ticks. On a phone, notes unfold under their paragraph.

**Promise:** "I see what Marginalia noticed as I read, without clicking anything, and it never gets in the way of the text."

**Build:** [03 The margin](03-reader.md#the-margin): sidenote layout with collisions and elbows, open-in-place cards, arrival motion, "Reading alongside you…" while annotation runs, pen ticks, phone in-flow unfolding (D-DES-019, D-DES-026). Remove the underline and superscript treatment on wide screens.

**Design:** comps of a heavily annotated article at 1280 px and 1440 px, and a phone with a note unfolded. Key moments: a margin note arriving, waiting on model work, asking.

**New unknowns:** S2 (collision layout and performance); in-flow unfolding versus the reading position on a phone.

**Demo:** open the most annotated article in the library. Scroll and watch notes arrive. Open one, read it, Esc. Repeat on a phone.

**Done when:**
- No overlapping notes at 1280 px or 1440 px on the S2 article.
- Scrolling stays smooth on that article (no long tasks over 50 ms while scrolling in a performance trace).
- The design gate passes, including journey 1 from opening to the end.

**Left out:** Explain, Define and Ask answers move into the margin in rung 2b if the open-in-place card can't take them in this session.

## Rung 3: Bicycle: "The desk asks one question and answers it"

**Previously:** about twelve equal-weight blocks and nine keycaps. Choosing a time leaves the desk for a differently styled page.
**Now:** the question, one slot, four numerals, search and three rows. Choosing a time fills the slot with a pick and its reason, usually within 150 ms.

**Promise:** "I open Marginalia, say how long I've got, and there's the thing to read."

**Build:** [04](04-desk.md) in full: hierarchy, time choices, the pick in the slot (D-DES-028), prefetch on intent (S3), Continue, Up next rows, empty and error states. Keycaps hidden, with the hold-`Alt` overlay and tooltips (D-DES-021). The right-hand column removed.

**Design:** desk comps at both widths. Key moments: first open, choosing time, empty.

**New unknowns:** S3 (prefetch effect); the hold-to-reveal keycap overlay.

**Demo:** cold open the desk. Choose 10, press Another twice, press Read now. Then Esc from the reader back to the desk.

**Done when:**
- The pick appears without a route change, within 150 ms with a warm prefetch, measured on the deployed app.
- The design gate passes for journeys 1 and 2.

**Left out:** the title morph into the reader (rung 7).

## Rung 4: Motorbike: "Three rooms"

**Previously:** seven destinations, and eight tabs on a phone.
**Now:** Desk, Library and Notes in the header. Library has shelves (Up next, Saved, Loved, Finished) and stars. Sources, Account and Readers are behind the avatar menu, which also shows source status.

**Promise:** "I know where everything is, and the things I do every day are the only things I see."

**Build:** [05 Library](05-library-notes-week.md#library) and [06 The avatar menu](06-sources-and-settings.md#the-avatar-menu). Header and phone bar per [02 The map](02-design-concept.md#the-map). Redirects for `/saved`. Stars instead of `RatingMarks`. One word per idea across UI copy ([02 The mental model](02-design-concept.md#the-mental-model)). Update `docs/reader-guide.md` and `docs/mobile-and-pwa.md` for the new map.

**Design:** comps of the header, phone bar, avatar menu and Library. Walk all five journeys across the new map.

**New unknowns:** the redirect and keyboard map changes (`g s`, `g w`); the phone bar with a Search slot.

**Demo:** from the desk, reach Saved, a loved article, Sources and Readers. Do it on a phone too.

**Done when:**
- Old URLs and shortcuts still land somewhere sensible.
- The design gate passes for journeys 3 and 5.

**Left out:** the Notes rework (rung 5) and the settings form pattern (rung 6).

## Rung 5: "Notes is my commonplace book"

**Previously:** notes and saved AI answers in identical boxes, marks invisible outside the reader, and This week a separate page of counters.
**Now:** your words lead, AI answers collapse, your highlights appear under their article, and Your week opens with one sentence about the week.

**Promise:** "Everything I kept from my reading is in one place, in my own hand."

**Build:** [05 Notes](05-library-notes-week.md#notes) and [Your week](05-library-notes-week.md#your-week). The paginated highlights query (backend: snapshot plus BK's approval). Clicking a note opens its line with the note open in the margin. `/reading` redirects to Your week.

**New unknowns:** the cost of the highlights query; restyling the rhythm chart under the `dataviz` rules.

**Demo:** highlight a line in an article, then find it in Notes. Open it and land back on the line.

**Done when:**
- Journey 4 ends in Notes and returns to the line.
- The design gate passes.

**Left out:** search within Notes (the picker already searches notes).

## Rung 6: "Settings are quiet"

**Previously:** seven button styles, cards around every section, and technical counts on the surface.
**Now:** one form pattern and five control roles. Details sit behind "Details ▸".

**Promise:** "I set things up once, and when something breaks I see it on the avatar."

**Build:** [06](06-sources-and-settings.md) for Sources, Account and Readers. The failure dot on the avatar.

**New unknowns:** none beyond restyling. Keep it to one session.

**Done when:**
- Only the five control roles appear on settings pages.
- The design gate passes for journey 5.

## Rung 7: Car: "It flies"

**Previously:** pages swap and finishing is a toast-less jump.
**Now:** the title travels from the desk into the reader. Finishing turns the page back to the desk, where the next pick slides in. The highlighter sweeps. Every motion has a reduced-motion form.

**Promise:** "Moving through Marginalia feels like one continuous thing, and it's instant."

**Build:** S1 then View Transitions for desk ↔ reader, with the motion tokens from [02 Motion](02-design-concept.md#motion) applied everywhere. A last pass over all key moments. Rewrite `apps/web/DESIGN.md` to record the shipped system, since it describes the current one.

**New unknowns:** S1 (View Transitions in App Router, Safari and the PWA).

**Demo:** journey 1 end to end on desktop and phone, with reduced motion on and off.

**Done when:** every key moment in [02](02-design-concept.md#key-moments) is performed on the deployed app and feels as described.

## After the car (not planned yet)

- An offline reading design, if offline reading is ever taken on (`docs/limitations.md`).
- Sharing a margin note or a passage with its pencil note as an image.
- A reading-lamp theme that warms with the time of day.
