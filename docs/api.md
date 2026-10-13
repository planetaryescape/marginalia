# API for other apps

Other apps can add articles to a reader's library and read the highlights the
reader makes on them. Marginalia doesn't know which app is calling: any app
with a token works the same way.

## Tokens

Create a token under **Account → Connected apps**. The token starts with
`mrg_` and is shown once; Marginalia keeps only its SHA-256 hash. Each reader
can have up to 10 tokens. Revoking a token, disabling a reader or deleting the
account stops it working at once.

Send it as a bearer token:

```
Authorization: Bearer mrg_…
```

A token can only call the two endpoints below, and only on its own reader's
library. Each library gets 60 API requests a minute; over that the API
answers `429` with `Retry-After: 60`.

The base URL is the reader's site, for example `https://reader.bhekani.com`.
The site forwards `/api/v1/*` to the Convex backend, which checks the token.

## Add an article

```
POST /api/v1/articles
Content-Type: application/json
```

```json
{
  "externalId": "your-app:item-42",
  "title": "The quiet death of the three-pane layout",
  "html": "<p>…</p>",
  "url": "https://example.com/three-pane",
  "author": "Long Reads Weekly",
  "publishedAt": 1760000000000
}
```

| Field | Required | Notes |
|---|---|---|
| `externalId` | yes | Your ID for the item, up to 200 characters. Sending the same ID again returns the article created the first time and changes nothing. |
| `title` | yes | Up to 500 characters. |
| `html` | yes | The article's HTML, already extracted. Scripts, styles, SVG and inline images are removed before storing, and the reader sanitizes it again when rendering. The request may be up to 2 MB. |
| `url` | no | An `http` or `https` address for the original. |
| `author` | no | Up to 200 characters. |
| `publishedAt` | no | Milliseconds since the Unix epoch. |

A new article answers `201`; one sent before answers `200`:

```json
{
  "articleId": "k57…",
  "readUrl": "https://reader.bhekani.com/read/k57…",
  "created": true
}
```

New articles are embedded and annotated like any other, using the reader's
own AI keys.

Errors use `{ "code": "…", "error": "…" }`: `400 invalid_request`,
`401 unauthorized`, `413 too_large` and `429 rate_limited`.

## Read an article's highlights

```
GET /api/v1/articles/{articleId}/highlights
```

```json
{
  "articleId": "k57…",
  "title": "The quiet death of the three-pane layout",
  "highlights": [
    {
      "id": "j97…",
      "kind": "highlight",
      "text": "shipped the same window",
      "paragraphIndex": 3,
      "createdAt": 1760000000000
    }
  ]
}
```

`kind` is `highlight` or `underline`. `paragraphIndex` is the 0-based
paragraph the mark starts in, or `null`. An article outside the token's
library answers `404`, the same as one that doesn't exist.
