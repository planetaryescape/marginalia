# Passage actions by keyboard, and j/k by verse in Bible readings

Raised by the owner on 2026-10-28: "I can keyboard navigate the paragraphs with j/k, would be nice if there was a keyboard shortcut to bring the context menu that has ask explain etc for the selected passage and then after that if the options on that menu were single key shortcuts. j/k should move one verse at a time for bible readings."

## What exists (read at 59ac31d; the code cited is unchanged at 0816ca1)

- **j and k** move a paragraph cursor. `moveParagraph` in `apps/web/src/app/read/[articleId]/page.tsx` focuses the paragraph and marks it `data-keyboard-cursor`. Bible readings use the same paragraph blocks.
- **Single-key passage actions already exist** without the menu: `a` Ask, `e` Explain, `s` Simplify, `d` Define, `h` Highlight, `p` Pen-mark (`SHORTCUTS` in `apps/web/src/components/selection-toolbar.tsx`). Each acts on the selection, or else on the paragraph at the cursor. They are listed in the shortcut help under Reading.
- **The Passage actions menu** opens only for a mouse or touch selection. In the menu, keys appear only in hover tooltips (`title="Explain (E)"`). Add note, Deep study, Copy and the colour pickers have no key.
- **Bible verses** are `[data-usfm]` spans inside those blocks, and a verse can cross a block (`apps/web/src/lib/bible-display.ts`).

## What's wanted

1. **Open the menu by key.** One key opens Passage actions on the paragraph, or verse, at the cursor, so every action is reachable without a pointer. Enter is the candidate, because a focused paragraph has no other Enter action.
2. **Show each action's key in the menu.** Show it beside the label, not only in a tooltip, and add keys for the actions that lack one: Note, Deep study and Copy. Choose them so they don't clash with the reading keys `n`, `o`, `r`, `v`, `u`, `l` and `,`. Inside the menu the keys can be menu-local, because the menu owns the keyboard while open.
3. **j/k by verse in Bible readings.** The cursor moves one verse at a time and marks the verse's text range. It isn't a focused element, because verses cross blocks. The passage keys and the menu then act on that verse.

## Open questions

- Which key opens the menu: Enter, `m`, or `.`?
- Should a verse cursor that crosses a block boundary scroll to the verse's start or to its middle?
