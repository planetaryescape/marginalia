# Read with Marginalia

Use the app as a reading desk: choose a piece, read it with context, and keep the useful marks and thoughts.

## Choose an article

On Home, pick **5, 10, 20 or 30+ minutes**, resume your current piece, or open an **Up next** suggestion. Click the search pill or press `/` to open the floating picker. Type a title, author or description of what you want to read. Results include reasons for their fit; use arrows and Enter or click a result. Escape returns to Home.

Suggestions never include something you've read. An article leaves Up next and the time windows when you press **Done**, when you reach the end after reading for at least 40% of its estimated time, or when you archive it in Readwise Reader. To dismiss one without reading it, use the archive button on its Up next row; the toast offers Undo. Open a read or archived article from search and press **Mark unread** to put it back.

Paste an `http`/`https` article URL into the same picker to import it. Extraction and annotation can take time; importing a URL does not guarantee its publisher exposes readable content.

## Read and keep context

Open a piece to enter the separate reader. Select a passage to open its menu: Ask, Explain, Simplify, Define, Highlight, Underline (the pen mark), Note and Copy. Choosing a mark that's already on the passage removes it. **Ask** turns the menu into a question field; toggle **Web** to let the model search, pick **Quick** or **Deep**, and press Enter to send or Escape to close. **Define** gives a dictionary-style meaning, the sense used in this passage, useful etymology when known, and substitute words or phrases that fit the sentence. Select the word or phrase you want to define, then choose **Define** or press `d`. Definitions use the same answer-length, depth and optional web settings as other companion answers; they are AI assistance, not a verified dictionary source. Saved definitions can be reopened and followed up like other conversations. With the keyboard, `j`/`k` move between paragraphs and passage actions use the current paragraph if nothing is selected.

Annotations provide cross-references, context, tensions and questions. A connection is a starting point, not verified evidence. Follow its sources and compare it to the original article. Summary and idea-map controls give a second view without replacing the article.

Open Notes with `n`. A new editor receives focus immediately. Notes save after a short pause, on blur and before the editor/panel closes. If saving fails, the editor keeps the draft visible with Retry; do not leave the page until it saves. A tab-close warning is best-effort, not offline backup.

Rate the article with `r` or the rating control. Stars have meaningful labels; impressions can also include quick tags and a short thought. Saved articles form a queue; loved articles can return as revisits.

## Adjust the reader

Open settings with `,`. Choose paper/sepia/snow or dark palettes, or Auto to follow the operating system. Adjust the font, size, spacing, width, alignment, paragraph style, drop cap, pen and highlighter. Appearance preferences are stored in this browser, not synchronized across devices.

Focus mode, paragraph numbers and the annotation map are optional. Listen uses the browser's speech synthesis; voices and availability depend on your device. Answer length, level, depth and web-search policy influence AI responses. Each reader picks the models for annotations, quick answers and deep answers under **Models** in these settings, from the providers their saved keys reach.

## Main navigation

The header has four rooms. **Marginalia** (the wordmark) opens the desk, the page where you choose what to read next. The current room is underlined.

- **Library:** ask questions across your articles, and browse shelves in the URL (`?shelf=`): **Up next** (unread, with archive), **Saved** (articles you queued), **Loved** and **Finished** (your impressions, with stars and what stayed with you). `/saved` opens the Saved shelf.
- **Notes:** revisit saved notes and follow them back to the source article.
- **Your reading:** recent reading, time, engagement and reflections. It stays out of the reader and Notes.

The avatar at the right of the header opens the account menu:

- Your email, whether you own this library, and one line of source status. When a source fails, the avatar shows a small red dot and the line says what failed.
- **Sources:** add feeds, import OPML, pause subscriptions and manage Readwise Reader sync. Removing a feed asks what to do with its articles: keep them, remove the ones you never opened, or remove all of them. Articles with your highlights or notes always stay. Removed articles that are also in Readwise Reader are deleted there too.
- **Readers** (owner only): approve access requests, copy invite links and disable readers. The menu shows how many requests are waiting.
- **Account:** sign-in methods, AI provider keys, connected apps, touch feedback and account deletion.
- **Install app**, **Keyboard shortcuts** (`?`) and **About Marginalia**, which links to the source repository.

The menu opens with Enter or Space, moves with the arrow keys, and closes with Escape, which returns focus to the avatar.

Settings pages keep the desk frame, so the header stays in place. Longer content scrolls below the header; mobile navigation stays at the bottom.

## Keyboard reference

Press `?` for the current shortcut sheet. Single-key shortcuts pause while typing and when a modal is active.

| Where | Keys | Action |
| --- | --- | --- |
| Everywhere | `g h`, `g l`, `g n`, `g w`, `g s` | Desk, Library, Notes, Your reading, Saved shelf |
| Everywhere | `Escape` | Close the active card, panel or menu |
| Home | `/`, `↑`/`↓`, `Enter` | Search, choose a result and open it |
| Home | `1`–`4`, `c`, `j`/`k` | Time window, continue, move through Up next |
| Reader | `j`/`k`, `e`, `s`, `d`, `a` | Paragraph navigation, Explain, Simplify, Define, Ask |
| Reader | `h`, `p`, `o` | Highlight, underline (pen-mark), open the paragraph's note/conversation |
| Reader | `/`, `r`, `u`, `n`, `,`, `l` | Article question, rate, summary, notes, settings, listen |
| Library | `/` | Focus the Library question input |

Keyboard shortcut badges can be hidden from the sheet. Native Tab navigation remains available. AI and content loading require a connection; consult [limitations](limitations.md) before relying on this app for offline reading or confidential material.
