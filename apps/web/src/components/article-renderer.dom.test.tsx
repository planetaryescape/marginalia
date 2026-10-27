// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import * as sanitizer from "@/lib/sanitize";
import { ArticleRenderer } from "./article-renderer";

const mocks = vi.hoisted(() => ({ viewed: vi.fn() }));
vi.mock("convex/react", () => ({ useMutation: () => mocks.viewed }));
vi.mock("@marginalia/backend/convex/_generated/api", () => ({
  api: { annotations: { markViewed: "markViewed" } },
}));
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("allows provider verse identity through the article sanitization policy", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  // This checks the production policy passed to DOMPurify. Browser verification
  // separately checks real sanitization; happy-dom does not support DOMPurify.
  const sanitize = vi
    .spyOn(sanitizer, "sanitizeHtml")
    .mockImplementation((html) => html);
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(
        <ArticleRenderer
          content="23:4 A public-domain verse."
          contentHtml='<div class="q1"><span class="yv-v" v="4"></span>A public-domain verse.</div>'
          annotations={[]}
          activeAnnotationId={null}
          onAnnotationSelect={() => {}}
        />,
      ),
    );
    expect(sanitize).toHaveBeenCalledWith(
      expect.stringContaining('v="4"'),
      expect.objectContaining({ ADD_ATTR: expect.arrayContaining(["v"]) }),
    );
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it("does not prepare or replace article prose for viewed/bookkeeping-only row changes", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const sanitize = vi
    .spyOn(sanitizer, "sanitizeHtml")
    .mockImplementation((html) => html);
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  const annotation = {
    _id: "annotation1",
    type: "question",
    anchorText: "anchor",
    anchorStartOffset: 0,
    anchorEndOffset: 6,
    relevanceScore: 0.8,
    content: "Question?",
    wasViewed: false,
  };
  const select = vi.fn();
  const render = (row = annotation, onSelect = select) =>
    act(async () =>
      root.render(
        <ArticleRenderer
          content="anchor prose"
          contentHtml="<p>anchor prose</p>"
          annotations={[row]}
          activeAnnotationId={null}
          onAnnotationSelect={onSelect}
        />,
      ),
    );
  try {
    await render();
    const paragraph = host.querySelector("p");
    const range = document.createRange();
    if (!paragraph) throw new Error("Missing fixture paragraph");
    range.selectNodeContents(paragraph);
    window.getSelection()?.addRange(range);
    const before = sanitize.mock.calls.length;
    await render({ ...annotation, wasViewed: true });
    expect(sanitize).toHaveBeenCalledTimes(before);
    expect(host.querySelector("p")).toBe(paragraph);
    expect(window.getSelection()?.toString()).toContain("anchor");
    const nextSelect = vi.fn();
    await render({ ...annotation, wasViewed: true }, nextSelect);
    await act(async () => host.querySelector("mark")?.click());
    expect(nextSelect).toHaveBeenCalledWith("annotation1");
    expect(select).not.toHaveBeenCalled();
  } finally {
    window.getSelection()?.removeAllRanges();
    await act(async () => root.unmount());
    host.remove();
  }
});
