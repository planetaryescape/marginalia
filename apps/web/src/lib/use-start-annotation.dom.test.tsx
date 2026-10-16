// @vitest-environment happy-dom
import type { Id } from "@marginalia/backend/convex/_generated/dataModel";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { marginNotesPending, useStartAnnotation } from "./use-start-annotation";

const start = vi.hoisted(() => vi.fn());
vi.mock("convex/react", () => ({ useMutation: () => start }));

// SAFETY: a fixture id; the mocked mutation never reads it
const id = "article-1" as Id<"articles">;
function Probe({ status }: { status: string | undefined }) {
  useStartAnnotation(id, status);
  return null;
}

let root: Root;
beforeEach(() => {
  start.mockReset().mockResolvedValue(1);
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
});

describe("opening an article whose marginalia were deferred", () => {
  it("starts them once", async () => {
    await act(async () => root.render(<Probe status="deferred" />));
    await act(async () => root.render(<Probe status="deferred" />));
    expect(start).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledWith({ articleIds: [id] });
  });

  it("leaves every other status alone", async () => {
    for (const status of [undefined, "pending", "annotated", "failed"]) {
      await act(async () => root.render(<Probe status={status} />));
    }
    expect(start).not.toHaveBeenCalled();
  });

  it("keeps the article readable when starting fails", async () => {
    start.mockRejectedValue(new Error("no such function"));
    await act(async () => root.render(<Probe status="deferred" />));
    expect(start).toHaveBeenCalledTimes(1);
  });
});

describe("the reader's waiting state", () => {
  it("shows while annotation is pending on extracted text", () => {
    expect(
      marginNotesPending({
        annotationStatus: "pending",
        extractionStatus: "extracted",
      }),
    ).toBe(true);
  });

  it("does not show for a deferred, annotated or still-extracting article", () => {
    for (const article of [
      { annotationStatus: "deferred", extractionStatus: "extracted" },
      { annotationStatus: "annotated", extractionStatus: "extracted" },
      { annotationStatus: "pending", extractionStatus: "pending" },
    ])
      expect(marginNotesPending(article)).toBe(false);
  });
});
