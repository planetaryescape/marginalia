# Direct publisher and platform access to requested translations

Checked 2026-10-26. These findings correct the impression that every copyrighted translation requires a separately negotiated, paid agreement before any app use. Published API terms can grant permission; access for display, retention and AI processing still need to be checked separately.

Implementation update: the app is now Live with verified entitled NIV/NASB access. The intended reader integration displays licensed text transiently in the normal reader and uses a separately labeled public-domain WEB source for AI. Comparison is explicitly opt-in there, not a separate reading experience. The earlier account-vetting notes below describe the sequence of checks, not the current portal status. See the [reading guide](../bible-reading.md) and [release verification](../releases/2026-10-26-bible-comparison.md).

## Setup performed

After the user signed in and explicitly approved app registration, Marginalia was created once in YouVersion using Codex's Sky computer-use integration in Dia. Its initial status was **In development**; the operator subsequently made it **Live**, as verified below. Its initial app key has not been copied into code, chat or logs.

The user subsequently accepted the available agreements. A follow-up inspection of the account's ten active license inventories confirmed these requested editions:

| Edition | Active account license | YouVersion version ID |
| --- | --- | --- |
| NIV 2011 | Biblica | `111` |
| NIV Anglicized 2011 | Biblica | `113` |
| NASB 1995 | Lockman | `100` |
| NASB 2020 | Lockman | `2692` |

ESV, New Living Translation and The Message were not found in those active inventories. Biblica's `NLT` entry is **New Luo Translation**, not New Living Translation; an abbreviation match is not sufficient entitlement verification.

Both publisher agreements were readable during the follow-up. Account license acceptance does not by itself establish production approval or permission to use the existing AI and permanent-storage pipeline. Keep the live selector unavailable until the exact provider connection and its applicable feature restrictions are implemented and verified. No additional agreement, key generation or Make Live submission was performed during verification.

An authenticated, server-side smoke check with the existing app key subsequently confirmed all four IDs in the default entitled Bible collection (`all_available` was not enabled). Actual passage requests for `JHN.3.16` succeeded for NIV 2011 and NASB 2020, with HTML and current attribution present. The check did not persist passage text or send it to an AI provider.

The operator then completed Make Live; a fresh portal inspection verified **LIVE**. The existing key was saved to the personal family 1Password Private vault as **Marginalia — YouVersion API**, configured on the backend without logging its value, and the temporary secret template was removed. A full entitlement-filtered metadata request returned 1,485 editions across 1,262 language tags. The real comparison adapter retrieved both NIV 2011 and NASB 2020 for `John 3:16-21`, including current attribution and privately fetched font CSS.

## Practical routes

| Version | Available route | What it establishes | What remains for Marginalia |
| --- | --- | --- | --- |
| ESV | [Crossway's ESV API](https://api.esv.org/) | Free non-commercial website use. Mobile and other digital use are permitted without formal permission when the published conditions are met. An application key is required. | Stay within rate, page and cache limits, including at most 500 cached verses or half a book, whichever is less. The reviewed API terms do not expressly settle third-party AI annotation use. Do not assume either an AI ban or an unlimited AI grant. |
| NLT | [Tyndale's direct API](https://api.nlt.to/) and [documentation](https://api.nlt.to/Documentation) | Anonymous non-commercial access: 50 verses per request, 500 requests per day. Keyed standard access: 500 verses per request, 5,000 requests per day. Purpose requirements apply. | Check retention and third-party model-processing permission before using the current indefinite article-storage and AI pipeline. Commercial use requires explaining the application when requesting access. |
| NASB 1995/2020 | [Lockman's published permissions](https://www.lockman.org/permission-to-quote-copyright-trademark-information/) and the accepted YouVersion agreement | Both requested editions are in the active account inventory. The separate public quotation policy permits specified dynamic AI uses, but is not a blanket AI grant for this platform integration. | Confirm YouVersion vetting and website notification, then connect the actual API/SDK with its required attribution and extraction safeguards. Apply the specific agreement and platform terms rather than assuming the general quotation allowance grants unrestricted retention or AI use. |
| NIV | Accepted YouVersion Biblica agreement and [Biblica permissions](https://www.biblica.com/permissions/) | NIV 2011 and NIV Anglicized 2011 are in the active account inventory. | Implement a reading-only path with the applicable display, footnote, attribution and download restrictions; obtain the applicable product approval. Do not route this text through personalized AI features under the current agreement. |
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
