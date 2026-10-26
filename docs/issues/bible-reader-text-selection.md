# Dragging does not select words in the Bible reader

Status: open. Reported 2026-10-26 against the reader deployed from `ce31fa3` / documentation baseline `268ed8d`.

The reader reported that dragging across passage words does not select them. This is before choosing **Highlight**, not a report that an otherwise working Highlight save disappears. Expected: native selection stays visible and the passage toolbar opens for an in-reader selection. Do not solve this by disabling normal reading tools or changing saved marks.

The separate zero-margin failure is reproduced and corrected by provider verse-marker mapping; it does not establish this selection failure's cause. A read-only check after explicit reannotation found a completed/published generation, two saved notes and no marks on the candidate reading. No diagnostic mark, note or preference was written. Source font CSS supplied no `user-select` or `pointer-events` rule explaining the report.

Native Sky inspection in Dia reached the authenticated reader's accessibility tree. Screenshot capture returned blank frames, and transient selection attempts did not provide a reliable before/after signal. Do not claim a selection cause or a fix from that evidence. No authentication bypass, browser-profile copying or unrelated tab manipulation is authorized as a workaround.

Next: obtain a reliable agent-driven pointer/selection trace on the affected reader. Observe selection length, event target, DOM replacement and computed selection/pointer styles without logging passage text. Build a deterministic reproducer at the actual failed seam, then test selection persistence and toolbar opening through ordinary reader updates on desktop/mobile. Use synthetic/disposable data for any saved-mark tests; preserve personal writing and existing marks.
