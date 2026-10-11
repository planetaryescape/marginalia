# Web design conventions

Preserve the app's existing reading-desk identity. This is a record of the shipped visual system, not a new design proposal. Home is an operating surface; article pages are reading surfaces.

## Layout

All primary destinations live under `src/app/(desk)`. Its layout owns the viewport-height frame, shared header, theme and mobile navigation. Content scrolls in the middle region; the header does not disappear. Home deliberately fits one screen at the tested sizes, while collection pages may be longer.

Align desk pages to a maximum width of `1180px`, with `20px` horizontal padding on small screens and `40px` from the medium breakpoint. Collection headings use `DeskPage`; Library keeps its conversation/sidebar composition. Article reading remains a separate route with reading-specific controls and a configurable text measure.

Verify by navigating **Home → Library → Notes → This week → Saved → Sources** at desktop and mobile widths. Do not duplicate headers inside these pages.

## Type and colour

Use Newsreader for article text and expressive headings, DM Sans for controls and metadata, and JetBrains Mono for keycaps. Optional reading faces include Literata and Atkinson Hyperlegible; decorative drop caps are reader settings, not navigation decoration. Fonts are self-hosted by `next/font`.

The source of truth is `src/app/globals.css`:

| Token | Use |
| --- | --- |
| `--reader-bg`, `--reader-surface`, `--reader-chip` | Page, raised content and quiet control backgrounds |
| `--reader-fg`, `--reader-fg-soft`, `--reader-muted` | Main, secondary and metadata text |
| `--reader-border`, `--reader-border-strong` | Dividers and control boundaries |
| `--reader-focus` | Neutral visible keyboard focus |
| `--pen`, `--highlighter` | User-chosen marks and emphasis |

Keep new reader surfaces on these tokens rather than mixing legacy `ink`/`parchment` classes with the selected theme. Annotation category colours retain their semantic distinctions. Check contrast on both the page and raised surfaces; small text still needs 4.5:1.

## Interaction

Use native buttons, links and inputs. Use native dialogs for the search picker and protected-focus panels; `useModalDialog` owns Tab containment and focus restoration. Global shortcuts pause while typing or while a modal is open.

Opening a note editor focuses it. Saves debounce after typing, flush on blur/close, and keep a failed draft open for Retry. Search work is cancellable. A button must name its action even if it displays only an icon. Delete controls must be available to keyboard and touch users, not just hover.

Test the full path with `/`, arrows, Enter, `n`, Tab and Escape. Preserve the default focus indicator instead of removing it for visual neatness.

## Motion and verification

Keep motion subordinate to reading. Honour reduced-motion preferences, avoid hiding required content behind unfinished entrances, and do not add animation just to advertise polish.

Before shipping, inspect desktop and mobile together, exercise loading/empty/error states, audit contrast and control names, and inspect the browser console. The source tests cover behaviour; they do not substitute for rendered layout checks.
