# Bible translation access and licensing

Use this note to choose text providers and enforce translation-specific permissions before adding Bible reading to Marginalia. Checked 2026-10-26 against official sources only. This is implementation research, not legal advice or evidence of an approved license. No accounts, credentials, or authenticated entitlement checks were obtained.

## Recommendation

Start with a pinned, self-hosted World English Bible (WEB) edition for passage display, caching, and on-demand AI annotations. Keep ESV, NASB, NIV, NLT, and The Message unavailable until the operator supplies authorized access and records permission for this app's actual use. A catalog listing, a paid API plan, a personal-use label, and a user-supplied model key do not establish those rights. [1][2][3]

The main blocker is **AI input permission**, not passage retrieval. API.Bible's current Express Licensing FAQ explicitly prohibits sending copyrighted text, including Creative Commons text, as LLM prompt context; it permits public-domain text and non-textual references/boundaries. Its Terms separately prohibit model training without written consent from both API.Bible and the rights holder. Do not misread that training clause as permission for inference. [2][3]

## Translation access matrix

| Translation | Official access route | Non-commercial / commercial boundary | Decision for Marginalia |
| --- | --- | --- | --- |
| ESV | **Not on API.Bible**. Crossway's ESV API requires its own application key. | Free API is non-commercial only; commercial or expanded use needs Crossway permission. API page says formal licenses are issued to organizations, not individuals/solo developers. | Separate adapter; disabled without key. AI use remains unapproved; do not send ESV to models. [2][4][5] |
| NASB | API.Bible advertises NASB; confirm exact edition and entitlement using the operator's account. Lockman is the rights holder. | API.Bible non-commercial selection or eligible commercial license; do not assume NASB 1995 and 2020 are interchangeable entitlements. Lockman's general quotation allowance is limited, not permission to mirror a full Bible. | API.Bible display can be considered after activation. Lockman explicitly permits dynamic RAG/grounding, but API.Bible still prohibits copyrighted prompt input; obtain a separately authorized text route and applicable permissions before enabling NASB AI. [2][6][7] |
| NIV | API.Bible advertises NIV for eligible non-commercial access. | **No API.Bible commercial Express License**; commercial digital rights require contacting Biblica directly. | Biblica also requires an express license for AI-connected use; its partner-access shortcut applies only to non-commercial apps without AI/ML functionality. Do not assume a display-only NIV panel inside this AI app qualifies. [6][8][9] |
| NLT | API.Bible advertises NLT. Tyndale also operates `api.nlt.to`. | API.Bible access depends on the selected license/plan. Direct NLT API allows anonymous non-commercial use: 50 verses/request, 500 requests/day. Standard keyed non-commercial access: 500 verses/request, 5,000 requests/day; commercial use must be explained/requested. | Direct anonymous retrieval is technically possible, but does not establish persistent-cache or AI rights. Default AI off; request clarification for the full workflow. [2][6][10] |
| The Message (MSG) | API.Bible advertises The Message; NavPress permissions are administered through Tyndale. | Confirm the exact API.Bible license and commercial eligibility before activation. NavPress's own online/audio route asks for a permissions questionnaire; its 500-verse quotation allowance is for print/eBooks, not blanket web-app access. | API.Bible display only after entitlement; no copyrighted prompt input under Express Licensing. Direct online/AI rights require clarification. Preserve publisher verse spans. [2][6][11] |

For NASB, NLT, and MSG, commercial API.Bible use is a licensing option to verify, **not a confirmed entitlement for this project**. The public catalog is dynamic and does not prove which editions a future key can retrieve. [6][12]

## API.Bible requirements

- Starter is non-commercial, with up to three eligible licensed Bibles and 5,000 calls/month. Pro non-commercial is advertised at $29/month; commercial Pro starts there plus translation/active-user fees. Pro includes 150,000 calls/month. Four requested API.Bible translations already exceed Starter's three selections. Pricing and eligibility must be rechecked at activation. [2][6][13]
- Non-commercial means no revenue model: ads, sponsorships, freemium, paid access, and in-app purchases count as commercial. Terms §9.3 also includes use by/for a business. Invite-only multi-reader use does not itself establish eligibility. [3][13]
- Refresh cached content at least every **30 days**; 14 days or less is recommended. The older developer FAQ additionally requests fewer than 500 consecutive cached verses. Do not build an indefinitely growing Bible mirror: use a small bounded cache and obtain clarification of the cache ceiling before increasing it. Store `fetchedAt`/`expiresAt`, and stop serving content that cannot be refreshed by expiry. [14][15]
- Keep text unchanged, including punctuation; formatting may change. Store the returned copyright and translation abbreviation with every passage. Show attribution beside Scripture, link each reading page to full copyright information and the rights-holder website, and include the API.Bible link required on Starter. Do not reuse publisher logos without permission. Exact metadata/license notices take precedence over invented generic credits. [2][3][12]
- Web display requires FUMS view tracking, including cache hits. Persist `meta.fumsToken` with the response and report it when the passage is viewed; caching does not eliminate this obligation. Use anonymous/pseudonymous identifiers, never email addresses. A PWA is still a web app for this purpose. [16][17]
- Terms §§10–13 require removal on termination/revocation and up-to-date text; some notices require action within **24 hours**, while §10 gives 72 hours in other cases. Implement the stricter 24-hour purge capability. §12 also requires copy/distribution protection, printing limits of 100 verses, territorial limits, and declared device limits. Ordinary unrestricted article export is not an acceptable default for licensed passages. [3]
- API credentials must stay server-side. Discover accessible Bibles with `GET /bibles` and use the exact returned Bible IDs. Passage requests use `/bibles/{bibleId}/passages/{passageId}` and the `api-key` header. Requests over 200 verses can be silently truncated: validate the returned ID and verse count. Official docs currently mix legacy `rest.api.bible/v1` and newer `v2.api.bible` examples; choose and verify the supported base/version when access is provisioned. [16][18][19]

## ESV-specific limits and AI uncertainty

Crossway's API permits at most 500 verses or half a book per request and displayed page, whichever is less, with stated exceptions for requests involving one-/two-chapter books. Local storage is capped at 500 verses or half a book, whichever is less. Apply the storage budget across the deployment's readers and all copies rather than assuming each reader receives another 500-verse allowance; confirm scope with Crossway. Rate limits are 60/minute, 1,000/hour, and 5,000/day. Periodic cache clearing is encouraged; no fixed TTL is supplied. [4]

Show `(ESV)` with quotations, retain any returned copyright, link every ESV reading page to `esv.org`, and put the API-prescribed full notice and user copy/download limit on the copyright page. The API notice and current publisher permissions page differ in wording; match the actual text edition and obtain clarification rather than silently rewriting the notice. Text words cannot be changed; authorized omissions must preserve meaning. The API also has statement-of-faith and moral/message-integrity conditions. [4][20]

**No explicit ESV AI permission or blanket AI prohibition was located in the reviewed public API, publisher-permissions, or ESV terms pages.** Do not report an invented AI ban, or treat silence as approval. Crossway's ordinary quotation permission excludes commentary and biblical reference works and has a 25%-of-work ceiling; the API's separate redistribution guidance uses a different 50% ceiling. Neither establishes permission for Marginalia's AI commentary, third-party prompt transmission, embeddings, or retained outputs containing ESV text. Request written clarification covering those uses and cache scope; until then set ESV AI permission to `unknown` and block it. Do not apply API.Bible's restrictions to ESV as though ESV were licensed there. [4][20][21]

## Publisher distinctions

- **NASB:** Lockman's general allowance is up to 1,000 verses, no complete book, no more than 50% of the work, and at most 1,000 verses in electronic retrieval storage. Its AI policy separately permits up to 1,000 verses per dynamic response, including RAG/grounding, with edition-specific attribution. It does not authorize bulk datasets or training, fine-tuning, evaluation, or model development. This is a possible direct-provider route, not a waiver of API.Bible's minimum restrictions. [7][3]
- **NIV:** Biblica's official indexed permissions text requires a valid license expressly allowing any AI/ML-connected use. Its page returned HTTP 403 to direct retrieval during research; this finding comes from search-indexed text on Biblica's own site, corroborated by API.Bible's commercial-NIV guidance. Re-read the full permissions and Publisher AI Policy with the licensor before approval. [8][9][22]
- **NLT/MSG:** Tyndale's NLT API pages do not specify a persistent-cache budget or permission for runtime AI. NavPress requires accurate MSG text and use-specific permissions that cannot be passed to another person. Do not infer that general print quotation rules authorize multi-reader caching or model input. Tyndale's general permissions page also returned 403; the directly readable API and NavPress pages establish the narrower findings here. [10][11]

## Public-domain fallback

**WEB is the preferred default.** eBible.org explicitly dedicates the text to the public domain and allows copying, distribution, sale, and unrestricted use. Obtain a versioned source directly from its downloads rather than through a licensed API if avoiding API-specific tracking/cache contracts matters. Choose the edition explicitly: Classic uses "Yahweh"; Updated/British variants use "LORD". Keep the source text intact and label AI output separately: the WEB trademark identifies faithful copies, not model-rewritten Scripture. Public-domain status permits text caching and model input; normal model-provider privacy/retention terms still apply. [1][23]

**KJV is a secondary, territory-sensitive option.** eBible.org identifies its 1769 text as public domain outside the UK and warns about UK printing/import permissions. API.Bible goes further contractually: §9.8 excludes KJV distribution in the UK, Isle of Man, Channel Islands, and listed British Overseas Territories, regardless of public-domain labels or commercial status. Do not describe KJV as globally unrestricted or assume US hosting settles reader territory. Use WEB unless required territorial permission/restrictions are resolved. [3][24]

## Proposed provider implementation contract

This is a design recommendation, not existing code or permission granted by this note.

| Boundary | Required behavior |
| --- | --- |
| Translation registry | Record provider, exact edition/Bible ID, license basis/document/date, commercial status, territories, attribution, cache limits, and independent display/AI permissions (`allowed`, `denied`, `unknown`). Default licensed versions to unavailable and AI to blocked. |
| Activation | Require operator-supplied credentials where applicable, an accessible-version check, and recorded approval for the app/use. A valid key alone does not override AI restrictions. Never fabricate Bible IDs, use demo keys as production entitlement, scrape readers, or silently label WEB as another translation. |
| Passage response | Return actual canonical reference and verse spans, translation/edition, content, verse count, copyright/links, provider tracking token, fetch/expiry times, and policy version. Preserve grouped verses such as MSG rather than splitting guessed per-verse text. |
| Cache | Key by provider + edition + canonical range + formatting. Enforce both size and TTL limits, including text duplicated into highlights, histories, annotations, exports, logs, and backups. No full-Bible prefetch for licensed providers. Purge/revoke by translation; retain reference-only bookmarks where possible. |
| AI boundary | Check permission server-side before assembling prompts, embeddings, retrieval context, chat history, or telemetry. On-demand inference and a no-training model setting do not override a licensor's prompt prohibition. Prevent quoted passages in user notes from bypassing the policy. |
| Safe fallback | Generate annotations from an explicitly selected WEB passage/reference, with `annotationSourceTranslation=WEB` shown to the reader. Do not present them as analysis of ESV/NASB/NIV/NLT/MSG wording. For NIV in an AI-enabled app, obtain publisher approval even before assuming separate WEB processing makes NIV display acceptable. |
| Rendering and failures | Render source text and generated commentary separately. Always carry attribution and tracking through cache hits. Return distinct `not_configured`, `not_licensed`, `ai_not_permitted`, `cache_expired`, and `rate_limited` states; offer a clearly labeled WEB alternative, not a hidden substitution. |

Before enabling a licensed provider, verify tests for missing keys/entitlements, AI-input rejection (including quoted notes), cache bounds/expiry, revocation purge, attribution/FUMS on cache hits, actual verse spans/truncation, and explicit fallback labels. Ask each licensor to approve multi-reader web use, monetization status, cache/backup retention, model transmission, annotations/output quotations, embeddings, export, and applicable territories.

## Official sources

1. [WEB public-domain dedication and trademark](https://ebible.org/eng-web/copyright.htm).
2. [API.Bible Express Licensing FAQ](https://care.api.bible/article/405-express-licensing-faqs), updated 2026-10-01: AI prompts, ESV exclusion, attribution, plans.
3. [API.Bible Terms and Conditions](https://api.bible/terms-and-conditions), especially §§5, 7–16 and Acceptable Use. Full text was readable in the page's HTML even when the Markdown extractor omitted it.
4. [ESV API conditions of use](https://api.esv.org/).
5. [ESV API authorization and endpoints](https://api.esv.org/docs/).
6. [API.Bible overview/catalog claims](https://docs.api.bible/) and [licensing/access](https://docs.api.bible/quick-start/licensing-and-access).
7. [Lockman permissions, electronic storage, and AI usage](https://www.lockman.org/permission-to-quote-copyright-trademark-information/).
8. [API.Bible commercial NIV licensing](https://care.api.bible/article/394-commercial-licensing-for-the-niv), updated 2026-06-26.
9. [Biblica permissions](https://www.biblica.com/permissions/) (official search-indexed text; direct fetch blocked).
10. [Tyndale NLT API access](https://api.nlt.to/) and [usage documentation](https://api.nlt.to/Documentation).
11. [NavPress permissions, The Message](https://www.navpress.com/permissions).
12. [API.Bible licensing policies quick reference](https://care.api.bible/article/396-licensing-policies-quick-reference).
13. [API.Bible common questions](https://docs.api.bible/common-questions) and [commercial-use FAQ](https://api.bible/faq).
14. [API.Bible caching requirements](https://care.api.bible/article/401-caching-content), updated 2026-08-19.
15. [Developer FAQ cache guidance](https://docs.api.bible/common-questions#can-i-cache-content-from-apibible).
16. [API.Bible FUMS implementation](https://docs.api.bible/resources/fair-use).
17. [API.Bible integration patterns](https://care.api.bible/article/411-common-integration-patterns), updated 2026-10-01.
18. [API.Bible authentication](https://docs.api.bible/quick-start/authentication).
19. [API.Bible passage response and truncation](https://docs.api.bible/guides/passages).
20. [Crossway ESV permissions](https://www.crossway.org/permissions/).
21. [ESV terms](https://www.esv.org/about/terms/) and [digital-permission request route](https://www.crossway.org/permissions/digital/).
22. [Biblica Publisher AI Policy](https://www.biblica.com/publisher-ai-policy/) (identified official policy; direct fetch blocked, not reviewed in full).
23. [WEB official editions and download links](https://worldenglish.bible/).
24. [eBible.org KJV legal/status notice](https://ebible.org/eng-kjv/copyright.htm).
