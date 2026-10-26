# Wider screens can't mark a finished article unread

Status: done 2026-10-17 (`c7fe863`). Found 2026-10-16 at `79764b4`.

Mark unread existed only in the phone bottom bar, so on a laptop an auto-finished article couldn't be put back from the reader. A finished article now shows **Mark unread** beside **Done** at its end, at every width, and in the reader's **More actions** menu. Both call `articles.restore`, which puts the article back in Up next and the time choices and moves its Reader document to Later. `docs/reader-guide.md` no longer says wider screens lack it.
