# Recorded decisions

Use this record to preserve decisions that would otherwise be rediscovered during the next cleanup. Attribution matters: **user-requested** means explicitly available in the development conversation; **implementation** means observed in code or selected while implementing those requests. An implementation is not automatically a permanent product commitment.

## User-requested decisions

| Decision | Reason visible in the requests | Current implementation / verification |
| --- | --- | --- |
| A wide, attractive, no-scroll Home | The reading desk should make the next read immediately available | `(desk)/page.tsx`; check desktop and mobile viewport fit |
| Floating search rather than a page of search results | Search is a quick way to choose the next article | `article-finder.tsx`; click or `/`, arrows/Enter/Escape |
| Search explanations and pasted URLs | Results should explain their fit, and importing a link belongs in the same entry point | Validated `/api/library/search`; URL import through `addArticleByUrl` |
| Keyboard access throughout | All functionality should work without a mouse | Shared dispatcher, native controls, modal focus tests and shortcut sheet |
| Quiet visible focus | Loud blue highlights distracted from the reading design | `--reader-focus` and global focus styles |
| Visible stars and rating labels | Shortcut hints alone did not make rating understandable | `impression-panel.tsx` |
| Autosaving, immediately focused note editors | Writing a note should not require manual save bookkeeping | `note-editor.tsx`; 700ms debounce, close/blur flush and retry state |
| Stable layout across every main navigation item | Notes and other legacy routes removed navigation and changed the layout | Persistent `(desk)/layout.tsx`; route regression tests |
| Preserve existing notes during improvements | Polish must not replace personal reading history with test or demo data | No data migration in this pass; test fixtures stay isolated |
| Commit and ship finished work to the reader domain | Completed work should be usable, not only local | Vercel production deployment plus live transition checks |
| Assess phone usability and make the app a PWA | The reader should be usable from a phone and launch from its home screen | Mobile controls, manifest, install instructions and offline fallback; see [phone guide](mobile-and-pwa.md) |
| Import the remaining eligible Reader library | The 100-item first sync left older unchanged documents permanently unimported | Resumable full backfill, then paginated incremental sync; no total cap |
| Define terms in their sentence, not just in a dictionary | The reader needs the contextual sense, useful origins and substitutes that fit | Define passage action and `d`; persisted companion mode and prompt tests |

Replay these paths with [the reader guide](reader-guide.md) before changing them.

## Implementation decisions to preserve unless requirements change

| Choice | Trade-off | Source |
| --- | --- | --- |
| Bun workspaces, Turbo, Next.js and Convex | One repo with a live query client and scheduled backend work; separate deployments still need care | Package manifests, `turbo.json`, `vercel.json` |
| Native modal search and shared dialog helper | Browser focus semantics without separate focus-trap implementations | `use-modal-dialog.ts`, `article-finder.tsx` |
| One shortcut dispatcher | Prevent `g h` from also firing the reader's `h` action; ignore editable targets and overlays | `shortcuts.ts` and its tests |
| Theme tokens on `<html>` | Panels, portals and desk routes share the selected palette | `use-reader-theme.ts`, `globals.css` |
| Browser-local reading appearance | Immediate preferences without a network round trip; not synchronized across devices | `reader-settings.ts` |
| Server-side model allowlist and role-specific fallbacks | Prevent arbitrary provider model IDs; recover from provider failures | `lib/providers.ts`, `userSettings.ts` |
| Keep personal activity in retrieval context | Notes and conversations need the passage/question they respond to | `marginaliaContext.ts`, note embedding action |
| Keep reflection prompt text with a note | Re-annotation may delete an annotation; the saved reflection still needs to make sense | `userNotes` schema and context builder |
| Validate search IDs and embedding responses | Provider output is not trusted merely because it is valid JSON | Search and embedding parser tests |
| Whole-file atomic vault replacement | A failed upload must not destroy the previous complete index | `noteChunks.replaceFile` and mutation tests |
| Retain failed note drafts in the editor | Closing should wait for an acknowledged save; offline storage is not promised | Autosave queue tests and reader panel |
| Reader sync imports unread text queues only | Avoid importing the entire Reader archive or unsupported document formats | `actions/readwiseSync.ts` |
| Leased, paced Reader pages and durable checkpoints | Avoid overlapping syncs, silent page truncation and uncontrolled annotation bursts; five documents per minute trades speed for predictable load | `readwiseSyncState.ts`, Reader action regression tests |
| Transactional whole-library Home counts | Separate accurate totals from bounded suggestions; initialize old articles/finishes in small idempotent pages | `readingQueue.ts`, queue count regression tests |
| Loved-article revisit intervals | Current schedule grows through 3, 5, 8, 13, 21, 34 and 55 days, with jitter | `spacedRepetition.ts`; implementation choice, not a recovered user request |
| Installable, online-first PWA | Cache only the offline screen, not personal content or versioned Next pages; installation does not promise offline reading | `manifest.ts`, `public/sw.js`, `pwa-runtime.tsx` and worker regression tests |
| Render articles through the shared `@planetaryescape/reader` package | One reading surface maintained once for more than one app; Marginalia keeps its own sanitizer, settings storage key and prose classes, and upgrades by bumping a git tag | `article-renderer.tsx`, `lib/reader-settings.ts`, `apps/web/package.json` |
| Mobile question inputs and bottom passage tools | Give typing space without fighting native selection handles; VisualViewport positions panels above the keyboard | `article-ask.tsx`, `selection-toolbar.tsx`, `pwa-runtime.tsx` |

## Decisions still needed

1. **Deployment separation:** migrate the live reader off its currently shared Convex development deployment without losing the library.
2. **Cost controls:** per-reader request budgets exist (`limits.ts`), but there is no spending quota. Decide one, and whether vault content may be sent to external models.
3. **Large-library behaviour:** decide pagination/retention before replacing bounded recent collections or unbounded analytics scans.

Access control is settled: readers sign in, each library is isolated by session, and signup goes through the owner-approved waitlist in the [multi-user plan](multi-user-plan.md). The code is dual-licensed MIT or Apache-2.0.

These are not silently resolved by a polish pass. Follow [operations](operations.md) and [limitations](limitations.md) when planning the next change.
