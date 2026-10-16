# 00: Overview

## What this blueprint is

Marginalia works. It imports articles from feeds, Readwise Reader, pasted links and an API. It writes AI margin notes against the reader's own notes, picks articles for a time window, and keeps highlights, notes, ratings and reading activity. What it lacks is design: a single idea of what the product is, a hierarchy on each screen, and one way of doing each thing. BK, 2026-10-16: "focus on the design aspect. The functions but i don't think the design was considered" (D-DES-001).

This blueprint designs the product around the functions that exist. It covers the concept, the map, the journeys and each screen's look and feel, in rungs that each ship to https://reader.bhekani.com. It changes behaviour only where the design needs it, and names each change (D-DES-015).

## Who it's for

The first user is BK, who reads in the Night theme on a desktop and on his phone. Marginalia also has invited readers, each with their own library (`docs/multi-user-plan.md`). The design serves a reader with a mixed library of feeds and saved articles, a vault of notes behind the margin, and gaps of 5 to 30 minutes to read in.

## What it should feel like

Reading a good book that a well-read friend has already been through with a pencil. The author's text is untouched and central. Quiet pencil notes sit in the margin beside the lines they're about, and the reader's own pen marks are the most vivid thing on the page. It's fast enough that "I have ten minutes" turns into reading within a second (D-DES-009), and calm enough that nothing asks for attention except the next good thing to read. The full concept is "Print, pencil and pen" in [02](02-design-concept.md) (D-DES-018, Q1).

## Principles

1. **The page is the hero.** Nothing covers the text except a menu the reader asked for. The reader spends hours on this screen.
2. **Colour belongs to a hand.** Ink for print and chrome, pencil for Marginalia, pen for the reader (D-DES-020). If everything is coloured, the reader's marks can't stand out.
3. **Beside the line, or at the ends.** Notes about a passage sit in the margin next to it; notes about the whole article sit before or after it (D-DES-019). That's where a reader looks for them.
4. **One question per screen.** Each room has one primary action. Equal weight is what makes today's screens busy ([01](01-current-state.md#everything-on-home-has-the-same-weight)).
5. **Calm by default, detail on demand.** Keycaps, counts and sync detail are one gesture away (D-DES-021). The keyboard stays complete (D-DES-004).
6. **Instant is a feeling.** The real layout responds within 100 ms. A loader is a design failure (D-DES-009).
7. **Settings are boring on purpose.** One form pattern, so the personality goes to reading (D-DES-025).
8. **Keep what works.** Themes, type, the shared reader package and the annotation colours stay (D-DES-017). The audit found them to be the app's strongest parts.

## Scope

- **Design concept and tokens:** the type scale, the colour layers (`--ink`, `--pencil`, `--pen`, kind colours), motion tokens, control roles. See [02](02-design-concept.md).
- **Reader:** margin sidenotes, toolbar, front and back matter, passage menu, notes panel, finishing, phone flow. See [03](03-reader.md).
- **Desk:** hierarchy, time choices, the pick on the desk, Continue, Up next, empty and error states. See [04](04-desk.md).
- **Rooms:** Library with shelves, Notes as the commonplace book, Your week. See [05](05-library-notes-week.md).
- **Settings:** the avatar menu, one form pattern, Sources, Account, Readers. See [06](06-sources-and-settings.md).
- **Platforms:** the desktop web app and the phone PWA, in all six themes.

## Non-goals

- New features (D-DES-001). Vault sync from GitHub, splitting heavy article fields and the other performance steps proposed on 2026-10-15 are separate work.
- A data migration, or replacing saved notes, marks or history (D-DES-013).
- A new type family or palette (D-DES-017).
- Offline reading (`docs/limitations.md`). Deferred, not rejected.
- Native apps. The phone stays a PWA (D-DES-011).

## Glossary

The full word list, with what each replaces, is in [02 The mental model](02-design-concept.md#the-mental-model).

| Term | Meaning |
|---|---|
| Print | The author's text and anything that is the article itself |
| Pencil | Marginalia's voice: margin notes, reasons, answers |
| Pen | The reader's own marks and words, in their chosen pen colour |
| Sidenote | A margin note shown beside its line on wide screens |
| Front matter / back matter | The summary above the text; "Before you go", impression and Done below it |
| Rung | One shippable step on the [roadmap](07-roadmap.md) |
| Design gate | The checks in [02](02-design-concept.md#the-design-gate) that a rung must pass besides tests |
