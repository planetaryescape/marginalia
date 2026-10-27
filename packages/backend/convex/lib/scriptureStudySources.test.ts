import { describe, expect, it, vi } from "vitest";
import { parseBibleReference } from "./bible";
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
      "EZK.34.12",
      "JHN.10.11",
      "EZK.23.4",
    ]);
  });

  it("deduplicates related references, rejects selected-range overlap, and caps at four", () => {
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
      "EZK.34.12",
      "JHN.10.11",
      "PSA.1.1",
      "EZK.23.4",
    ]);
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
      content: `<p>${"x".repeat(2000)}</p>`,
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
