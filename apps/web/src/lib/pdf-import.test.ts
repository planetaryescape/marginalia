import { describe, expect, it, vi } from "vitest";
import {
  FAILURE_COPY,
  firstPdf,
  importSteps,
  isPdfFile,
  MAX_PDF_MB,
  problemWithFile,
  uploadWithProgress,
} from "./pdf-import";

const file = (name: string, type: string, size = 10) => {
  const f = new File(["x"], name, { type });
  Object.defineProperty(f, "size", { value: size });
  return f;
};

describe("isPdfFile", () => {
  it("accepts the PDF type or a .pdf name", () => {
    expect(isPdfFile(file("a.bin", "application/pdf"))).toBe(true);
    expect(isPdfFile(file("Book.PDF", ""))).toBe(true);
    expect(isPdfFile(file("a.png", "image/png"))).toBe(false);
  });
});

describe("firstPdf", () => {
  it("skips files that are not PDFs", () => {
    const pdf = file("b.pdf", "application/pdf");
    expect(firstPdf([file("a.png", "image/png"), pdf])).toBe(pdf);
    expect(firstPdf([file("a.png", "image/png")])).toBeNull();
  });
});

describe("problemWithFile", () => {
  it("names what is wrong in a plain sentence", () => {
    expect(problemWithFile(file("a.png", "image/png"))).toBe(
      "Marginalia reads PDF files.",
    );
    expect(
      problemWithFile(
        file("a.pdf", "application/pdf", MAX_PDF_MB * 1024 * 1024 + 1),
      ),
    ).toContain("over 60 MB");
    expect(problemWithFile(file("a.pdf", "application/pdf", 0))).toBe(
      "That file is empty.",
    );
    expect(problemWithFile(file("a.pdf", "application/pdf", 1000))).toBeNull();
  });
});

describe("importSteps", () => {
  it("checks off a step as the import moves on", () => {
    expect(importSteps({ step: "text" })).toEqual({
      done: [],
      current: "Reading the text…",
    });
    expect(importSteps({ step: "sections", pages: 412 })).toEqual({
      done: ["Text from all 412 pages"],
      current: "Finding its sections…",
    });
    expect(importSteps({ step: "point", pages: 412, units: 58 })).toEqual({
      done: ["Text from all 412 pages", "58 reading parts from its chapters"],
      current: "Opening it for reading…",
    });
  });
  it("does not claim parts for a document that is one article", () => {
    expect(importSteps({ step: "point", pages: 6 }).done[1]).toBe(
      "Headings and paragraphs",
    );
  });
});

describe("FAILURE_COPY", () => {
  it("says the scan sentence from the comp and that nothing was added", () => {
    expect(FAILURE_COPY.scanned.sentence).toBe(
      "This PDF is scanned pages, with no text to read.",
    );
    for (const copy of Object.values(FAILURE_COPY))
      expect(copy.detail).toContain("Nothing was added to your library.");
  });
});

describe("uploadWithProgress", () => {
  class FakeRequest {
    static last: FakeRequest;
    upload: { onprogress?: (event: ProgressEvent) => void } = {};
    onerror?: () => void;
    onload?: () => void;
    onabort?: () => void;
    ontimeout?: () => void;
    constructor() {
      FakeRequest.last = this;
    }
    open() {}
    setRequestHeader() {}
    send() {}
  }

  it("settles when the request is cancelled or times out, so the import isn't left busy", async () => {
    vi.stubGlobal("XMLHttpRequest", FakeRequest);
    const file = new File(["%PDF-"], "a.pdf", { type: "application/pdf" });
    for (const end of ["onabort", "ontimeout"] as const) {
      const upload = uploadWithProgress("https://upload", file, () => {});
      FakeRequest.last[end]?.();
      await expect(upload).rejects.toThrow("The upload didn't finish.");
    }
    vi.unstubAllGlobals();
  });
});
