// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { resolveStudySelection } from "./bible-study-selection";

const SOURCE =
  "23:3 Source three.\n\n23:4 Source four.\n\n23:5 Source five.\n\n23:6 Source six.";

function fixture(html: string) {
  document.body.innerHTML = `<article><div class="article-content">${html}</div></article>`;
  return document.querySelector<HTMLElement>(".article-content")!;
}

function selected(start: string, end = start, endOffset?: number) {
  const range = document.createRange();
  const from = document.querySelector(start)!.firstChild!;
  const to = document.querySelector(end)!.firstChild!;
  range.setStart(from, 0);
  range.setEnd(to, endOffset ?? to.textContent!.length);
  return range;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("Scripture Study scope from the actual selected endpoints", () => {
  it("resolves empty numeric verse markers across continued blocks and excludes footnote bodies", () => {
    const body = fixture(
      '<div class="q1"><span class="yv-v" v="4"></span><span class="yv-vlbl">4</span><span id="first">Displayed beginning</span><span class="yv-n">Footnote, not evidence</span></div><div class="q2"><span id="continued">continued text</span></div><div class="q1"><span class="yv-v" v="5"></span><span id="middle">Next displayed verse</span></div><div class="q1"><span class="yv-v" v="6"></span><span id="last">Displayed ending</span></div>',
    );
    expect(
      resolveStudySelection(
        "Psalms 23",
        SOURCE,
        body,
        selected("#first", "#last"),
      ),
    ).toEqual({
      referenceKey: "PSA.23.4-PSA.23.6",
      startVerseId: "PSA.23.4",
      endVerseId: "PSA.23.6",
      versificationId: "web",
    });
    expect(
      resolveStudySelection("Psalms 23", SOURCE, body, selected("#continued"))
        ?.referenceKey,
    ).toBe("PSA.23.4");
  });

  it("does not include the next verse when selection ends at its first character", () => {
    const body = fixture(
      '<p id="PSA.23.4"><span id="first">Four</span></p><p id="PSA.23.5"><span id="last">Five</span></p>',
    );
    expect(
      resolveStudySelection(
        "Psalms 23",
        SOURCE,
        body,
        selected("#first", "#last", 0),
      )?.referenceKey,
    ).toBe("PSA.23.4");
  });

  it("uses real WEB paragraph identities without requiring a licensed display", () => {
    const body = fixture(
      '<p id="PSA.23.3"><sup>23:3</sup> <span id="first">Source three.</span></p><p id="PSA.23.4"><sup>23:4</sup> <span id="last">Source four.</span></p>',
    );
    expect(
      resolveStudySelection(
        "Psalms 23",
        SOURCE,
        body,
        selected("#first", "#last"),
      )?.referenceKey,
    ).toBe("PSA.23.3-PSA.23.4");
  });

  it("handles data-usfm verse wrappers and whitespace outside their text", () => {
    const body = fixture(
      '<span data-usfm="PSA.23.4"><span id="first">Four</span></span>\n<span data-usfm="PSA.23.5"><span id="last">Five</span></span>',
    );
    expect(
      resolveStudySelection(
        "Psalms 23",
        SOURCE,
        body,
        selected("#first", "#last"),
      )?.referenceKey,
    ).toBe("PSA.23.4-PSA.23.5");
  });

  it("uses element-offset boundaries without including a following verse", () => {
    const body = fixture('<p id="PSA.23.4">Four</p><p id="PSA.23.5">Five</p>');
    const range = document.createRange();
    range.setStart(body, 0);
    range.setEnd(body, 1);
    expect(
      resolveStudySelection("Psalms 23", SOURCE, body, range)?.referenceKey,
    ).toBe("PSA.23.4");
  });

  it("rejects a scope with a missing middle verse and a selection crossing a provider heading", () => {
    let body = fixture(
      '<span class="yv-v" v="4"></span><span id="first">Four</span><span class="yv-v" v="6"></span><span id="last">Six</span>',
    );
    expect(
      resolveStudySelection(
        "Psalms 23",
        SOURCE,
        body,
        selected("#first", "#last"),
      ),
    ).toBeNull();
    body = fixture(
      '<span class="yv-v" v="4"></span><span id="first">Four</span><div class="s1">Heading</div><span class="yv-v" v="5"></span><span id="last">Five</span>',
    );
    expect(
      resolveStudySelection(
        "Psalms 23",
        SOURCE,
        body,
        selected("#first", "#last"),
      ),
    ).toBeNull();
  });

  it("skips inserted answer UI without assigning that wording to a verse", () => {
    const body = fixture(
      '<span class="yv-v" v="4"></span><span id="first">Four</span><div data-marginalia-ui><p>An answer that is not Scripture</p><span class="yv-v" v="50"></span></div><span class="yv-v" v="5"></span><span id="last">Five</span>',
    );
    expect(
      resolveStudySelection(
        "Psalms 23",
        SOURCE,
        body,
        selected("#first", "#last"),
      )?.referenceKey,
    ).toBe("PSA.23.4-PSA.23.5");
  });

  it.each([
    '<h2 id="target">A heading</h2>',
    '<p id="PSA.23.4"><span class="yv-n" id="target">Footnote body</span></p>',
    '<p id="PSA.23.4"><span data-verse-footnote="true" id="target">Footnote</span></p>',
    '<p id="PSA.23.4"><span class="yv-vlbl" id="target">4</span></p>',
    '<div data-marginalia-ui><p id="target">Answer UI</p></div>',
    '<p id="PSA.23.9"><span id="target">Absent source verse</span></p>',
    '<p id="GEN.23.4"><span id="target">Wrong book</span></p>',
    '<span data-usfm="PSA.23.4 PSA.23.5" id="target">Ambiguous combined identity</span>',
    '<div><span class="yv-v" v="4e0"></span><span id="target">Malformed marker</span></div>',
    '<p id="target">Unidentified text</p>',
  ])("rejects unsupported or non-passage scope: %s", (html) => {
    const body = fixture(html);
    expect(
      resolveStudySelection("Psalms 23", SOURCE, body, selected("#target")),
    ).toBeNull();
  });

  it("rejects a cross-chapter selection, collapsed range, and endpoints outside the primary body", () => {
    const body = fixture(
      '<p id="PSA.23.6"><span id="first">Six</span></p><p id="PSA.24.1"><span id="last">One</span></p>',
    );
    expect(
      resolveStudySelection(
        "Psalms 23-24",
        `${SOURCE}\n\n24:1 Source one.`,
        body,
        selected("#first", "#last"),
      ),
    ).toBeNull();
    const collapsed = selected("#first");
    collapsed.collapse(true);
    expect(
      resolveStudySelection("Psalms 23", SOURCE, body, collapsed),
    ).toBeNull();
    const outside = document.createElement("p");
    outside.textContent = "Other column";
    document.body.append(outside);
    const range = document.createRange();
    range.selectNodeContents(outside);
    expect(resolveStudySelection("Psalms 23", SOURCE, body, range)).toBeNull();
  });
});
