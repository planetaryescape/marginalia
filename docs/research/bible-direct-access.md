# Direct publisher and platform access to requested translations

Checked 2026-10-26. These findings correct the impression that every copyrighted translation requires a separately negotiated, paid agreement before any app use. Published API terms can grant permission; access for display, retention and AI processing still need to be checked separately. No account was created or agreement accepted, and no app code changed during this research.

## Practical routes

| Version | Available route | What it establishes | What remains for Marginalia |
| --- | --- | --- | --- |
| ESV | [Crossway's ESV API](https://api.esv.org/) | Free non-commercial website use. Mobile and other digital use are permitted without formal permission when the published conditions are met. An application key is required. | Stay within rate, page and cache limits, including at most 500 cached verses or half a book, whichever is less. The reviewed API terms do not expressly settle third-party AI annotation use. Do not assume either an AI ban or an unlimited AI grant. |
| NLT | [Tyndale's direct API](https://api.nlt.to/) and [documentation](https://api.nlt.to/Documentation) | Anonymous non-commercial access: 50 verses per request, 500 requests per day. Keyed standard access: 500 verses per request, 5,000 requests per day. Purpose requirements apply. | Check retention and third-party model-processing permission before using the current indefinite article-storage and AI pipeline. Commercial use requires explaining the application when requesting access. |
| NASB 1995/2020 | [Lockman's published permissions](https://www.lockman.org/permission-to-quote-copyright-trademark-information/) | Explicit permission for dynamic AI queries, RAG, grounding, search, citation and quotations, up to 1,000 verses per response, with attribution. This is not a blanket ban on AI inference. | Obtain an authorized text source. The policy does not authorize scraping, bulk downloading, standalone datasets or model training/development. Ordinary quotation/storage limits also matter: no more than 1,000 verses stored, no complete book and a 50% work limit under the general quotation permission. Do not equate the AI response allowance with unrestricted permanent library storage. |
| NIV | [YouVersion Platform catalogue](https://platform.youversion.com/bibles) and [Biblica permissions](https://www.biblica.com/permissions/) | YouVersion lists NIV 2011 and NIV Anglicized 2011 and advertises fast-track licensing. | The exact app entitlement must be accepted/verified. Biblica's permissions require a license expressly allowing AI-connected use. A reading entitlement alone does not establish that permission. |
| The Message | [NavPress permissions](https://www.navpress.com/permissions) | Published print/eBook quotation allowances exist. | Online/audio use is expressly routed to the publisher's permissions questionnaire. Those print allowances do not themselves authorize this web reader and its AI pipeline. |

## YouVersion Platform

[YouVersion's public site](https://platform.youversion.com/) advertises free APIs/SDKs and "Fast-track Bible Licensing" with "No extra negotiation needed." Its [catalogue](https://platform.youversion.com/bibles) lists NASB 1995, NASB 2020 and NIV variants. Its [API usage guide](https://developers.youversion.com/api-usage) requires an app key and acceptance of appropriate license agreements; the entitled Bible collection, not a public catalogue listing, determines what the app can access.

The [Platform Terms of Use](https://platform.youversion.com/terms), last modified August 17, 2026, are rendered in a browser dialog. Relevant distinctions:

- Platform/tool permission does not itself grant rights to biblical works; publisher/content terms are additional.
- The AI section permits code writing and content generation, but restricts use of its tools with open-ended user chat. Its express exception allows verbatim retrieval/display from licensed Scripture; use beyond the stated permissions requires prior written approval. This creates a specific issue for Marginalia's Ask/follow-up companion. Do not turn it into an invented blanket prohibition on all generated marginalia: that separate use and the applicable content license need assessment.
- Other conditions include usage reporting, restrictions on competing services, and additional tool-specific terms.

This is a promising route for familiar translations, not proof that this app already has permission for every feature. Start by registering the actual use case, checking available agreements and confirming the AI companion's eligibility. Do not accept terms on the user's behalf without authorization.

## Integration consequence

The current provider stores WEB passages indefinitely in reader-owned article rows. Adding a copyrighted translation cannot be done safely by just marking its existing selector option available: direct APIs need adapters, exact attribution, policy-aware text retention and checks at every AI boundary. Those are implementation requirements, not evidence that the versions are unobtainable.

See [open alternatives](bible-alternatives.md) for options that may avoid these limits, and the [earlier licensing research](bible-translations.md) for provider-specific details. Biblica's pages returned HTTP 403 to direct fetching in this check; its AI requirements were read from search-indexed text on its official permissions and [Publisher AI Policy](https://www.biblica.com/publisher-ai-policy/) pages.
