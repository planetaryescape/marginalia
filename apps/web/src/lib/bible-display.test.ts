// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import {
  bibleDisplayAnchors,
  bibleVerseAtRange,
  mapBibleAnnotations,
} from "./bible-display";

describe("cross-version verse identity", () => {
  it("maps a public-domain study annotation to the displayed verse without claiming identical wording", () => {
    const study = "3:16 Public study wording\n\n3:17 Another public sentence";
    const html =
      '<p><span data-usfm="JHN.3.16">16 Different displayed wording</span><span data-usfm="JHN.3.17">17 Different next verse</span></p>';
    const mapped = mapBibleAnnotations(
      [{ anchorText: "Public study wording", anchorStartOffset: 5 }],
      study,
      bibleDisplayAnchors("John 3:16-17", study, html),
    );
    expect(mapped[0].anchorText).toBe("16 Different displayed wording");
    expect(mapped[0].anchorStartOffset).toBe(0);
    expect(mapped[0].anchorEndOffset).toBe(
      "16 Different displayed wording".length,
    );
    expect(
      mapBibleAnnotations(
        [{ anchorText: "Not present" }],
        study,
        bibleDisplayAnchors("John 3:16-17", study, html),
      ),
    ).toEqual([]);
  });
  it("gets the selected verse from real verse markup, not an English-to-Greek guess", () => {
    document.body.innerHTML =
      '<p><span data-usfm="JHN.3.17">selected words</span></p>';
    const range = document.createRange();
    range.selectNodeContents(document.querySelector("span")!);
    expect(bibleVerseAtRange("John 3", range)).toBe("John 3:17");
    expect(bibleVerseAtRange("Romans 8", range)).toBeNull();
  });
});
