import { describe, expect, it, vi } from "vitest";
import { parseBibleReference } from "./bible";
import {
  rankRelatedReferences,
  selectCommentaryCandidates,
  selectRelatedReferences,
  selectStudySourceRecords,
} from "./scriptureStudySourceSelection";
import {
  getSourceText,
  relatedReferencesFromHtml,
} from "./scriptureStudySourceShared";
import {
  loadAdditionalStudyEvidence,
  parseByzTxtCsv,
  SCRIPTURE_STUDY_SOURCE_LIMITS,
} from "./scriptureStudySources";

const john = parseBibleReference("John 1:18");
if (!john) throw new Error("Test reference should parse.");
const aquiferItem = {
  content_id: "note-1",
  reference_id: 123,
  version: "2026-01",
  title: "John 1:18 — The Word",
  media_type: "Text",
  index_reference: "John 1:18",
  language: "eng",
  review_level: "reviewed",
  content:
    '<p>Two <em>readings</em> &amp; notes.</p><data class="bible-ref" data-start-ref="26034012" data-end-ref="26034012">Ezekiel 34:12</data><data class="bible-ref" data-start-ref="43010011" data-end-ref="43010011">John 10:11</data><script>ignore this</script>',
  associations: {
    passage: [
      {
        start_ref_usfm: "JHN 1:18",
        end_ref_usfm: "JHN 1:18",
        start_ref: "43001018",
        end_ref: "43001018",
      },
    ],
  },
};

function response(text: string, status = 200, headers: HeadersInit = {}) {
  return new Response(text, { status, headers });
}

describe("bounded pinned Scripture evidence adapters", () => {
  it("selects commentary across the passage regardless of source order", () => {
    const range = parseBibleReference("Colossians 2:6-23");
    if (!range) throw new Error("Test reference should parse.");
    const candidates = [
      {
        identity: "end",
        referenceKey: "COL.2.20-COL.2.23",
        excerpt: "end",
      },
      {
        identity: "opening",
        referenceKey: "COL.2.6-COL.2.9",
        excerpt: "opening",
      },
      {
        identity: "middle",
        referenceKey: "COL.2.12-COL.2.17",
        excerpt: "middle",
      },
      {
        identity: "duplicate",
        referenceKey: "COL.2.18-COL.2.19",
        excerpt: " middle ",
      },
      { identity: "unrelated", referenceKey: "COL.1.1", excerpt: "unrelated" },
    ];
    const select = (items: typeof candidates) =>
      selectCommentaryCandidates(items, {
        reference: range,
        maxItems: 3,
        maxChars: 100,
      }).map((item) => item.identity);
    expect(select(candidates)).toEqual(["opening", "middle", "end"]);
    expect(select([...candidates].reverse())).toEqual(select(candidates));
  });

  it("keeps specific conclusion detail after broad notes cover the whole passage", () => {
    const range = parseBibleReference("Colossians 2:1-23");
    if (!range) throw new Error("Test reference should parse.");
    const candidates = [
      {
        identity: "specific-conclusion",
        referenceKey: "COL.2.23",
        excerpt: "Specific conclusion detail.",
      },
      {
        identity: "broad-middle",
        referenceKey: "COL.2.6-COL.2.15",
        excerpt: "Middle argument overview.",
      },
      {
        identity: "specific-opening",
        referenceKey: "COL.2.1",
        excerpt: "Specific opening detail.",
      },
      {
        identity: "broad-conclusion",
        referenceKey: "COL.2.16-COL.2.23",
        excerpt: "Conclusion argument overview.",
      },
      {
        identity: "specific-middle",
        referenceKey: "COL.2.12",
        excerpt: "Specific middle detail.",
      },
      {
        identity: "broad-opening",
        referenceKey: "COL.2.1-COL.2.5",
        excerpt: "Opening argument overview.",
      },
    ];
    const select = (items: typeof candidates) =>
      selectCommentaryCandidates(items, {
        reference: range,
        maxItems: 6,
        maxChars: 1_000,
      }).map((item) => item.identity);
    const selected = select(candidates);
    expect(selected.slice(0, 3)).toEqual([
      "broad-opening",
      "broad-middle",
      "broad-conclusion",
    ]);
    expect(selected.slice(3)).toContain("specific-conclusion");
    expect(selected.slice(3)).toContain("specific-middle");
    expect(selected.slice(3)).toContain("specific-opening");
    expect(select([...candidates].reverse())).toEqual(selected);
  });

  it("keeps sparse commentary and source identity within record and character budgets", () => {
    const range = parseBibleReference("Acts 21:6");
    if (!range) throw new Error("Test reference should parse.");
    const note = {
      sourceId: "aquifer-open-study-notes",
      title: "Aquifer note",
      revision: "r1:item1",
      locator: "41.content.json#item1",
      referenceKey: "ACT.21.6",
      excerpt: "A useful explanation.",
      sourceUrl: "https://example.test/source",
      contentHash: "hash",
      license: "CC BY-SA 4.0",
      licenseUrl: "https://example.test/license",
      attribution: "attribution",
      capabilities: ["attributed-study-note"],
      limitations: ["source limitation"],
    };
    const selected = selectStudySourceRecords([note], {
      reference: range,
      maxRecords: 2,
      maxChars: 100,
    });
    expect(selected).toEqual([note]);
    expect(selected[0]).toMatchObject({
      locator: note.locator,
      revision: note.revision,
      contentHash: note.contentHash,
      license: note.license,
      attribution: note.attribution,
      limitations: note.limitations,
    });
    expect(
      selectStudySourceRecords([note], {
        reference: range,
        maxRecords: 1,
        maxChars: 5,
      }),
    ).toEqual([]);
  });

  it("allocates the same source identities when action evidence order changes", () => {
    const range = parseBibleReference("Colossians 2:6-23");
    if (!range) throw new Error("Test reference should parse.");
    const makeRecord = (
      sourceId: string,
      locator: string,
      referenceKey: string,
      excerpt: string,
    ) => ({
      sourceId,
      title: locator,
      revision: `${sourceId}:revision`,
      locator,
      referenceKey,
      excerpt,
      sourceUrl: "https://example.test/source",
      contentHash: locator,
      license: "CC BY-SA 4.0",
      licenseUrl: "https://example.test/license",
      attribution: "attribution",
      capabilities: ["attributed-study-note"],
      limitations: [],
    });
    const records = [
      makeRecord(
        "aquifer-open-study-notes",
        "end",
        "COL.2.20-COL.2.23",
        "end note",
      ),
      makeRecord(
        "aquifer-open-study-notes",
        "middle",
        "COL.2.12-COL.2.15",
        "middle note",
      ),
      makeRecord(
        "byztxt-printed-edition-variants",
        "variants",
        "COL.2.18",
        "variant comparison",
      ),
      makeRecord(
        "aquifer-open-study-notes",
        "opening",
        "COL.2.6-COL.2.9",
        "opening note",
      ),
    ];
    const select = (items: typeof records) =>
      selectStudySourceRecords(items, {
        reference: range,
        maxRecords: 4,
        maxChars: 200,
      }).map((record) => [record.locator, record.contentHash]);
    expect(select([...records].reverse())).toEqual(select(records));
  });

  it("ranks repeated cross-chapter references ahead of supplied same-chapter links", () => {
    const note = (relatedReferences: string[]) => ({
      sourceId: "aquifer-open-study-notes",
      title: "Aquifer note",
      revision: "r1:item1",
      locator: "41.content.json#item1",
      referenceKey: "COL.2.6-COL.2.23",
      excerpt: "note",
      sourceUrl: "https://example.test/source",
      contentHash: "hash",
      license: "CC BY-SA 4.0",
      licenseUrl: "https://example.test/license",
      attribution: "attribution",
      capabilities: ["attributed-study-note"],
      limitations: [],
      relatedReferences,
    });
    const range = parseBibleReference("Colossians 2:6-23");
    if (!range) throw new Error("Test reference should parse.");
    const records = [
      note(["COL.2.18", "JHN.15.4", "ROM.6.3"]),
      note(["JHN.15.4"]),
    ];
    expect(rankRelatedReferences(records, range)).toEqual([
      "JHN.15.4",
      "ROM.6.3",
      "COL.2.18",
    ]);
    expect(
      selectRelatedReferences(records, {
        reference: range,
        suppliedRanges: ["COL.2.6-COL.2.23"],
        limit: 2,
      }),
    ).toEqual(["JHN.15.4", "ROM.6.3"]);
  });

  it("parses the inspected John 1:18 printed-edition difference exactly", () => {
    const csv =
      'chapter,verse,text\n1,18,"Θεὸν οὐδεὶς ἑώρακεν πώποτε· ὁ {NA ὁ μονογενὴς υἱός > μονογενὴς θεός } μονογενὴς υἱός, ὁ ὢν εἰς τὸν κόλπον τοῦ πατρός, ἐκεῖνος ἐξηγήσατο."\n';
    expect(parseByzTxtCsv(csv, john)).toEqual([
      {
        chapter: 1,
        verse: 18,
        sourceText:
          "Θεὸν οὐδεὶς ἑώρακεν πώποτε· ὁ {NA ὁ μονογενὴς υἱός > μονογενὴς θεός } μονογενὴς υἱός, ὁ ὢν εἰς τὸν κόλπον τοῦ πατρός, ἐκεῖνος ἐξηγήσατο.",
        variants: [
          {
            code: "NA",
            edition: "Nestle-Aland",
            baseReading: "ὁ μονογενὴς υἱός",
            alternateReading: "μονογενὴς θεός",
          },
        ],
        variantsTruncated: false,
        hasUnparsedVariantSyntax: false,
      },
    ]);
  });

  it("caps printed-edition variants and reports truncation", () => {
    const variants = Array.from(
      { length: SCRIPTURE_STUDY_SOURCE_LIMITS.variantsPerVerse + 2 },
      (_, index) => `{NA base${index} > alternative${index}}`,
    ).join(" ");
    const parsed = parseByzTxtCsv(
      `chapter,verse,text\n1,18,"${variants}"\n`,
      john,
    );
    expect(parsed[0].variants).toHaveLength(
      SCRIPTURE_STUDY_SOURCE_LIMITS.variantsPerVerse,
    );
    expect(parsed[0].variantsTruncated).toBe(true);
  });

  it("maps every documented CSV edition marker", () => {
    const codes = ["NA", "Byz", "NA27/28", "ECM", "NA27", "NA28"];
    const text = codes.map((code) => `{${code} base > alternate}`).join(" ");
    const parsed = parseByzTxtCsv(`chapter,verse,text\n1,18,"${text}"\n`, john);
    expect(parsed[0].variants.map((variant) => variant.code)).toEqual(codes);
    expect(parsed[0].variants.map((variant) => variant.edition)).toEqual([
      "Nestle-Aland",
      "Byzantine",
      "NA27/28",
      "ECM",
      "NA27",
      "NA28",
    ]);
  });

  it("matches associated Aquifer notes and returns attributed, plain bounded text", async () => {
    const urls: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      const url = String(input);
      urls.push(url);
      return url.includes("Aquifer")
        ? response(JSON.stringify([aquiferItem]))
        : response(
            'chapter,verse,text\n1,18,"Θεὸν οὐδεὶς ἑώρακεν πώποτε· ὁ {NA ὁ μονογενὴς υἱός > μονογενὴς θεός } μονογενὴς υἱός, ὁ ὢν εἰς τὸν κόλπον τοῦ πατρός, ἐκεῖνος ἐξηγήσατο."\n',
          );
    };
    const result = await loadAdditionalStudyEvidence(john, { fetch: fetcher });
    expect(urls).toHaveLength(2);
    const commentary = result.records.find(
      (record) => record.sourceId === "aquifer-open-study-notes",
    );
    const variant = result.records.find(
      (record) => record.sourceId === "byztxt-printed-edition-variants",
    );
    expect(commentary).toBeDefined();
    expect(variant).toBeDefined();
    expect(commentary).toMatchObject({
      sourceId: "aquifer-open-study-notes",
      title: expect.stringContaining("Aquifer Open Study Notes"),
      referenceKey: "JHN.1.18",
      excerpt: expect.stringContaining("Two readings & notes."),
      license: "CC BY-SA 4.0",
      revision: expect.stringContaining("note-1"),
    });
    expect(commentary?.contentHash).toMatch(/^[\da-f]{64}$/);
    expect(commentary?.excerpt).not.toContain("ignore this");
    expect(commentary?.relatedReferences).toEqual(["EZK.34.12", "JHN.10.11"]);
    expect(variant?.excerpt).toContain("ByzTxt source verse JHN.1.18:");
    expect(variant?.excerpt).toContain("comparison (NA, Nestle-Aland)");
    expect(variant?.excerpt).toContain("ὁ μονογενὴς υἱός > μονογενὴς θεός");
    expect(variant?.excerpt).toContain("not a manuscript-witness collation");
  });

  it("covers the start, middle and end before stable detail ties regardless of file order", async () => {
    const colossians = parseBibleReference("Colossians 2:6-23");
    if (!colossians) throw new Error("Test reference should parse.");
    const intervals = [
      [6, 9],
      [10, 11],
      [12, 15],
      [16, 17],
      [18, 19],
      [20, 23],
    ];
    const items = intervals.map(([start, end]) => ({
      ...aquiferItem,
      content_id: `col-${start}`,
      title: `Colossians 2:${start}-${end}`,
      content: `<p>Explanation for verses ${start}-${end}.</p>`,
      associations: {
        passage: [
          {
            start_ref_usfm: `COL 2:${start}`,
            end_ref_usfm: `COL 2:${end}`,
            start_ref: `51002${String(start).padStart(3, "0")}`,
            end_ref: `51002${String(end).padStart(3, "0")}`,
          },
        ],
      },
    }));
    const load = async (notes: typeof items) =>
      loadAdditionalStudyEvidence(colossians, {
        fetch: async (input) =>
          String(input).includes("Aquifer")
            ? response(JSON.stringify(notes))
            : response("chapter,verse,text\n"),
      });
    const forward = await load(items);
    const reverse = await load([...items].reverse());
    const refs = (result: Awaited<ReturnType<typeof load>>) =>
      result.records
        .filter((record) => record.sourceId === "aquifer-open-study-notes")
        .map((record) => record.referenceKey);
    expect(refs(forward).slice(0, 3)).toEqual([
      "COL.2.6-COL.2.9",
      "COL.2.12-COL.2.15",
      "COL.2.20-COL.2.23",
    ]);
    expect(refs(forward)).toHaveLength(
      SCRIPTURE_STUDY_SOURCE_LIMITS.commentaryNotes,
    );
    expect(refs(forward).slice(3)).toEqual(
      expect.arrayContaining([
        "COL.2.10-COL.2.11",
        "COL.2.16-COL.2.17",
        "COL.2.18-COL.2.19",
      ]),
    );
    expect(refs(reverse)).toEqual(refs(forward));
  });

  it("keeps supplied related references as lower-ranked fallbacks", () => {
    const note = (relatedReferences: string[]) => ({
      sourceId: "aquifer-open-study-notes",
      title: "Aquifer note",
      revision: "r1:item1",
      locator: "41.content.json#item1",
      referenceKey: "COL.2.6-COL.2.23",
      excerpt: "note",
      sourceUrl: "https://example.test/source",
      contentHash: "hash",
      license: "CC BY-SA 4.0",
      licenseUrl: "https://example.test/license",
      attribution: "attribution",
      capabilities: ["attributed-study-note"],
      limitations: [],
      relatedReferences,
    });
    const reference = parseBibleReference("Colossians 2:6-23");
    if (!reference) throw new Error("Test reference should parse.");
    const records = [note(["COL.2.18", "ROM.6.3", "JHN.15.4"])];
    const options = {
      reference,
      suppliedRanges: ["COL.2.6-COL.2.23"],
      limit: 3,
    };
    expect(selectRelatedReferences(records, { ...options, limit: 2 })).toEqual([
      "JHN.15.4",
      "ROM.6.3",
    ]);
    expect(selectRelatedReferences(records, options)).toEqual([
      "JHN.15.4",
      "ROM.6.3",
      "COL.2.18",
    ]);
  });

  it("matches note associations by chapter as well as verse", async () => {
    const psalm = parseBibleReference("Psalm 23:4");
    if (!psalm) throw new Error("Test reference should parse.");
    const chapterOne = {
      ...aquiferItem,
      content_id: "wrong-chapter",
      title: "Wrong chapter canary",
      content: "WRONG_CHAPTER_CANARY",
      associations: {
        passage: [
          {
            start_ref_usfm: "PSA 1:4",
            end_ref_usfm: "PSA 1:4",
            start_ref: "19001004",
            end_ref: "19001004",
          },
        ],
      },
    };
    const selected = {
      ...aquiferItem,
      content_id: "selected-chapter",
      title: "Selected chapter canary",
      content:
        '<p>SELECTED_CHAPTER_CANARY</p><data class="bible-ref" data-start-ref="26034012" data-end-ref="26034012">Ezekiel 34:12</data><data class="bible-ref" data-start-ref="43010011" data-end-ref="43010011">John 10:11</data><data class="bible-ref" data-start-ref="26023004" data-end-ref="26023004">same numeric chapter and verse, different book</data><data class="bible-ref" data-start-ref="26034012" data-end-ref="26035001">cross chapter</data><data class="bible-ref" data-start-ref="99001001" data-end-ref="99001001">out of canon</data><data class="bible-ref" data-start-ref="43000000" data-end-ref="43000000">zero</data><data class="bible-ref" data-start-ref="bad" data-end-ref="43010011">malformed</data>',
      associations: {
        passage: [
          {
            start_ref_usfm: "PSA 23:4",
            end_ref_usfm: "PSA 23:4",
            start_ref: "19023004",
            end_ref: "19023004",
          },
        ],
      },
    };
    const result = await loadAdditionalStudyEvidence(psalm, {
      fetch: async (input) =>
        String(input).includes("Aquifer")
          ? response(JSON.stringify([chapterOne, selected]))
          : response("chapter,verse,text\n"),
    });
    expect(result.records[0].excerpt).toContain("SELECTED_CHAPTER_CANARY");
    expect(result.records[0].relatedReferences).toEqual([
      "EZK.23.4",
      "EZK.34.12",
      "JHN.10.11",
    ]);
  });

  it("deduplicates related references, rejects selected-range overlap, and caps at twelve", () => {
    const psalm = parseBibleReference("Psalm 23:4");
    if (!psalm) throw new Error("Test reference should parse.");
    const ids = [
      "26034012",
      "43010011",
      "19001001",
      "26023004",
      "19001001",
      "43001011",
      "43001012",
      "19023004",
    ];
    const html = ids
      .map(
        (id) =>
          `<data class="bible-ref" data-start-ref="${id}" data-end-ref="${id}"></data>`,
      )
      .join("");
    expect(relatedReferencesFromHtml(html, psalm)).toEqual([
      "EZK.23.4",
      "EZK.34.12",
      "JHN.1.11",
      "JHN.1.12",
      "JHN.10.11",
      "PSA.1.1",
    ]);
    expect(
      relatedReferencesFromHtml(
        [...ids]
          .reverse()
          .map(
            (id) =>
              `<data class="bible-ref" data-start-ref="${id}" data-end-ref="${id}"></data>`,
          )
          .join(""),
        psalm,
      ),
    ).toEqual(relatedReferencesFromHtml(html, psalm));
    const many = Array.from({ length: 15 }, (_, index) => {
      const id = `19001${String(index + 1).padStart(3, "0")}`;
      return `<data class="bible-ref" data-start-ref="${id}" data-end-ref="${id}"></data>`;
    }).join("");
    expect(relatedReferencesFromHtml(many, psalm)).toHaveLength(
      SCRIPTURE_STUDY_SOURCE_LIMITS.relatedReferencesPerNote,
    );
    expect(
      relatedReferencesFromHtml(
        many
          .split(/(?=<data)/)
          .reverse()
          .join(""),
        psalm,
      ),
    ).toEqual(relatedReferencesFromHtml(many, psalm));
  });

  it("does not treat context-only, cross-book, or wrong numeric associations as matches", async () => {
    const outside = {
      ...aquiferItem,
      associations: {
        passage: [
          {
            start_ref_usfm: "JHN 1:1",
            end_ref_usfm: "JHN 1:3",
            start_ref: "43001001",
            end_ref: "43001003",
          },
        ],
      },
    };
    const wrongNumeric = {
      ...aquiferItem,
      associations: {
        passage: [
          {
            start_ref_usfm: "JHN 1:18",
            end_ref_usfm: "JHN 1:18",
            start_ref: "43001017",
            end_ref: "43001018",
          },
        ],
      },
    };
    const wrongBook = {
      ...aquiferItem,
      associations: {
        passage: [
          {
            start_ref_usfm: "PSA 23:1",
            end_ref_usfm: "PSA 23:1",
            start_ref: "19023001",
            end_ref: "19023001",
          },
        ],
      },
    };
    const result = await loadAdditionalStudyEvidence(john, {
      fetch: async (input) =>
        String(input).includes("Aquifer")
          ? response(JSON.stringify([outside, wrongNumeric, wrongBook]))
          : response("chapter,verse,text\n1,18,δοκιμή\n"),
    });
    expect(result.records).toEqual([]);
    expect(result.coverageWarnings).toContain(
      "No structurally verified matching Aquifer notes were found.",
    );
  });

  it("accepts an overlapping same-chapter note and exposes only verified related-reference candidates", async () => {
    const overlapping = {
      ...aquiferItem,
      content:
        '<p>Note</p><data class="bible-ref" data-start-ref="43001018" data-end-ref="43001018">current verse</data><data class="bible-ref" data-start-ref="43001020" data-end-ref="43001021">nearby range</data>',
      associations: {
        passage: [
          {
            start_ref_usfm: "JHN 1:17",
            end_ref_usfm: "JHN 1:19",
            start_ref: "43001017",
            end_ref: "43001019",
          },
          {
            start_ref_usfm: "JHN 1:20",
            end_ref_usfm: "JHN 1:21",
            start_ref: "43001020",
            end_ref: "43001021",
          },
          {
            start_ref_usfm: "JHN 1:20",
            end_ref_usfm: "JHN 2:1",
            start_ref: "43001020",
            end_ref: "43002001",
          },
        ],
      },
    };
    const result = await loadAdditionalStudyEvidence(john, {
      fetch: async (input) =>
        String(input).includes("Aquifer")
          ? response(JSON.stringify([overlapping]))
          : response("chapter,verse,text\n1,18,δοκιμή\n"),
    });
    expect(result.records[0]).toMatchObject({
      referenceKey: "JHN.1.17-JHN.1.19",
      relatedReferences: ["JHN.1.20-JHN.1.21"],
    });
  });

  it("rejects malformed CSV and unknown or malformed variant markers honestly", () => {
    expect(() =>
      parseByzTxtCsv('chapter,verse,text\n1,18,"broken', john),
    ).toThrow("unterminated quoted field");
    const unknown = parseByzTxtCsv(
      'chapter,verse,text\n1,18,"x {Q ὁ > θεός } y"\n',
      john,
    );
    expect(unknown[0].variants).toEqual([]);
    expect(unknown[0].hasUnparsedVariantSyntax).toBe(true);
    const malformed = parseByzTxtCsv(
      'chapter,verse,text\n1,18,"x {NA ὁ > } y"\n',
      john,
    );
    expect(malformed[0].variants).toEqual([]);
    expect(malformed[0].hasUnparsedVariantSyntax).toBe(true);
  });

  it("enforces response size, reports 404s, and forwards cancellation and timeout", async () => {
    const tooLarge = await loadAdditionalStudyEvidence(john, {
      fetch: async (input) =>
        String(input).includes("Aquifer")
          ? response("[]", 200, {
              "content-length": String(
                SCRIPTURE_STUDY_SOURCE_LIMITS.commentaryBytes + 1,
              ),
            })
          : response("chapter,verse,text\n1,18,δοκιμή\n"),
    });
    expect(
      tooLarge.coverageWarnings.some((warning) =>
        warning.includes("byte limit"),
      ),
    ).toBe(true);

    const oversizedStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new Uint8Array(SCRIPTURE_STUDY_SOURCE_LIMITS.commentaryBytes + 1),
        );
      },
    });
    const unannouncedTooLarge = await loadAdditionalStudyEvidence(john, {
      fetch: async (input) =>
        String(input).includes("Aquifer")
          ? new Response(oversizedStream)
          : response("chapter,verse,text\n1,18,δοκιμή\n"),
    });
    expect(
      unannouncedTooLarge.coverageWarnings.some((warning) =>
        warning.includes("byte limit"),
      ),
    ).toBe(true);

    const missing = await loadAdditionalStudyEvidence(john, {
      fetch: async (input) =>
        String(input).includes("Aquifer")
          ? response("", 404)
          : response("chapter,verse,text\n1,18,δοκιμή\n"),
    });
    expect(
      missing.coverageWarnings.some((warning) => warning.includes("HTTP 404")),
    ).toBe(true);

    const timeoutMock = vi
      .spyOn(AbortSignal, "timeout")
      .mockImplementation(() =>
        AbortSignal.abort(new DOMException("timed out", "TimeoutError")),
      );
    const timedOutFetch: typeof fetch = async (_input, init) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      if (init?.signal?.aborted) throw init.signal.reason;
      return response("[]");
    };
    const aborted = await loadAdditionalStudyEvidence(john, {
      fetch: timedOutFetch,
    });
    timeoutMock.mockRestore();
    expect(
      aborted.coverageWarnings.some((warning) => /timed out/i.test(warning)),
    ).toBe(true);
  });

  it("cancels a never-ending response body when the caller aborts", async () => {
    const controller = new AbortController();
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start() {},
      cancel() {
        cancelled = true;
      },
    });
    const pending = getSourceText("https://example.invalid/source", 100, {
      signal: controller.signal,
      fetch: async () => new Response(body),
    });
    setTimeout(
      () => controller.abort(new DOMException("cancelled", "AbortError")),
      5,
    );
    await expect(pending).rejects.toThrow("cancelled");
    expect(cancelled).toBe(true);
  });

  it("caps returned commentary notes and excerpts", async () => {
    const many = Array.from({ length: 12 }, (_, index) => ({
      ...aquiferItem,
      content_id: `note-${index}`,
      content: `<p>Note ${index}: ${"x".repeat(2000)}</p>`,
    }));
    const result = await loadAdditionalStudyEvidence(john, {
      fetch: async (input) =>
        String(input).includes("Aquifer")
          ? response(JSON.stringify(many))
          : response("chapter,verse,text\n1,18,δοκιμή\n"),
    });
    expect(result.records).toHaveLength(
      SCRIPTURE_STUDY_SOURCE_LIMITS.commentaryNotes,
    );
    expect(
      result.records.every((record) => record.excerpt.length === 1800),
    ).toBe(true);
  });
});
