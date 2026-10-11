# Use Marginalia on your phone

Open your deployed Marginalia URL in your phone's browser. Use Home to choose a reading window or search for an article, then tap a result to read it. You can use the main reading flows on a phone with a connection; installation is optional.

## Install on your home screen

Tap the download icon in the desk header for installation instructions.

- **iPhone or iPad:** open in Safari, tap **Share → Add to Home Screen**, then **Add**. Keep **Open as Web App** enabled if Safari offers it.
- **Android:** tap **Install app** in Marginalia when offered, or use **Install app / Add to Home screen** in Chrome's menu.
- **Desktop:** use the install control in a supporting browser's address bar or menu.

Launch the new home-screen icon. A supporting browser opens Marginalia in a standalone window without its normal address bar. Installation availability depends on the browser; iOS does not expose Chrome's in-page install prompt.

## Read and write with touch

Use the bottom navigation to move between Library, Notes, This week, Saved and Sources. Tap the wordmark to return Home. All five destinations fit without horizontal navigation scrolling at the inspected phone widths.

While reading:

- Tap the notes icon, then **+ New** to write an article note. The editor focuses immediately. Wait for **Saved** before leaving it.
- Select a passage using your phone's text selection. The passage toolbar sits at the bottom on narrow screens; choose a highlight, underline, note or AI action. Native selection handles and menus vary by browser.
- Tap **Ask about this article** for a whole-article question. The question field has its own row on phones; **×** closes it without requiring an Escape key.
- Tap the star to rate, the heart to love, or **Aa** for appearance and reading settings. Panels scroll when the screen is short.

Home remains a one-screen desk. On very short displays, its optional Up next list may have no room; use the search picker to reach those articles. Library and the other desk pages scroll within the shared navigation.

## Keep a connection for reading and saves

The PWA caches only a small, self-contained offline screen. It does **not** download articles, persist note drafts, queue offline writes, cache AI answers or provide background sync.

If you lose your connection with a note open, keep that window open. Reconnect, use **Retry** if shown, and wait for **Saved**. Do not reload, close the app or navigate away with unsaved text. A phone may discard a background app without showing the browser's tab-close warning.

A full navigation or reload that cannot reach the frontend shows **You're offline** instead of a blank app. After restoring the connection, tap **Try the reading desk again**. Navigation inside an already-open app may still show its normal loading state until the backend reconnects.

## Verify a deployed PWA

Service-worker registration runs in production builds, not `next dev`. Set the web environment variables as described in [development](development.md), then run:

```sh
bun run check
bun run build
bun run --cwd apps/web start
```

Use HTTPS for a deployed app; browsers also allow service workers on localhost. Check `/manifest.webmanifest`, `/sw.js`, `/offline.html` and the manifest's PNG icons on that same origin. In DevTools → Application, confirm the worker controls the page and the cache contains only `/offline.html`.

For an offline test, first visit online and wait for worker activation. Disconnect or stop the local frontend, then reload an article URL. The offline screen should appear. Restore the frontend/connection and retry. Some browser-automation offline switches affect only the page, not the worker's network; stopping the test server verifies the fallback without that ambiguity.

The worker never caches the Next app shell, articles or API responses, so frontend updates continue to use the network. If you change `offline.html`, bump the cache version in `public/sw.js`. To retire the worker, first ship a replacement at the same `/sw.js` URL that deletes its own caches and unregisters itself; removing registration code alone leaves previously installed workers active.

## What was tested

Chromium checks covered all six desk destinations at **320×568, 390×844, 430×932** and a **1440×900** desktop viewport, plus reader controls, settings, rating panels, search-to-article navigation, untouched note-editor focus, selection tools and question inputs. The inspected desk routes had no horizontal page overflow. The browser exposed the native install prompt; the production worker activated, cached the offline screen and served it with the local frontend stopped. Restarting the frontend restored the desk.

The iOS-style keyboard test simulated a VisualViewport height change; it was not a real Safari keyboard. These checks do not certify long-press selection, speech playback, installation, safe-area rendering or background/resume behaviour on physical iOS or Android devices. After deployment, repeat **Home → search → read → select text → new note → Saved → close → relaunch** on your own phone. Use a disposable record or a separate deployment for write tests; no real notes or ratings were changed during this pass.
