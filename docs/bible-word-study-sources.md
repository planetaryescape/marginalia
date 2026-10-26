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
