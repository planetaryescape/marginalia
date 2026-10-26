// @vitest-environment happy-dom

import { ArticleRenderer } from "@planetaryescape/reader";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import {
  bibleDisplayAnchors,
  bibleVerseAtRange,
  mapBibleAnnotations,
} from "./bible-display";

describe("cross-version verse identity", () => {
  it("maps and renders real-shaped empty verse markers across continued display blocks", async () => {
    const study =
      "23:1 A source observation\n\n23:2 Another source observation";
    const html = `<div class="q1"><span class="yv-v" v="1"></span><span class="yv-vlbl">1</span><span class="nd">Displayed opening</span></div><div class="q2">continues here<span class="yv-n">a</span></div><div class="q1"><span class="yv-v" v="2"></span><span class="yv-vlbl">2</span>Last verse text</div>`;
    const anchors = bibleDisplayAnchors("Psalms 23:1-2", study, html);

    expect(anchors.map(({ verseId }) => verseId)).toEqual([
      "PSA.23.1",
      "PSA.23.2",
    ]);
    const mapped = mapBibleAnnotations(
      [
        {
          anchorText: "A source observation",
          anchorStartOffset: study.indexOf("A source"),
        },
        {
          anchorText: "Another source observation",
          anchorStartOffset: study.indexOf("Another"),
        },
      ],
      study,
      anchors,
    );
    expect(mapped.map(({ anchorText }) => anchorText)).toEqual([
      "1Displayed openingcontinues herea",
      "2Last verse text",
    ]);
    const body = new DOMParser().parseFromString(html, "text/html").body;
    for (const annotation of mapped) {
      expect(
        body.textContent?.slice(
          annotation.anchorStartOffset,
          annotation.anchorEndOffset,
        ),
      ).toBe(annotation.anchorText);
    }
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    document.body.innerHTML = '<div id="reader"></div>';
    const root = createRoot(document.querySelector("#reader")!);
    await act(async () =>
      root.render(
        createElement(ArticleRenderer, {
          content: body.textContent ?? "",
          contentHtml: html,
          sanitize: (value: string) => value,
          annotations: mapped.map((annotation, index) => ({
            ...annotation,
            _id: `note-${index}`,
            type: "context" as const,
            content: "A source-grounded note",
            relevanceScore: 0.8,
          })),
          activeAnnotationId: null,
          onAnnotationSelect: () => {},
        }),
      ),
    );
    expect(
      new Set(
        Array.from(
          document.querySelectorAll<HTMLElement>(".annotation-mark"),
        ).map((mark) => mark.dataset.annotationId),
      ),
    ).toEqual(new Set(["note-0", "note-1"]));
    expect(
      Array.from(
        document.querySelectorAll<HTMLElement>("[data-annotation-id='note-0']"),
      )
        .map((mark) => mark.textContent)
        .join(""),
    ).toContain("Displayed opening");
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  });

  it("uses verse-only markers and skips absent or malformed marker identities", () => {
    const study = "23:6 Source quote";
    const html =
      '<div><span class="yv-v" v="6"></span><span class="yv-vlbl">6</span>The last verse</div>';
    expect(
      bibleDisplayAnchors("Psalms 23:6", study, html).map(
        ({ verseId }) => verseId,
      ),
    ).toEqual(["PSA.23.6"]);
    expect(
      bibleDisplayAnchors(
        "Psalms 23:6",
        study,
        '<span class="yv-v" v="nope"></span>',
      ),
    ).toEqual([]);
    expect(
      bibleDisplayAnchors(
        "Psalms 23:6",
        study,
        '<span class="yv-v" v="6e0"></span>',
      ),
    ).toEqual([]);
    expect(
      bibleDisplayAnchors("Psalms 23:6", study, "<div>The last verse</div>"),
    ).toEqual([]);
  });

  it("tracks a verse-number reset into the next chapter by marker order", () => {
    const study = "23:36 Synthetic ending\n\n24:1 Synthetic beginning";
    const html =
      '<div><span class="yv-v" v="36"></span>Displayed ending</div><div><span class="yv-v" v="1"></span>Displayed beginning</div>';
    expect(
      bibleDisplayAnchors("Psalms 23-24", study, html).map(
        ({ verseId }) => verseId,
      ),
    ).toEqual(["PSA.23.36", "PSA.24.1"]);
  });

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
    expect(
      mapBibleAnnotations(
        [{ anchorText: "Public study wording", anchorStartOffset: Number.NaN }],
        study,
        bibleDisplayAnchors("John 3:16-17", study, html),
      ),
    ).toEqual([]);
    for (const annotation of mapped)
      expect(
        new DOMParser()
          .parseFromString(html, "text/html")
          .body.textContent?.slice(
            annotation.anchorStartOffset,
            annotation.anchorEndOffset,
          ),
      ).toBe(annotation.anchorText);
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
