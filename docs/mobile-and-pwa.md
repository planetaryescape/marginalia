# Use Marginalia on your phone

Open [reader.bhekani.com](https://reader.bhekani.com) in your phone's browser before signing in with a passkey. The established `marginalia-drab.vercel.app` page alias redirects to this canonical host and keeps the requested path, query and browser fragment. Use the desk to choose a reading time or search for an article, then tap the pick or a result to read it. You can use the main reading flows on a phone with a connection; installation is optional.

## Install on your home screen

Open the avatar at the right of the header and choose **Install app** for installation instructions.

- **iPhone or iPad:** open in Safari, tap **Share → Add to Home Screen**, then **Add**. Keep **Open as Web App** enabled if Safari offers it.
- **Android:** tap **Install app** in Marginalia when offered, or use **Install app / Add to Home screen** in Chrome's menu.
- **Desktop:** use the install control in a supporting browser's address bar or menu.

Launch the new home-screen icon. A supporting browser opens Marginalia in a standalone window without its normal address bar. Installation availability depends on the browser; iOS does not expose Chrome's in-page install prompt.

## Read and write with touch

The bottom bar has four slots: **Desk**, **Library**, **Notes** and **Search**. Search opens the article picker; from another room it opens on the desk. **Your reading** is not on the bar: it's the first item in the avatar menu at the top right on phones (or press `g w`). Sources, Readers and Account sit in the same menu, which also shows a red dot when a source fails. Open **Your account** there to manage credentials and interaction feedback.

While reading:

- Tap **Notes** in the reader's bottom controls, then **+ New** to write an article note. The editor focuses immediately. Wait for **Saved** before leaving it.
- Select a passage using your phone's text selection. Phone passage actions form a labelled two-column context menu beside the selection, rather than a desktop pill at the bottom of the screen. Ask, Explain, Simplify, Define, Highlight, Underline, Note and Copy remain available. Native selection handles and menus vary by browser and still need physical-phone verification.
- Tap **Ask about this article** for a whole-article question. The question field has its own row on phones; **×** closes it without requiring an Escape key.
- Use **More actions** (the three dots in the header) to rate or love the article, and for Summary, Copy link and the rest. Reading settings remain in the header; panels scroll on short screens. The bottom bar reads **Ask**, **Notes**, **Listen** and **Done**; on a finished article, Done becomes **Mark unread**.

The desk is one column: the date, the question, the time choices, the slot for your pick and the search. Under 700 px of height the date is hidden. Up next is a shelf in Library; the search picker reaches any article. Library and the other desk pages scroll within the shared navigation.

After the auth rollout, use a passkey or fallback password to sign in. Enrollment happens in **Your account**. Sessions persist between visits, though browser and installed-PWA storage can differ and may require separate initial sign-ins. No magic links or email setup are required.

In **Your account → Touch feedback**, choose haptics and optional quiet sounds. Sounds default to off. **Test feedback** uses a best-effort iPhone fallback: Safari's native switch control can produce a brief tap during a touch action. This is not a general vibration API, and installing the PWA does not provide one. Older browsers and device settings may prevent the tap. Reduced-motion preferences disable feedback. See [follow-up verification](verification.md#search-rejections-and-iphone-feedback) for deployment status and device-test limits.

Tap **Test feedback** on your iPhone with haptics enabled, then try navigation and a reader action. Test Safari and the installed PWA separately. The tap should not move focus, change reader settings, vibrate continuously or play sounds unless you enabled them. If silent, check Reduce Motion and device haptic settings; soft tap sounds remain optional. Safari's [switch control](https://webkit.org/blog/15054/an-html-switch-control/) arrived in 17.4, but its use for haptics is a workaround, not a platform guarantee.

## Keep a connection for reading and saves

The PWA caches only a small, self-contained offline screen. It does **not** download articles, persist note drafts, queue offline note writes, cache AI answers or provide background sync. Reading-time checkpoints have their own bounded retry queue; this does not make notes or articles available offline.

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

The iOS-style keyboard test simulated a VisualViewport height change; it was not a real Safari keyboard. These checks do not certify long-press selection, speech playback, installation, safe-area rendering or background/resume behaviour on physical iOS or Android devices. After deployment, repeat **Desk → search → read → select text → new note → Saved → close → relaunch** on your own phone. Use a disposable record or a separate deployment for write tests; no real notes or ratings were changed during this pass.
