// @vitest-environment happy-dom

import { ConvexProvider, ConvexReactClient } from "convex/react";
import { convexTest } from "convex-test";
import {
  AppRouterContext,
  type AppRouterInstance,
} from "next/dist/shared/lib/app-router-context.shared-runtime";
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { UploadState } from "@/lib/document-upload";
import { rememberedTitle } from "@/lib/title-handoff";
import schema from "../../../../../packages/backend/convex/schema";
import { ImportView } from "./import-slot";

type Latest = NonNullable<ComponentProps<typeof ImportView>["latest"]>;
let ready: Latest;
let failed: Latest;
let otherImportId: Latest["_id"];

let root: Root;
let client: ConvexReactClient;
const navigations: string[] = [];
const dismissals: string[] = [];
const router: AppRouterInstance = {
  back() {},
  forward() {},
  refresh() {},
  push(href) {
    navigations.push(href);
  },
  replace() {},
  prefetch() {},
  bfcacheId: "desk",
};
const view = (
  latest: Latest,
  armed: boolean,
  upload: UploadState | null = null,
  targetImportId: Latest["_id"] | null = latest._id,
  preview?: ComponentProps<typeof ImportView>["preview"],
  problem: string | null = null,
  problemOrigin?: ComponentProps<typeof ImportView>["problemOrigin"],
) =>
  act(() =>
    root.render(
      <ConvexProvider client={client}>
        <AppRouterContext.Provider value={router}>
          <ImportView
            latest={latest}
            armed={armed}
            targetImportId={targetImportId}
            upload={upload}
            preview={preview}
            problem={problem}
            problemOrigin={problemOrigin}
            problemIdentity={preview}
            onFile={() => {}}
            onClearProblem={() => {}}
            onDismiss={(id) => dismissals.push(id)}
          >
            <p>resting</p>
          </ImportView>
        </AppRouterContext.Provider>
      </ConvexProvider>,
    ),
  );

beforeEach(async () => {
  navigations.length = 0;
  dismissals.length = 0;
  const t = convexTest(schema, {
    "./_generated/api.js": () =>
      import("@marginalia/backend/convex/_generated/api"),
  });
  const ids = await t.run(async (ctx) => {
    const articleId = await ctx.db.insert("articles", {
      userId: "reader",
      guid: "book",
      url: "https://example.com/book",
      title: "On Cows",
      extractionStatus: "extracted",
      annotationStatus: "skipped",
      createdAt: 0,
    });
    const storageId = await ctx.storage.store(new Blob(["%PDF-"]));
    const importId = await ctx.db.insert("documentImports", {
      userId: "reader",
      storageId,
      fileName: "book.pdf",
      status: "ready",
      step: "point",
      createdAt: 0,
      updatedAt: 0,
    });
    const otherImportId = await ctx.db.insert("documentImports", {
      userId: "reader",
      storageId,
      fileName: "other.epub",
      format: "epub",
      status: "reading",
      step: "text",
      createdAt: 1,
      updatedAt: 1,
    });
    return { articleId, importId, otherImportId };
  });
  ready = {
    _id: ids.importId,
    fileName: "book.pdf",
    status: "ready",
    step: "point",
    articleId: ids.articleId,
    title: "On Cows",
    author: undefined,
    diagnostic: undefined,
    pages: 12,
    minutes: 9,
    units: undefined,
    firstUnitTitle: undefined,
    firstUnitMinutes: undefined,
    failure: undefined,
  };
  failed = { ...ready, status: "failed", step: "text", failure: "scanned" };
  otherImportId = ids.otherImportId;
  client = new ConvexReactClient("https://fixture.convex.cloud");
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(async () => {
  act(() => root.unmount());
  await client.close();
  document.body.innerHTML = "";
});

describe("an imported PDF that becomes readable", () => {
  it.each([
    ["dismiss", "Couldn't dismiss this import"],
    ["busy", "Another upload is in progress"],
  ] as const)("does not blame the previous book for a %s problem", (origin, heading) => {
    const preview = {
      title: "Previous Book",
      author: "Previous Author",
      fileName: "previous.epub",
      format: "epub" as const,
    };
    view(ready, false, null, ready._id, preview, "Try again.", origin);
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      heading,
    );
    expect(document.body.textContent).not.toContain("Previous Book");
    expect(document.body.textContent).not.toContain("Previous Author");
    expect(document.body.textContent).not.toContain("Couldn't read this");
    view(
      { ...ready, status: "reading", format: "epub", title: undefined },
      false,
      null,
      ready._id,
      preview,
    );
    expect(document.querySelector("h2")?.textContent).toBe("Previous Book");
  });
  it("does not blame the book for an unexpected internal failure", () => {
    const identity = {
      title: `Book ${crypto.randomUUID()}`,
      author: `Author ${crypto.randomUUID()}`,
      fileName: `${crypto.randomUUID()}.epub`,
    };
    view(
      {
        ...failed,
        ...identity,
        format: "epub",
        failure: "unreadable",
        diagnostic: {
          code: "unexpected_failure",
          stage: "publish",
          errorType: "type_error",
        },
      },
      false,
    );
    expect(document.querySelector('[role="alert"] > p')?.textContent).toBe(
      "Couldn't complete this import",
    );
    expect(document.querySelector("h2")).toBeNull();
    for (const value of Object.values(identity)) {
      expect(document.body.textContent).not.toContain(value);
    }
    expect(document.querySelector("[title]")).toBeNull();
    expect(document.body.textContent).not.toContain("Couldn't read this");
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "Marginalia hit an internal error while importing this book.",
    );
    expect(document.body.textContent).toContain("expand Diagnostic details");
    expect(document.body.textContent).not.toContain("damaged");
    expect(document.body.textContent).not.toContain(
      "Nothing was added to your library.",
    );
    expect(document.querySelector("details")?.hasAttribute("open")).toBe(false);
    expect(document.querySelector("details")?.textContent).toContain(
      `Import reference: ${failed._id}`,
    );
  });

  it("keeps long author metadata within the ready card's word-breaking rule", () => {
    const author = "Author".repeat(100);
    view({ ...ready, format: "epub", author }, false);
    const paragraph = [...document.querySelectorAll("p")].find(
      (node) => node.textContent === author,
    );
    expect(paragraph?.classList.contains("break-words")).toBe(true);
  });

  it("keeps this import's preview while the server is still parsing its metadata", () => {
    const row = {
      ...ready,
      format: "epub" as const,
      status: "reading" as const,
      title: undefined,
      author: undefined,
    };
    const preview = {
      title: "The Real Book Title",
      author: "The Author",
      fileName: "noisy.epub",
      format: "epub" as const,
    };
    view(row, true, null, row._id, preview);
    expect(document.querySelector("h2")?.textContent).toBe(
      "The Real Book Title",
    );
    expect(document.body.textContent).toContain("The Author");
    view({ ...row, _id: otherImportId }, true, null, row._id, preview);
    expect(document.querySelector("h2")?.textContent).toBe("Your EPUB");
    expect(document.body.textContent).not.toContain("The Author");
  });
  it("uses the book metadata rather than a noisy filename during upload", () => {
    view(ready, false, {
      fileName: "_Long filename -- identifiers -- archive.epub",
      format: "epub",
      stage: "uploading",
      percent: 25,
      title: "The Real Book Title",
      author: "The Author",
    });
    expect(document.querySelector("h2")?.textContent).toBe(
      "The Real Book Title",
    );
    expect(document.body.textContent).toContain("The Author");
    expect(
      document.querySelector(
        '[title="_Long filename -- identifiers -- archive.epub"]',
      ),
    ).not.toBeNull();
  });

  it("does not promote the raw EPUB filename while metadata is being read", () => {
    view(ready, false, {
      fileName: "_Long filename -- archive.epub",
      format: "epub",
      stage: "metadata",
      percent: 0,
    });
    expect(document.querySelector("h2")?.textContent).toBe("Your EPUB");
    expect(document.body.textContent).toContain("Reading book details…");
  });

  it("retains the verified title and author in a refusal and explains its actual limit", () => {
    view(
      {
        ...failed,
        format: "epub",
        title: "The Real Book Title",
        author: "The Author",
        fileName: "verified-book.epub",
        failure: "too_long",
        diagnostic: {
          code: "block_words",
          stage: "units",
          observed: 14208,
          limit: 4000,
          spineIndex: 76,
          blockIndex: 1,
        },
      },
      false,
    );
    expect(document.querySelector("h2")?.textContent).toBe(
      "The Real Book Title",
    );
    expect(document.body.textContent).toContain("The Author");
    expect(document.querySelector('[role="alert"] > p')?.textContent).toBe(
      "Couldn't read this EPUB",
    );
    expect(
      document.querySelector('[title="verified-book.epub"]')?.textContent,
    ).toBe("verified-book.epub");
    expect(document.body.textContent).toContain(
      "A single text block has 14,208 words; the supported limit is 4,000.",
    );
    expect(document.body.textContent).toContain("14,208 words");
    expect(document.body.textContent).toContain("4,000");
    expect(document.body.textContent).toContain(
      `Import reference: ${failed._id}`,
    );
    expect(document.body.textContent).toContain(
      "Stage: units · Code: block_words",
    );
    expect(document.body.textContent).not.toContain("larger or more complex");
  });
  it("does not open an unrelated import that completes while this upload is armed", () => {
    view(ready, true, null, otherImportId);
    expect(navigations).toEqual([]);
    expect(dismissals).toEqual([]);
    view(
      { ...ready, _id: otherImportId, format: "epub" },
      true,
      null,
      otherImportId,
    );
    expect(navigations).toEqual([`/read/${ready.articleId}`]);
    expect(dismissals).toEqual([otherImportId]);
  });

  it("does not auto-open while the upload result has not identified its import", () => {
    view(ready, true, null, null);
    expect(navigations).toEqual([]);
    expect(dismissals).toEqual([]);
    view(ready, true, null, ready._id);
    expect(navigations).toEqual([`/read/${ready.articleId}`]);
  });

  it("does not steal navigation after the reader disarms an in-progress import", () => {
    view(
      { ...ready, status: "reading", step: "sections", format: "epub" },
      true,
    );
    view({ ...ready, format: "epub" }, false);
    expect(navigations).toEqual([]);
    expect(dismissals).toEqual([]);
    expect(document.body.textContent).toContain("Ready to read");
  });
  it.each([
    "checking",
    "uploading",
  ] as const)("shows the EPUB %s state before the server takes over", (stage) => {
    view(ready, false, {
      fileName: "book.epub",
      format: "epub",
      stage,
      percent: 25,
    });
    expect(document.body.textContent).toContain("Reading in your EPUB");
    expect(document.body.textContent).toContain(
      stage === "checking" ? "Checking the file…" : "Uploading 25%",
    );
    expect(document.body.textContent).not.toContain("Ready to read");
  });
  it("opens the reader straight away when the reader is still waiting on the desk", () => {
    view(ready, true);
    expect(navigations).toEqual([`/read/${ready.articleId}`]);
    expect(rememberedTitle(String(ready.articleId))).toBe("On Cows");
    expect(dismissals).toEqual([ready._id]);
  });

  it("opens only once however often the desk re-renders", () => {
    view(ready, true);
    view({ ...ready }, true);
    expect(navigations).toEqual([`/read/${ready.articleId}`]);
  });

  it("stays at the Ready card when the reader has moved on", () => {
    view(ready, false);
    expect(navigations).toEqual([]);
    expect(document.body.textContent).toContain("Ready to read");
    expect(document.body.textContent).toContain("Start reading");
  });

  it("leaves a scanned refusal in place and opens nothing", () => {
    view(failed, true);
    expect(navigations).toEqual([]);
    expect(document.body.textContent).toContain(
      "This PDF is scanned pages, with no text to read.",
    );
  });

  it.each([
    ["protected", "This file is protected and can't be read."],
    ["not_epub", "This file isn't a valid EPUB."],
  ] satisfies ReadonlyArray<
    readonly [NonNullable<Latest["failure"]>, string]
  >)("renders the %s refusal safely for a legacy row", (failure, sentence) => {
    view({ ...failed, failure }, true);
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      sentence,
    );
    expect(document.body.textContent).toContain(
      "Nothing was added to your library.",
    );
    expect(navigations).toEqual([]);
  });

  it("keeps the unreadable fallback when no failure is present", () => {
    view({ ...failed, failure: undefined }, false);
    expect(document.body.textContent).toContain(
      "Marginalia couldn't open this PDF.",
    );
  });

  it("still shows explicitly tagged PDFs", () => {
    view({ ...ready, format: "pdf" }, false);
    expect(document.body.textContent).toContain("Ready to read");
    expect(document.body.textContent).toContain("On Cows");
  });

  it("opens a ready EPUB when auto-open is armed", () => {
    view(
      {
        ...ready,
        format: "epub",
        fileName: "book.epub",
        pages: undefined,
        units: 45,
      },
      true,
    );
    expect(navigations).toEqual([`/read/${ready.articleId}`]);
    expect(dismissals).toEqual([ready._id]);
  });

  it("shows EPUB chapter progress without page claims", () => {
    view(
      {
        ...ready,
        format: "epub",
        fileName: "book.epub",
        status: "reading",
        step: "sections",
        pages: undefined,
      },
      false,
    );
    expect(document.body.textContent).toContain("Reading in your EPUB");
    expect(document.body.textContent).toContain("Text from its chapters");
    expect(document.body.textContent).not.toContain("pages");
    expect(
      document
        .querySelector('[role="progressbar"]')
        ?.getAttribute("aria-label"),
    ).toBe("Reading in your EPUB");
  });

  it("leaves EPUBs ready when the reader has moved on and shows parts, not pages", () => {
    view(
      {
        ...ready,
        format: "epub",
        fileName: "book.epub",
        pages: undefined,
        units: 45,
        firstUnitTitle: "Introduction",
        firstUnitMinutes: 2,
      },
      false,
    );
    expect(navigations).toEqual([]);
    expect(document.body.textContent).toContain("45 reading sections");
    expect(document.body.textContent).toContain(
      "Starts with “Introduction”, 2 min.",
    );
    expect(document.body.textContent).not.toContain("pages");
  });

  it.each([
    "protected",
    "not_epub",
    "empty",
    "unreadable",
    "too_long",
    "too_slow",
  ] as const)("shows the EPUB %s refusal without opening the reader", (failure) => {
    const identity = {
      title: `Book ${crypto.randomUUID()}`,
      author: `Author ${crypto.randomUUID()}`,
      fileName: `${crypto.randomUUID()}.epub`,
    };
    view({ ...failed, ...identity, format: "epub", failure }, true);
    expect(document.querySelector('[role="alert"] > p')?.textContent).toBe(
      "Couldn't read this EPUB",
    );
    expect(document.querySelector("h2")?.textContent).toBe(identity.title);
    expect(document.querySelector("[title]")?.textContent).toBe(
      identity.fileName,
    );
    expect(
      [...document.querySelectorAll("p")].some(
        (node) => node.textContent === identity.author,
      ),
    ).toBe(true);
    expect(document.body.textContent).toContain(
      "Nothing was added to your library.",
    );
    expect(document.body.textContent).not.toContain("PDF");
    expect(navigations).toEqual([]);
  });
});
