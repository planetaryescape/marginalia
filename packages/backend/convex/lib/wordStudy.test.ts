import { describe, expect, it } from "vitest";
import {
  hebrewVerseId,
  parseGreekBook,
  parseHebrewBook,
  strongsEntry,
} from "./wordStudy";

describe("verified original-language study data", () => {
  it("retains Greek tokens, supplied Strong’s IDs and alternative grammatical analyses", () => {
    const result = parseGreekBook(
      "chapter,verse,text\n1,1,λογος 3056 {N-NSM} ερχομενον 2064 {V-PNP-ASM} 2064 {V-PNP-NSN}\n",
      "JHN",
    );
    expect(result[0].id).toBe("JHN.1.1");
    expect(result[0].words).toEqual([
      {
        surface: "λογος",
        lemma: "",
        strongs: ["G3056"],
        morphology: ["N-NSM"],
      },
      {
        surface: "ερχομενον",
        lemma: "",
        strongs: ["G2064"],
        morphology: ["V-PNP-ASM", "V-PNP-NSN"],
      },
    ]);
    expect(
      parseGreekBook("chapter,verse,text\n1,1,αγνωστον\n", "JHN")[0].words[0]
        .strongs,
    ).toEqual([]);
  });
  it("preserves Hebrew combining marks and morphology without Unicode normalization", () => {
    const word = "בְּ/רֵאשִׁ֖ית";
    const xml = `<osis><osisText><div><chapter><verse osisID="Gen.1.1"><w lemma="b/7225" morph="HR/Ncfsa">${word}</w></verse></chapter></div></osisText></osis>`;
    expect(parseHebrewBook(xml)[0]).toMatchObject({
      id: "Gen.1.1",
      words: [
        {
          surface: word,
          lemma: "b/7225",
          strongs: ["H7225"],
          morphology: ["HR/Ncfsa"],
        },
      ],
    });
  });
  it("uses the supplied Hebrew/English verse map and rejects ambiguous partial alignments", () => {
    const map =
      '<verseMap><book osisID="Gen"><verse wlc="Gen.32.2" kjv="Gen.32.1" type="full"/></book></verseMap>';
    expect(hebrewVerseId(map, "Gen", 32, 1)).toBe("Gen.32.2");
    expect(hebrewVerseId(map, "Gen", 1, 1)).toBe("Gen.1.1");
    expect(() =>
      hebrewVerseId(map.replace('type="full"', 'type="partial"'), "Gen", 32, 1),
    ).toThrow("partial");
  });
  it("looks up exact verified dictionary IDs, preserves pronunciation apostrophes and never invents missing entries", () => {
    const xml = `<li value="3056" id="nt:3056"><i title="{log'-os}">λόγος</i> a word &amp; saying; <span class="kjv_def">speech</span>.</li>`;
    expect(strongsEntry(xml, "G3056")).toEqual({
      id: "G3056",
      lemma: "λόγος",
      transliteration: "{log'-os}",
      definition: "λόγος a word & saying; speech .",
    });
    expect(strongsEntry(xml, "G3057")).toBeNull();
    expect(strongsEntry(xml, "H3056")).toBeNull();
    expect(strongsEntry(xml, "G.*")).toBeNull();
  });
});
