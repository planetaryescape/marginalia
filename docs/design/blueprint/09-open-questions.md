# 09: Open questions and spikes

## Spikes (run against the real app before the rung that needs them)

For each spike, record what was tried, the result, the date and the conclusion under a `### Sn result (<date>)` heading here. Then update the document it affects.

| # | Question | Why it matters | Affects | Blocks |
|---|---|---|---|---|
| S1 | Can the View Transitions API morph an article title from a desk row into the reader heading in Next.js App Router? What happens in Safari and in the installed PWA, and what is the fallback when it's unsupported? | The desk-to-reader hand-off is the moment that makes the app feel fast and whole (D-DES-009). | [02](02-design-concept.md#motion), [04](04-desk.md) | Rung 7 |
| S2 | Margin layout under load: with every annotation shown as a sidenote, how are collisions resolved at 1280 px and 1440 px, how much reflow and scroll jank does a 100+ paragraph article cause, and does in-flow unfolding on a phone keep the reading place? | Sidenotes are the concept's main bet (D-DES-019, D-DES-026). A crowded or janky margin defeats it. | [03](03-reader.md#the-margin) | Rung 2 |
| S3 | Does prefetching `suggestions.forWindow` on hover or focus of a time choice bring perceived wait under 150 ms? Is a layout skeleton better than the current loader for the first sign-in load? | Choosing time is the desk's core action. The 2026-10-15 pass measured 0.47–1.1 s per window. | [04](04-desk.md#choosing-time) | Rung 3 |
| S4 | When scrolled to the end of an article at 1440×900, does the top progress bar reach the end? In the 2026-10-16 audit it stayed at about a fifth of the width after an automated scroll. It may be an artifact of the automation. | If it's real, the finishing moment is broken. If not, no action. | [03](03-reader.md#finishing) | Rung 1 |

## Product questions for BK

| # | Question | Status |
|---|---|---|
| Q1 | Is "Print, pencil and pen" the concept? The author speaks in print, Marginalia in pencil, you in your own pen. Or is there a different idea of what Marginalia is to you? | Answered by BK 2026-10-16: yes, "Print, pencil and pen" (D-DES-029) |
| Q2 | Which reading products or physical objects do you admire, and for what? No references were recorded. | Answered by BK 2026-10-16: Tufte / gwern.net sidenotes, iA Writer and Things 3. Readwise Reader stays the dense counterexample (D-DES-029) |
| Q3 | Navigation: three rooms (Desk, Library, Notes), with Saved as a Library shelf and This week as Notes → Your week? | Open; blueprint assumes yes (D-DES-024) |
| Q4 | Sources, Account and Readers grouped as Settings behind the account menu? | Open; blueprint assumes yes (D-DES-025) |
| Q5 | On a phone, should a margin note unfold under its paragraph instead of opening a bottom sheet? | Open; blueprint assumes in-flow, pending S2 (D-DES-026) |
| Q6 | On wide screens, should margin notes always show as quiet sidenotes, or stay hidden behind markers until you click? | Open; blueprint assumes always shown, quietly (D-DES-019) |
| Q7 | Should the interface stop using your pen colour for links, buttons, drop caps and progress, so the pen colour only marks your own highlights and notes? | Answered by BK 2026-10-16: yes (D-DES-029) |
| Q8 | Hide keycap hints by default (`?`, tooltips and holding a modifier reveal them)? | Open; blueprint assumes yes (D-DES-021) |
| Q9 | Remove the GitHub link from the header and the reader toolbar? | Answered by BK 2026-10-16: yes; it moves to the account page footer (D-DES-029) |
| Q10 | The decorative drop cap is on by default (`dropCap: "text"` in `@planetaryescape/reader`) and drawn in the pen colour. Should it default to off, or be drawn in ink? | Answered by BK 2026-10-16: drawn in ink, on by default, kept as a reader setting (D-DES-029) |
| Q11 | Move "Re-annotate with latest vault" into the article's overflow menu? | Answered by BK 2026-10-16: yes (D-DES-029) |
| Q12 | When you choose a time, should the pick appear on the desk itself instead of on a separate full-screen page? | Open; blueprint assumes yes (D-DES-028) |
