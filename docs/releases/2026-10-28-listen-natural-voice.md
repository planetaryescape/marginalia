# Listen reads in Kokoro's Heart voice

Released 2026-10-28 to https://reader.bhekani.com. The backend runs commit `f55b36a97e9a4d6eb4b142842b24d8ea834c3031` on `dev:stoic-hare-718`. The frontend runs Vercel deployment `dpl_7DJeL1ANugXdTq8hZJUgYQCAmh35`, built from `2399645a873b21500b0d0acaf5158ade76e61176`. The one later commit, `f55b36a`, changed only backend logging.

## What changed for readers

Press `l` in an article and Kokoro's Heart voice reads it, starting at the paragraph under the reading line. Audio comes through the reader's own OpenRouter key, routed to the cheapest provider that doesn't keep the text. A reader without a key gets a prompt to add one, or to use the device voice for this session. See [the Listen blueprint](../listen/blueprint/README.md), rung 1.

## Rollback

Taken before each backend update, both with file storage and auth components, owner-only, and ZIP-validated:
- `marginalia-before-listen-rung-1.zip`, snapshot timestamp `1793185271493592256`.
- `marginalia-before-speech-timing.zip`, snapshot timestamp `1793186534686212327`.

The previous frontend is `dpl_DbKm6UJEGQLDyKSf5SUUC2cCcctz`. The release has no schema change, so reverting the code doesn't need a data restore.

## Live checks

- `speech:clip` is a public action. Its key and ownership queries are internal. An anonymous call is refused with "Sign in to your private reader." before any key lookup or provider request.
- **First smoke, 11:08:** clips took 2.3–11.7 s each, whatever their length, and the bar showed "Still preparing this paragraph." about 7 s after `l`. OpenRouter recorded DeepInfra's first-byte latency for those generations at 146–688 ms. The same requests sent straight from a laptop finished in 0.4–1.2 s. The action had no timings to show where its time went, so PR #59 added them.
- **Second smoke, 11:25:** `l` was pressed at 11:25:40 and the first clip was back 1.08 s later.
  - Eight of the nine clips took 0.67–1.36 s: 14–127 ms of checks, 311–711 ms waiting for OpenRouter's response headers and 119–543 ms reading the audio.
  - One took 5.2 s, 4.7 s of it waiting for headers.
  - The bar advanced paragraphs on its own and with Next, and Stop closed it.
  - The earlier slowness didn't recur. A slow clip's `Speech clip` log line now shows which step took the time.
- **Pause and Resume, first smoke:** the button switched between the two.

## Not verified

- **Phone and sound:** autoplay on a phone, and how the voice sounds through the deployed app.
- **What's visible:** whether the highlight lands on the reading-line paragraph, and where Previous goes. Dia's screenshots were blank, so these checks used accessibility text only.
- **Themes:** screenshots of the bar in all six themes at desktop and phone widths are still outstanding.
