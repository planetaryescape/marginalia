# Web design conventions

This records the shipped visual system. It is the reference for new screens; change it in the same commit as the code it describes. The concept behind it is in `docs/design/blueprint/02-design-concept.md`. Home is an operating surface; article pages are reading surfaces.

## Layout

All primary destinations live under `src/app/(desk)`. Its layout owns the viewport-height frame, shared header, theme and mobile navigation. Content scrolls in the middle region; the header does not disappear. The desk fits one screen at the tested sizes; collection pages may be longer. The reader is a separate route outside that frame, with its own toolbar and a configurable text measure.

Align desk pages to a maximum width of `1180px`, with `20px` horizontal padding on small screens and `40px` from the medium breakpoint. Settings pages (Sources, Account, Readers) use `SettingsPage`: one 680px column, a "Settings · Page" eyebrow, sections separated by a hairline and 48px, not cards.

## Type

Newsreader (`font-serif`) is for print and headings: article text, the desk question, room titles, article titles in rows. DM Sans (`font-sans`) is for controls, meta, margin notes and reasons. JetBrains Mono is for keycaps only. Literata and Atkinson Hyperlegible are reader options, and decorative drop caps are reader settings. Fonts are self-hosted by `next/font` and exposed as `--font-*` variables.

There are no `--type-*` tokens. Sizes are set in place and should match their neighbours: desk title `text-[clamp(2.5rem,6vw,4.5rem)]` light; pick title 24px, 30px from `lg`; section heading 22px; controls 14.5px; meta 13.5px; labels 11.5px uppercase with `0.08em` tracking. Article body size, measure and leading are reader settings.

## Colour

The source of truth is `src/app/globals.css`. Each reader theme (paper, night, sepia, snow, dusk, ink) sets the `--reader-*` values on `html[data-reader-theme=…]`, which outranks the package's attribute-only selectors in `@planetaryescape/reader/reader.css`. Components use these names, not raw colours.

| Token | Use |
| --- | --- |
| `--reader-bg`, `--reader-surface`, `--reader-chip` | Page, raised content and quiet control or hover backgrounds |
| `--ink` (`--reader-fg`), `--ink-soft`, `--ink-muted` | Print and chrome text, secondary text, meta |
| `--reader-border`, `--reader-border-strong` | Hairlines and control boundaries |
| `--reader-focus` | Neutral visible keyboard focus |
| `--pencil`, `--pencil-rule` | Marginalia's voice (margin notes, reasons, answers) and its rules and connectors |
| `--pen`, `--highlighter` | The reader's chosen colours: their own marks only |
| `--kind-*` | Margin-note kind dots, lightened in the dark themes |
| `--danger` | A failure dot and the confirming half of a destructive action |

The colour rule is that colour belongs to a hand. Ink is the author and the chrome, pencil is Marginalia, and the reader's pen and highlighter colours appear only on the reader's own marks: highlights, underlines, the margin tick beside them, their rating and love. Nothing else is pen-coloured, links included. Check `--pencil` and small text at 4.5:1 against `--reader-bg` and `--reader-surface` in every theme (`src/app/theme-contrast.test.ts`).

Controls floating over the page use `.reader-float`: an ink pill on light themes, a raised surface on dark ones.

## Control roles

Settings controls come from `src/components/settings-controls.ts`, not ad hoc styles:

- `primaryControl`: one per section at most, the action the section exists for.
- `quietControl`: everything else that acts (Check now, Pause, Copy).
- `destructiveControl`, then `confirmControl`: Remove and its confirmation, in place ("Remove this feed? Remove · Keep").
- `textControl`: inline underlined links such as "Details".
- `fieldControl`: text fields.
- `settingsRow`: a hairline-separated list row.

On the desk, the primary action is a solid ink button, Another is a chip, and the rest are quiet underlined text. Use native buttons, links and inputs, and native dialogs for the search picker and protected-focus panels (`useModalDialog` owns Tab containment and focus restoration). Global shortcuts pause while typing or while a modal is open. A button names its action even when it shows only an icon, and delete controls work from keyboard and touch, not just hover.

## Shared patterns

A new feature reuses these.

- **Saved:** saving is silent and immediate. `SavedMark` (`src/components/in-place.tsx`) fades in at the control that changed, holds 1.6 s and fades away, with no toast. Where the result stays true (a saved article) it holds.
- **This changed:** `ChangeWash` gives a changed row a `--reader-chip` tint for 600 ms (`useChangeWash` in `src/lib/use-timed-flag.ts`). A value present on first render does not wash.
- **Errors:** `InlineError` puts one sentence and Retry where the action was, with a `--danger` dot. The page around it keeps working. Toasts are for background work with no place on screen, and for Undo.
- **Waiting:** a skeleton in the shape of the real layout, never a centred spinner. The pick's skeleton appears after 150 ms.
- **Destructive:** a quiet button that turns into a confirmation in place.

## Motion

Motion explains a change of place or state and never decorates. The tokens in `globals.css` are the only durations to use:

| Token | Time | Easing | Used for |
| --- | --- | --- | --- |
| `--motion-press` | 90 ms | ease-out | Button and row press |
| `--motion-quick` | 160 ms | `cubic-bezier(0.2, 0.8, 0.2, 1)` | Menus, dimming siblings, the pen tick |
| `--motion-move` | 240 ms | same | Margin notes, a pick sliding in, the reader body arriving |
| `--motion-page` | 320 ms | `cubic-bezier(0.4, 0, 0.2, 1)` | Desk and reader transitions, the title morph |
| `--motion-sweep` | 180 ms | linear | The highlighter sweep |

`--page-duration`, `--page-ease` and `--sweep-duration` are the bare values, for delays and View Transition group durations. Nothing bounces or glows.

**Desk and reader** use React's `<ViewTransition>` through `src/components/view-transition.tsx`, with no hand-written `startViewTransition`. The App Router bundles the React canary that exports it; the wrapper renders its children unchanged where it is missing, and a browser without View Transitions swaps instantly. Navigations carry a type (`open-article`, `finish-article`) that `globals.css` matches with `:active-view-transition-type()`.

- *Opening.* The desk title and the reader heading share the name `article-title-<id>` (`articleTitleName`). The desk writes the title to `src/lib/title-handoff.ts` when Read now is pressed, and the reader draws its heading from that map (`ReaderOpening`) in the same commit, so the morph has a destination while the body loads. A reload or deep link has no map entry and gets no morph. The desk dissolves, the toolbar (its own named group, above the title) fades in, then the body fades in. Only one element per id may be named at a time.
- *Finishing.* Done marks the article finished and pushes the desk with `finish-article`: the reader cross-fades to the desk over `--motion-page`, then the slot slides its next pick in by 16 px (`data-arrival="finish"`).
- *Highlighting.* `src/lib/highlight-sweep.ts` draws throwaway bars in `--highlighter` over a new highlight, line by line in proportion to length, in 180 ms linear. The saved mark is a CSS custom highlight and cannot animate, so the bars hand over to it. The pen tick (`.sidenote-tick`) then fades in.
- Keep `::view-transition { pointer-events: none }` and keep named elements to the title and the toolbar, since named elements are skipped by hit-testing during a transition.

**Reduced motion.** Every motion has a `prefers-reduced-motion: reduce` form, tested in `src/app/motion.test.ts`. Opening is an instant swap with the body fading in over 120 ms. Finishing is a 120 ms cross-fade, and the next pick fades in without sliding. The sweep becomes the final highlight and the tick appears at once. Saved fades in and out over 120 ms. The change wash holds for 600 ms and clears over 120 ms. Errors cross-fade over 120 ms. Nothing the reader needs is hidden behind an animation that has not finished.

## Verification

Before shipping, inspect desktop and mobile together, exercise loading, empty and error states, audit contrast and control names, and inspect the browser console. Perform each motion by hand with reduced motion on and off. The source tests cover behaviour; they do not substitute for rendered layout checks.
