// @vitest-environment happy-dom
import type { Doc } from "@marginalia/backend/convex/_generated/dataModel";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ImpressionSummary } from "./impression-panel";

let root: Root;
beforeEach(() => {
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
});

const impression = (rating: number) =>
  ({ rating, tags: [], note: undefined }) as unknown as Doc<"impressions">;

describe("ImpressionSummary", () => {
  it("draws five stars, filled up to the rating, in ink and not pen", () => {
    act(() => root.render(<ImpressionSummary impression={impression(3)} />));
    const stars = document.querySelectorAll(
      '[data-testid="summary-stars"] svg',
    );
    expect(stars).toHaveLength(5);
    expect(
      [...stars].map((s) => s.getAttribute("fill")),
    ).toEqual(["currentColor", "currentColor", "currentColor", "none", "none"]);
    expect(document.body.innerHTML).not.toContain("--pen");
    expect(document.body.innerHTML).not.toContain("rounded-[2px]");
    expect(document.body.textContent).toContain("You rated this Fine");
  });
});
