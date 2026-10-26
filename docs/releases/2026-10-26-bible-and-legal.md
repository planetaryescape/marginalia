# Verify the Bible and legal-pages release

Open [the reader](https://reader.bhekani.com), then use **Your account → Bible reading** to opt in. Bible reading remains disabled for accounts that have not enabled it. The supported in-app text is explicitly **World English Bible (WEB)**; this is a partial delivery of the requested translation integration, not completion of ESV, NASB, NIV, NLT or The Message.

## Deployment

- Runtime source: `ad5bbd3` (integrated with the existing `c2251d0` release, rather than deploying the old checkout over it). The identical runtime tree was deployed under the earlier `c2bc545` commit identity; only the unpushed commit email identities were subsequently changed to GitHub no-reply addresses to satisfy email-privacy protection.
- Frontend: Vercel Production deployment `dpl_Gb2kZT1evAtXjdPEXmDfZFabruVG`, aliased to `reader.bhekani.com`.
- Backend: the existing `stoic-hare-718` deployment in `eu-west-1`, verified against the web app's production environment before updating it.
- A snapshot, including file storage, was exported before the backend update. It is available in that deployment's Convex snapshot dashboard; its export timestamp is `1793009115009756268`.
- Schema changes are additive. No existing article, note, credential or reading history was deleted or bulk-rewritten.

Visit `/privacy` and `/terms` without signing in. Both pages are linked from the sign-in, request-access and desk footers. They describe the implemented data flows, including external AI processing, and are not a legal-compliance certification.

## Verification evidence

The complete backend suite passed **1,739 tests**; the complete web suite passed **1,187 tests**. Run these from their respective package directories:

```sh
bunx vitest run --maxWorkers=2 --testTimeout=30000
```

The default five-second limit timed out in existing large reporting/tag fixtures under concurrent load; the longer test-runner deadline did not remove assertions or change application timeouts. Type checking, lint and the production build passed. Lint retains an existing dependency warning in `summary-panel.tsx`; the build retains the existing CSS `::highlight` parser warnings. The changed-file React Doctor scan reported no errors and two non-blocking warnings (chapter-option keys and Bible reader control-flow complexity).

A real, unauthenticated call through the WEB adapter returned all six verses of Psalms 23 with the expected attribution and first/last verse labels. Tests cover opt-out access, annotation publication after opt-out, reader isolation, exact source validation, notes/highlights, source selection and independent discovery requests. Tests do not establish authenticated production UI or mobile layout correctness.

Gitleaks found no secrets in the feature commits. Scanning the merge against both parents also flagged four unchanged upstream test UUIDs used as session attribution identifiers; these are fixtures, not authentication credentials.

Production smoke checks through Sky in Dia verified both legal pages and footer navigation in both directions. The existing signed-in session opened Account, where the Bible switch and both legal links were present. Accessibility text did not expose the switch's boolean state, and no settings were changed. Only accessibility state was checked; visual/mobile appearance was not verified.

## Preferred-translation gate

Marginalia was registered once in YouVersion and persists with status **In development**. An initial key exists, but it has not been copied into app configuration or connected to the backend. The desktop automation could not safely extract its value for storage in 1Password.

Biblica/NIV and Lockman/NASB fast-track licenses are offered but remain unaccepted. Their agreement bodies could not be read through the available desktop interface. ESV, NLT and The Message access and the relevant retention/AI permissions have not been completed. These translations remain unavailable, with no silent WEB substitution. See [direct-access findings](../research/bible-direct-access.md) before continuing provider setup.

Finish those provider connections only after verifying the actual text, storage and AI entitlements; an app key alone is not that verification. See [the reading guide](../bible-reading.md) for the currently supported flow.
