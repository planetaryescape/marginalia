# Dragging does not select words in the Bible reader

Status: corrected in the 2026-10-26 Scripture margins candidate; deployed Dia smoke pending. Reported against the reader deployed from `ce31fa3` / documentation baseline `268ed8d`.

The reader reported that dragging across passage words does not select them. This is before choosing **Highlight**, not a report that an otherwise working Highlight save disappears. Expected: native selection stays visible and the passage toolbar opens for an in-reader selection. Do not solve this by disabling normal reading tools or changing saved marks.

The separate zero-margin failure is reproduced and corrected by provider verse-marker mapping; it does not establish this selection failure's cause. A read-only check after explicit reannotation found a completed/published generation, two saved notes and no marks on the candidate reading. No diagnostic mark, note or preference was written. Source font CSS supplied no `user-select` or `pointer-events` rule explaining the report.

Native Sky inspection in Dia reached the authenticated reader's accessibility tree. Screenshot capture returned blank frames, and transient selection attempts did not provide a reliable before/after signal. Do not claim a selection cause or a fix from that evidence. No authentication bypass, browser-profile copying or unrelated tab manipulation is authorized as a workaround.

The missing evidence was the separate shared stylesheet at `https://cdn.youversion.com/platform/1/bible.css`, not the per-edition font CSS. Its `yv-sdk-bible-reader` layer applies `user-select: none`, `-webkit-user-select: none` and `-webkit-touch-callout: none` to `[data-slot=yv-bible-renderer]` and every descendant. The app uses this exact wrapper but provides its own native-range selection toolbar, not the provider's verse-click selection UI.

A browser fixture with the actual ArticleRenderer, SelectionToolbar, compiled production CSS, current shared provider CSS and synthetic wording reproduced the failure: computed selection was `none`, a pointer drag selected zero characters, and no toolbar opened. The scoped app override restores native selection and touch callouts on `.licensed-bible-text[data-slot="yv-bible-renderer"]` and its descendants. With the same pointer drag at desktop and 390px widths, computed selection became `text`, 13 characters remained selected, and **Passage actions** opened. No synthetic selection API or saved-library write was used. The override also covers the comparison column without changing ordinary article styles.

Remaining verification: reload the deployed reader in Dia and confirm the real passage allows selection and opens its toolbar. The earlier blank native screenshots remain a limitation, not evidence against the independently reproduced CSS seam. Preserve personal writing and marks; saved-mark writes remain fixture-only.
