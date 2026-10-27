# Bible word-study data notices

Open **Word study · Greek / Hebrew / Strong’s** in a Bible reading to inspect source attribution, exact downloads, license terms and pinned revisions. These data licenses are separate from Marginalia's MIT OR Apache-2.0 application-code license. Source datasets are fetched server-side, not bundled into the application source.

## Greek verse text and morphology

- Source: [ByzTxt / Robinson-Pierpont](https://github.com/ByzTxt/byzantine-majority-text).
- Revision: `27a45ff1b7be6c17ccbfeac414f3f55732ae8e28`.
- Data: `csv-unicode/strongs/with-parsing/*.csv`.
- License: public domain, as declared in the project's README.
- Processing: extract supplied verse tokens, Strong’s numbers and morphology tags. This unaccented parsed Byzantine text is not represented as the critical text underlying NIV. No English-word alignment is inferred.

## Hebrew / Biblical Aramaic

Original work of the Open Scriptures Hebrew Bible available at https://github.com/openscriptures/morphhb.

- Revision: `3d15126fb1ef74867fc1434be1942e837932691f`.
- Data: WLC book XML and `wlc/VerseMap.xml`.
- License: WLC text is public domain; OSHB lemma/morphology annotations are [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
- Processing: extract verse tokens and lemma/morphology tags without Unicode normalization; use supplied versification mappings. Partial and ambiguous mappings are rejected instead of guessed. Occurrence references use the original source's numbering.

## Historical Strong’s dictionary excerpts

Copyright (c) 2008, Open Scriptures. Unicode spellings enhanced by Darrell H. Smith (2009).

- Source: [Unified Strong’s dictionaries](https://github.com/openscriptures/strongs).
- Revision: `0acd2f251c2d35ff8db2dece4e0593979d3ac223`.
- [Complete corresponding source, including upstream copyright notices](https://raw.githubusercontent.com/openscriptures/strongs/0acd2f251c2d35ff8db2dece4e0593979d3ac223/strongs-dictionary.xhtml).
- License: [GNU GPL version 3](https://www.gnu.org/licenses/gpl-3.0.txt). These electronic dictionary excerpts remain GPL-3.0; they are not relabeled as public domain or as MIT/Apache application code.
- Changes: select entries by verified Strong’s ID, remove markup, collapse whitespace and limit definitions to 4,000 characters. The word-study interface retains attribution, source and license links. The upstream transcription identifies missing spellings; the application does not fill these with model guesses.

The displayed dictionary is a historical sense reference, not a modern contextual lexicon. AI explanations must distinguish that sense range from the likely sense in the passage and acknowledge missing evidence. Same-book occurrence samples are bounded examples, not an exhaustive concordance.

## Deep Study evidence

Deep Study uses the public-domain World English Bible as its Scripture source. Its pinned study-note corpus is Aquifer Open Study Notes at revision `35183d839b73958deca66fe4060d4dc7d4dc23de`, adapted from Tyndale Open Study Notes under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). The pinned manifest and study interface provide attribution, license terms and the changes made. This is one adapted corpus, not a survey or consensus source.

The pinned ByzTxt source at revision `27a45ff1b7be6c17ccbfeac414f3f55732ae8e28` also supplies a comparison among printed editions identified as NA/Byz, NA27–28, ECM, NA27 and NA28. These are edition readings; this comparison does not identify manuscript witnesses or determine an original reading. The Greek, Hebrew and Strong’s sources above supply sampled evidence only. Deep Study does not infer alignment between English and original-language words. Per-result evidence details show each retrieved excerpt, locator, revision, hash and license.
