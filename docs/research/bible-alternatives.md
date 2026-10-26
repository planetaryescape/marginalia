# English Bible alternatives without negotiated licenses

Checked 2026-10-26 against publisher, project, distributor, and license-author sources. Completeness below means the 66-book Protestant Old and New Testaments, not the deuterocanonical books. Read alongside [the existing licensing research](bible-translations.md). This is implementation research, not legal advice. No accounts, keys, full-Bible downloads, or source-code changes were made.

## Recommendation

Add **BSB first**, then **LSV and FBV** if Marginalia can meet Creative Commons ShareAlike obligations. These provide three useful reading styles, but not the exact literal / thought-for-thought / paraphrase trio:

| Choice | Suggested style | Why use it? | Rights for the requested workflow |
| --- | --- | --- | --- |
| Berean Standard Bible, current third-printing text | Balanced modern translation | Best low-friction addition alongside WEB. Full OT+NT, public domain through a CC0-linked dedication; publisher says all uses are freely permitted and no license application is required. | Full display, redistribution, indefinite caching, highlights, notes, and runtime LLM input can use the public-domain text. Attribution is appreciated, not required. Keep verbatim Scripture distinct from generated commentary. [1][2] |
| Literal Standard Version, standard 66-book text originating in 2020 | Literal / formal equivalence | A modern literal option, rather than another archaic translation. Full OT+NT. Do not confuse its standard text with the expanded Master Collection / apocrypha products. | CC BY-SA 4.0 permits reproduction and adaptation, including commercially. Full cache and runtime annotation use are supportable under that grant, subject to attribution, ShareAlike where applicable, and the AI conditions below. It is **not public domain**. [3][4][10] |
| Free Bible Version, publisher's announced v5.2, October 2025 | Contemporary meaning-oriented / thought-for-thought | Best candidate here for easier reading. Full OT+NT. The translator describes translation from Greek and Hebrew, not a synthesis of existing English versions. | CC BY-SA 4.0 permits full copying and redistribution, with no quotation-count or cache-duration ceiling. Runtime annotation use has the same conditions as LSV. Verify the machine-readable artifact's revision before labeling it v5.2. [5][6][10] |

The style labels are product recommendations, not claims that each publisher uses those exact categories. **No safe, complete, reader-oriented paraphrase was established among the reviewed options.** Do not relabel FBV as a paraphrase to fill the slot. UST is explanatory and paraphrase-like, but its authors explicitly say it is not an end-user Bible, and its current stable release is incomplete. [6][9]

For a public-domain-only rollout, offer BSB plus ASV 1901 or YLT 1898 alongside WEB. That removes ShareAlike handling but does not supply a modern thought-for-thought version or a paraphrase. [1][7][8]

## Other candidates and edition traps

| Candidate | Completeness and character | License and practical decision |
| --- | --- | --- |
| American Standard Version, **1901**, eBible ID `eng-asv` | Full 66 books. Historic formal translation; archaic American English. This is not NASB or an entitlement to any modern ASV revision. | eBible marks this exact edition public domain. Full display, persistent caches, quoted highlights/notes, and runtime model input have no translation copyright restriction. Good easy fallback, less appealing than LSV for modern reading. [7] |
| Young's Literal Translation, **1898**, eBible ID `engylt` | Full 66-book text is available from eBible; its module is named `engylt1898eb`. CrossWire independently identifies its YLT module as the 1898 edition. Very literal, archaic British English. | Public domain. Suitable for self-hosting and runtime annotation input. **bible-api.com's `ylt` is explicitly NT-only**, so adding that identifier to the existing provider does not meet full-Bible coverage. Do not silently fill missing OT passages from WEB. [8][11] |
| Open English Bible, **2025.6**, US or Commonwealth spelling | **Partial**: full NT, Psalms, Genesis, and other selected OT books. The release announcement highlights the addition of Genesis; it is not a finished OT+NT Bible. Modern translation, not an established paraphrase alternative. | CC0 permits redistribution, caching, adaptation, and runtime AI input without negotiated rights. Useful only as a clearly marked partial comparison version. Source USFM and text downloads are available. [12] |
| unfoldingWord Literal Text and Simplified Text, **v91**, released 2026-09-26 | **Stable release has 32 OT + 27 NT books, 59 total**. Missing Numbers, 1–2 Chronicles, Ecclesiastes, Isaiah, Jeremiah, and Ezekiel. The `master` directories list all 66 book files, but file presence is not proof of complete, checked text. ULT is a form-centric ASV adaptation; UST is a meaning-centric adaptation of *A Translation For Translators*, with implied information made explicit. Both are translator tools, not ordinary reader Bibles. | CC BY-SA 4.0, with trademark rules. Full redistribution/caching of the licensed material is allowed, and no AI-specific ban was found in the reviewed license/README or official licensing pages. Runtime AI rests on the general reproduction/adaptation grant, not a specific publisher AI endorsement. Do not ship either as a complete stable Bible or use UST as a polished MSG replacement. [9][10][13] |

The unfoldingWord marketing content page still links v85 and labels the resources in progress. Prefer the actual v91 release metadata and file manifests over a link caption such as "Whole UST." The release ZIPs contain only the released books. [9][13]

## What runtime AI and ShareAlike require

Public-domain text and a CC license are different permission bases. BSB's dedication expressly allows all uses. For LSV, FBV, ULT, and UST, CC BY-SA 4.0 expressly grants worldwide reproduction, sharing, and adaptation in any medium. This supplies a copyright basis for direct-source, on-demand model processing; it is not merely an inference from the absence of an AI ban. No reviewed candidate license contains an AI-specific prompt prohibition. Model-provider terms and any additional delivery-service contract still need separate checking. [1][3][5][9][10]

- Preserve creator/copyright notices, source links, the CC BY-SA 4.0 link, and supplied disclaimers. Mark changes and do not imply publisher endorsement. For full LSV distribution, its publisher specifically requests the full name "Literal Standard Version (LSV)" and organizational attribution to Covenant Press / Covenant Christian Coalition. FBV credits Dr. Jonathan Gallagher. [3][5][10]
- Keep the original Bible dataset unchanged. Display AI commentary separately, with its source translation and generated status. If an annotation, rewrite, or export constitutes adapted material, ShareAlike applies when shared. A conservative implementation makes source-dependent adaptations available under CC BY-SA 4.0 to the extent copyright exists. Independent commentary and user notes are not automatically adaptations merely because they sit beside a verse. Do not claim all outputs are independent or that ShareAlike automatically licenses the entire application. [10]
- Do not impose app terms or DRM that remove readers' CC rights over licensed Scripture or adaptations. Keep the licensed Scripture dataset separate from private notes and application code. CC's database-rights clause can also matter for a redistributed database containing a substantial portion of the licensed content. [10]
- Do not grant an LLM provider broader ownership/exclusive rights in the source than Marginalia has. Prefer inference-only handling without provider training or unnecessary retention; this is a risk-control recommendation, not a translation-license requirement. Keep private user notes out of prompts unless needed and authorized.
- unfoldingWord requires its trademark to remain with unmodified copies, but to be removed from modified/translated derivatives, which must carry the specified original-work attribution. Its general website licensing page additionally calls for the logo on unaltered distributed content. Do not brand model-generated text as an official unfoldingWord resource. [9][13]

Do **not** retrieve the CC versions through API.Bible's Express Licensing route and assume their open license overrides that service's prompt restrictions. Use the direct sources below. The existing research records API.Bible's separate prohibition on copyrighted prompt context, including CC text. [14]

## Implementation options

### Preferred: import a pinned source and serve passages locally

The listed links were verified on official download/catalog pages; archive contents were not downloaded or audited.

| Text | Machine-readable source | Implementation note |
| --- | --- | --- |
| BSB | Publisher [download index](https://berean.bible/downloads.htm), including [USFM](https://bereanbible.com/bsb_usfm.zip), [USJ](https://bereanbible.com/bsb_usj.zip), [USX](https://bereanbible.com/bsb_usx.zip), and [text](https://bereanbible.com/bsb.txt) | Current third-printing sources; older study-tool files are explicitly second printing. Berean Literal Bible is separately listed **NT-only**, not another full-Bible choice. [2] |
| LSV | Publisher [format list](https://www.lsvbible.com/p/get-lsv.html) includes plain text and SWORD; publisher-linked eBible provides [USFM](https://ebible.org/Scriptures/englsv_usfm.zip), USFX, and VPL/SQL | Use standard `englsv`, not the expanded apocrypha collection. Pin the artifact date/hash; a 2020 copyright does not identify every subsequent textual revision. [3][4] |
| FBV | Publisher directs implementers to [eBible `engfbv`](https://ebible.org/find/details.php?id=engfbv), including [USFM](https://ebible.org/Scriptures/engfbv_usfm.zip), USFX, and VPL/SQL | eBible's description still says "New Testament and Psalms," but its [actual index](https://ebible.org/engfbv/) lists all 66 books and the publisher announces the full Bible. Confirm its revision matches the intended v5.2 before importing. [5][6] |
| ASV / YLT | eBible [ASV catalog](https://ebible.org/find/details.php?id=eng-asv) / [YLT catalog](https://ebible.org/find/details.php?id=engylt), including [ASV USFM](https://ebible.org/Scriptures/eng-asv_usfm.zip) / [YLT USFM](https://ebible.org/Scriptures/engylt_usfm.zip), USFX, and VPL/SQL | Select ASV 1901 / YLT 1898 explicitly, with complete OT+NT. [7][8] |
| OEB / ULT / UST | OEB's [versioned download index](https://openenglishbible.org/) includes USFM; Door43 [ULT v91](https://git.door43.org/unfoldingWord/en_ult/releases/tag/v91) / [UST v91](https://git.door43.org/unfoldingWord/en_ust/releases/tag/v91) include source ZIPs and raw USFM | Suitable for partial specialist comparison only under the decisions above. Door43's public metadata API can discover releases without a publisher key. [9][12] |

Import into a dedicated edition-keyed verse store or static chapter JSON, then adapt `packages/backend/convex/lib/bibleProvider.ts` to return its existing passage shape. There is no need to negotiate a publisher license or rely on a paid passage API for these direct-source editions. Record source URL, artifact checksum, revision, license, coverage, and independent display/AI policy. Validate chapter/verse coverage during import, including omissions and verse spans, rather than assuming a universal verse count.

Key passages, annotation caches, highlights, and notes by **translation + edition + reference**, with offsets tied to the immutable text snapshot. No translation-license TTL is imposed on the identified public-domain or CC BY-SA sources. Maintain attribution in exports and quoted notes, and review source updates deliberately rather than silently moving saved highlights onto different wording. [1][10]

### Smaller change: use the existing service for ASV

[bible-api.com](https://bible-api.com/) documents `asv` and `/data/asv/{BOOK_ID}/{CHAPTER}`, so ASV is the smallest provider extension. It does not list BSB, LSV, or FBV. Its YLT is NT-only. The service is limited to 15 requests per 30 seconds per IP, has no availability guarantee, and explicitly forbids using its API to download an entire Bible. Use passage requests only, or import permitted source files and self-host. Do not scrape readers or bulk-prefetch this hobby service. [11]

## Official sources

1. Berean [terms and CC0-linked public-domain dedication](https://berean.bible/terms.htm), effective 2023-04-30; [no licensing required](https://berean.bible/licensing.htm).
2. Berean [current downloads and edition distinctions](https://berean.bible/downloads.htm).
3. LSV [publisher formats and permissions](https://www.lsvbible.com/p/get-lsv.html); [formal-equivalence preface](https://www.lsvbible.com/p/the-preface-to-literal-standard-version.html).
4. Publisher-linked eBible [LSV license and formats](https://ebible.org/find/details.php?id=englsv); [66-book index](https://ebible.org/englsv/).
5. FBV [publisher's full v5.2 announcement, license, and distributor link](https://www.freebibleversion.org/).
6. FBV [translator's account of its sources](https://www.freebibleversion.org/info.html); eBible [license/formats](https://ebible.org/find/details.php?id=engfbv) and [66-book index](https://ebible.org/engfbv/).
7. eBible [ASV 1901 license/formats](https://ebible.org/find/details.php?id=eng-asv) and [full index](https://ebible.org/eng-asv/).
8. eBible [YLT license/formats](https://ebible.org/find/details.php?id=engylt) and [full index](https://ebible.org/engylt/); CrossWire [YLT 1898 module metadata](https://www.crosswire.org/sword/modules/ModInfo.jsp?modName=YLT).
9. unfoldingWord [ULT v91 release](https://git.door43.org/unfoldingWord/en_ult/releases/tag/v91), [UST v91 release](https://git.door43.org/unfoldingWord/en_ust/releases/tag/v91), [ULT license](https://git.door43.org/unfoldingWord/en_ult/raw/tag/v91/LICENSE.md), [UST license](https://git.door43.org/unfoldingWord/en_ust/raw/tag/v91/LICENSE.md), [ULT purpose](https://git.door43.org/unfoldingWord/en_ult/raw/tag/v91/README.md), and [UST purpose](https://git.door43.org/unfoldingWord/en_ust/raw/tag/v91/README.md).
10. Creative Commons [CC BY-SA 4.0 legal code](https://creativecommons.org/licenses/by-sa/4.0/legalcode.en), especially §§1, 2, 3, and 4. AI use here relies on this broad grant, with applicable conditions, rather than a claim of AI-specific publisher approval.
11. [bible-api.com official documentation, translation list, and service terms](https://bible-api.com/).
12. OEB [2025.6 downloads and CC0 notice](https://openenglishbible.org/), [release announcement](https://openenglishbible.org/blog/2025.6-release/), and [linked-book coverage](https://openenglishbible.org/oeb/2025.6/read/).
13. unfoldingWord [content page](https://unfoldingword.org/for-translators/content), [general license/trademark policy](https://unfoldingword.org/about/license), and Door43 [licensing](https://door43.org/en/copyright-and-licensing/). Development file listings, not full text, were checked through the official public APIs for [ULT master](https://git.door43.org/api/v1/repos/unfoldingWord/en_ult/contents?ref=master) and [UST master](https://git.door43.org/api/v1/repos/unfoldingWord/en_ust/contents?ref=master).
14. [API.Bible Express Licensing FAQ](https://care.api.bible/article/405-express-licensing-faqs).
