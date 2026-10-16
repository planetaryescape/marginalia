# 06: Sources and settings

Sources, Account and Readers are where the reader sets things up and then leaves them alone (D-DES-012). They move from the main navigation to the avatar menu (D-DES-024, D-DES-025, Q4) and share one form pattern (principle 8). Their behaviour is unchanged: feeds, OPML import, Readwise Reader, sign-in methods, provider keys, API tokens, touch feedback and reader approval.

## The avatar menu

The avatar sits at the right of the header. Its menu is a raised surface:

```
 bhekani…                      Owner
 Readwise synced 12 min ago · 1 feed
 ───────────────────────────────────
 Sources
 Readers                    2 waiting      ← owner only; count only when non-zero
 Account
 ───────────────────────────────────
 Install app
 Keyboard shortcuts                 ?
 About Marginalia                          ← includes the source link (D-DES-022)
```

- The status line is the only place source health shows day to day ([02](02-design-concept.md#the-systems-own-state)).
- When a source has failed, a small `--danger` dot sits on the avatar, and the status line reads what failed in one sentence.
- Routes stay the same: `/feeds`, `/account`, `/readers`. These pages stay inside the desk frame (D-DES-008). In the header, a settings page shows as "Settings · Sources" so the reader knows where they are.

## One form pattern

Every settings page is one column, 680 px wide, made of **sections**:

```
 Sources

 Readwise Reader                                                     ● Synced 12 min ago
 Imports your Inbox, Later and Shortlist. Archive in Reader marks articles as read here.
 [ Readwise access token            ]   Connect
 Details ▸                                                  ← counts, phases, skip reasons

 ─────────────────────────────────────────────────────────────────────────────────────

 Feeds                                                                  Check now
 [ https://example.com/feed.xml     ]   Add            or  import an OPML file
 bhekani.com          https://www.bhekani.com/rss.xml   fetched today     Pause · Remove
```

A section is:

1. A heading in `--type-heading` with an optional status at the right: a dot plus a short phrase, with the dot coloured only for "in progress" (`--ink-muted`, gently pulsing, and static under reduced motion) or "failed" (`--danger`).
2. One sentence on what it does, in `--type-ui` `--ink-soft`.
3. Its controls.
4. Optional "Details ▸" for technical detail. Document counts, sync phases and skip reasons move here from the surface ("0 documents checked · 0 newly imported · 0 skipped…").

Sections are separated by a hairline and 48 px of space. There are no cards around sections.

Controls come in one set, replacing today's seven button styles ([01](01-current-state.md#controls-have-no-shared-language)):

| Role | Look | Examples |
|---|---|---|
| Primary (one per section at most) | Solid ink, page-coloured text, 6 px radius | Connect, Add, Add a passkey |
| Quiet | Ink-soft text on `--surface`, 6 px radius | Check now (today's "Poll now"), Sync now, Pause |
| Text action | Ink text, `--pencil-rule` underline | "import an OPML file", Details |
| Destructive | Quiet button reading "Remove", then confirm in place ("Remove this feed? Remove · Keep") | Remove feed, Remove passkey, Delete account |
| Field | 1 px `--reader-border-strong`, 6 px radius, `--type-ui` | Token, feed URL, password |

The bare "×" glyph disappears; every remove says Remove. Status pills ("Active") become meta text, and only a paused or failing feed says anything.

## Sources

- **Order:** Readwise Reader, then Feeds, then Sending from other apps (API tokens, today on Account). All three are ways articles arrive.
- **OPML import** is a text action beside the feed field, not a dashed drop zone. Dropping a file anywhere on the page still works.
- **Feed rows** follow the shared row pattern: name, URL in meta, "fetched today", and Pause · Remove as quiet actions on hover, focus and touch.

## Account

Sections, in this order:

1. Signing in (passkeys, authenticator codes, fallback password).
2. AI providers and models.
3. Touch feedback.
4. Delete account, last, set apart, with the destructive pattern. As today, only non-owner readers see it.

The page header shows the account email in meta. It doesn't repeat "Manage readers and requests" as a button, because Readers is in the avatar menu.

## Readers (owner only)

Requests first ("2 waiting"), each with Approve as primary and Decline as quiet. Approved readers follow as rows with Disable as the destructive pattern. Invite links copy with a "Copied" mark in place.

## Done when (settings)

- Sources, Account and Readers are reachable from the avatar menu and gone from the main navigation, and old URLs still work.
- Only the five control roles above appear on these pages, in all six themes.
- A failing Readwise sync shows a dot on the avatar and one sentence in the menu. Healthy sources show nothing beyond the status line.
- The design gate in [02](02-design-concept.md#the-design-gate) passes for journey 5 ("Add where my reading comes from").
