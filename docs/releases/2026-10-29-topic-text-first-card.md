# A topic you haven't searched before shows a text match at once

Released 2026-10-29 to https://reader.bhekani.com through [PR #82](https://github.com/planetaryescape/marginalia/pull/82). The backend `stoic-hare-718` (deployed 18:09:13) and Vercel production deployment `dpl_AfKTmZHwj33QF2ygw8t8q3LHdau7` run `8d02cce`, which is the Deep Study release `cec94f5` (#81) plus #82 and docs.

## What changed for readers

Typing a topic in the picker that matches no title used to wait 0.8–1.4 s for the first card while the query was embedded. Now an article that contains every typed word (three letters or more, ignoring a few common words, the last word as a prefix) shows as the first card straight away. A matching title still comes first, and the first card never changes once shown. Decision D-DES-072, for BK to confirm. See [the latency issue](../issues/topic-search-latency.md).

## Rollback

- The snapshot before this backend update is `marginalia-before-main-781ff29.zip`, with file storage and auth components, owner-only and ZIP-validated.
- The change adds the search index `articles.search_content` and the query `titleSearch.matchText`. Reverting the code leaves the index unused; no data changes.
- The previous frontend is `dpl_CKLTAKHC65y9HrKHYyyNbrx9KEAM` (Deep Study, `cec94f5`).

## Live checks

- `convex function-spec` lists `titleSearch:matchText`; `/help/deep-study` returns 200 on the new deployment.
- Not checked live: the picker showing a text card. It needs a signed-in browser, and Computer Use couldn't see Dia this session.

## A four-minute wrong website, 17:53–17:57

The first attempt was meant to ship #82 alone, on the belief that #81 wasn't live yet. It was: the Deep Study session had released it at 17:31. The backend deploy from that #82-only build (`ea5f0d7`, `5da8d91` with #82 cherry-picked) was refused by schema validation because live data already held #81's `scriptureStudyFollowUps.additionalEvidence`, so the backend didn't change. The deploy command then went on to the website anyway, so `dpl_3PhJQ9QxLqFXD3oMBq2E3W4rrhta` served from 17:53:25 until `dpl_CKLTAKHC65y9HrKHYyyNbrx9KEAM` was promoted back at about 17:57. In that window Deep Study ran its pre-#81 interface against the #81 backend, and the topic picker called a query the backend didn't have yet. The fix to the process: a release checks what is live before choosing what to build, and the website deploy runs only if the backend deploy succeeded.
