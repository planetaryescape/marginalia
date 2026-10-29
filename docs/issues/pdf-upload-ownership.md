# A PDF upload is not bound to the file it was granted for

Raised during rung 3b review. Status: done 2026-10-29.
## What is bound

`documentImports.generateUploadUrl` takes the SHA-256 (64 lowercase hex characters) and byte size of the file the browser is about to upload, computed with `crypto.subtle.digest` before the request, and records them on an `uploadGrants` row for the reader. `documentImports.start` reads the stored file's own checksum and size from `ctx.db.system.get("_storage", id)` and spends only an unused grant from the same reader, issued in the last hour, whose hash and size both match. It also refuses a storage file another import already claims. A reader whose grants cover other content cannot claim a file, even with a live grant and the file's storage ID.

Convex's docs describe the `_storage` checksum as hex while convex-test produces base64, so `lib/uploadFingerprint.ts` accepts either and compares as hex.

## What is not

A reader who already has the file's bytes can compute its hash and get a matching grant. That reader can claim the file, but they could equally have uploaded the same bytes themselves, so the claim exposes nothing they did not have. A grant is still not tied to one storage ID: two uploads of identical content are interchangeable, and each needs its own grant.

Browsers hash the whole file in memory (`file.arrayBuffer()` then one digest call, since WebCrypto has no streaming hash), so a 60 MB PDF briefly costs about 60 MB more memory; the desk shows "Checking the file…" meanwhile. Time on a phone has not been measured.

## Older tabs and grants

A tab still running the previous release calls `generateUploadUrl` without a hash. It is refused with "Marginalia has been updated. Reload the page and try again." and no grant is recorded. A grant issued before the change has no hash and can never be spent; `start` gives the same reload sentence when the reader holds one.


## What a refusal never does

`start` deletes no file before this reader's claim on it has succeeded. A refusal (no grant, over the size limit, too many imports running, file already claimed) returns an error and leaves the file alone, because until the claim exists the file may belong to another reader. Refused files are removed by `documentImports.sweepUploads`. Only after the import row exists do `fail`, `expire` and the ready commit delete the file, and each deletes the file of its own import row.

## Why not an HTTP-action upload

It would add a second upload path. Convex's HTTP action docs say request size is not limited except `multipart/form-data` bodies (20 MiB), so a raw 60 MB body may well be allowed, but that was not tested and the content binding closes the gap without it.

## Related

Files nobody imports are removed by `documentImports.sweepUploads` (hourly, after two hours, or five minutes if over the size limit).
