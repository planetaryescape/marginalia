# A PDF upload is not bound to the file it was granted for

Raised during rung 3b review. Status: open, low risk.

## What is bound

`documentImports.generateUploadUrl` records an `uploadGrants` row for the reader. `documentImports.start` requires an unused grant from the same reader issued in the last hour, spends it, and refuses a storage file another import already claims. A reader who never asked to upload cannot start an import, and a refusal in that case leaves the file alone.

## What is not

A grant is not tied to a storage ID. Convex gives the browser the ID only after the upload finishes, so the server cannot know at grant time which file the grant covers. A reader with a live grant who learns another reader's unclaimed storage ID could claim that file before its owner calls `start`.

The window is the seconds between an upload finishing and its owner's `start` call. Storage IDs are random and are shown only to the uploading browser, so the practical risk is low.

## What a refusal never does

`start` deletes no file before this reader's claim on it has succeeded. A refusal (no grant, over the size limit, too many imports running, file already claimed) returns an error and leaves the file alone, because until the claim exists the file may belong to another reader. Refused files are removed by `documentImports.sweepUploads`. Only after the import row exists do `fail`, `expire` and the ready commit delete the file, and each deletes the file of its own import row.

## If it needs closing

Upload through an HTTP action that authenticates the reader, stores the file itself and records the ID against the reader's grant in the same step. That costs a second upload path and the 2-minute POST limit applies to it.

## Related

Files nobody imports are removed by `documentImports.sweepUploads` (hourly, after two hours, or five minutes if over the size limit).
