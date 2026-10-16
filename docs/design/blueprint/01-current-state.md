# 01: Current state

Audited on 2026-10-16 against the live app at https://reader.bhekani.com, built from origin/main `bc23f5e`. The audit was signed in as the owner, using the Night theme at 1440×900 and 390×844. Code references are at the same SHA. The screens are described in words only, because the repo is public and the live library is personal (D-DES-016).

The short version: the parts are good and the whole is unplanned. The typography and palettes would survive a design team's review. The hierarchy, the use of colour, the margin and the navigation would not.

## What already works

Keep these. The redesign builds on them (D-DES-017).

- **Type.** Newsreader at display sizes ("How much time do you have?", "Ask your library") gives the app its character. DM Sans for controls and JetBrains Mono for keys are well chosen. Fonts are self-hosted through `next/font`.
- **Palettes.** Six reader themes (`paper`, `night`, `sepia`, `snow`, `dusk`, `ink` in `globals.css`). Night is a warm near-black (`#201d1b`), not blue-black, which suits long reading.
- **The question on Home.** Opening with "How much time do you have?" is the right idea: the desk asks one human question.
- **The margin card.** Clicking an annotation in the reader opens a card in the right margin, tied to its line by a thin connector, with a category dot, a paragraph tag and the quoted line (`margin-card.tsx`). This is the best moment in the app and the seed of the concept.
- **The paragraph map.** A minimap of the article on the left, with annotation dots. It's quiet, useful and original.
- **"Before you go".** The end of an article has a strongest point, a weakest assumption, a counterview and a question for the reader. It's good back matter.
- **Floating controls in dark themes** were fixed on 2026-10-15 (`.reader-float`), after BK found them "a bit jarring" (D-DES-007).

## What's wrong

### The margin is empty, and the product is named after it

At 1440 px the article column ends near x=1030, leaving about 400 px of margin. Annotations appear in the text as underlines plus superscript numbers. A margin card opens only on click, one at a time, and the margin is blank the rest of the time. A reader who doesn't click never meets the companion, and the companion is the product. (D-DES-019)

### Everything on Home has the same weight

Above the fold at 1440×900 there are:

- the date line
- the headline
- four boxed time cards, each with a keycap
- the search field
- a Continue reading card
- a Worth revisiting card with a Not now button
- the Up next list with `j`/`k` keycaps
- three timeline sections in the right column (From your notes, Recently rated, Where it comes from)
- a shortcut hint

That's about twelve blocks, most of them boxed, at similar contrast. The eye has nowhere to land after the headline. (D-DES-002, [04](04-desk.md))

### Choosing a time leaves the desk

Choosing a time card pushes `/session/<id>?m=<minutes>`. That page sits outside the desk frame, with no header and no navigation. It shows one suggestion at a time in a centred card with a reason line and three buttons. It's styled with the legacy `ink`/`parchment` classes (`bg-white dark:bg-ink-900`), not the theme tokens, which `apps/web/DESIGN.md` says not to do. So in Sepia, Dusk or Ink it doesn't match the theme around it. The desk's core action hands off to a page that looks like another app. (D-DES-028, [04](04-desk.md#choosing-time))

### Keycaps are painted everywhere

There are nine keycaps on Home: `1`–`4`, `/`, `c`, `j`, `k` and `?`. The keyboard map is a real feature (D-DES-004), but showing it constantly makes the desk look like a cheat sheet. (D-DES-021)

### The pen colour paints the interface

`--pen` (cobalt by default, `#7d9cf5` in dark) is the reader's own marking colour. It also colours:

- prose links (`--tw-prose-links: var(--pen)`)
- the drop cap
- Library's rating marks (`RatingMarks` in `library/page.tsx`)
- the Continue reading label and progress bar, the time cards' hover ring, and the hover colour of every title on Home (`(desk)/page.tsx`)
- "Poll now" and "Sync now" on Sources (`feeds/page.tsx`, `readwise-card.tsx`)

Altogether `--pen` appears in about 25 files. The reader's highlights and notes can't stand out from the chrome. The four annotation colours (slate, sage, terracotta, purple) compete with the same blue. (D-DES-020)

### Chrome has grown by accretion

- **Desktop header:** six text links (Library, Notes, This week, Saved · n, Sources, Readers) and four icons (account, GitHub, install, keyboard).
- **Reader toolbar:** six icon buttons at equal weight: notes, re-annotate, rate, love, GitHub, reading settings. Two of them aren't reading tools.
- **Phone bottom bar:** seven tabs (Home, Library, Notes, Activity, Saved, Sources, Readers). `site-header.tsx` already drops labels on the smallest phones because they don't fit.

(D-DES-022, D-DES-023, D-DES-024)

### One idea has several names

- "Pieces" (Home), "articles" (Saved), "fit" (time cards).
- "This week" (desktop) vs "Activity" (phone) vs "Reading activity" (page title).
- "Saved" vs "Loved" vs "Your impressions".
- "Sources" in the nav vs `/feeds` in the URL.

A product designed as a whole uses one word per idea everywhere ([02](02-design-concept.md#the-mental-model)).

### Collection pages are boxes in two thirds of the page

Notes, Saved, Sources and Account cap content at about 770 px and leave the right third empty; only Library uses it. Every item sits in a bordered card, so a page of five notes is five boxes. Notes doesn't tell the reader's own words apart from saved AI answers: both sit in the same card at the same weight.

### Controls have no shared language

On Sources and Account alone there are seven button styles:

- a text link ("Poll now")
- an icon with a link ("Sync now")
- filled grey ("Add")
- outlined ("Connect")
- a dashed drop zone ("Import OPML file")
- solid white ("Add a passkey")
- a bare "×" glyph for remove

Primary, secondary and destructive actions aren't distinguishable by look. ([02](02-design-concept.md#shared-patterns), [06](06-sources-and-settings.md))

### Rating drifted from stars to squares

BK asked for visible stars with labels (D-DES-005). The reader's impression panel uses `Star` icons, but Library's impressions column draws five small squares.

### Small breakages at the end of an article

- At 1440×900, scrolled to the end, the floating "Ask about this article" pill sits over the Done button beneath the reflection box.
- The top progress bar stayed at about a fifth of the width after an automated scroll to the end. This may be an artifact of the automation, so it's a spike (S4), not a finding.
- In the reader's Notes panel, the focused "+ New" button shows a square white outline that ignores the quiet-focus rule.

## Side effect of the audit

Opening an already-read article to audit the reader recorded a visit, which moved that article into Home's Continue reading slot. No other data was written.
