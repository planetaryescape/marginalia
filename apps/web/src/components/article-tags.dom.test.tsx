// @vitest-environment happy-dom
import type { Id } from "@marginalia/backend/convex/_generated/dataModel";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ArticleTags } from "./article-tags";

const tags = vi.hoisted(() => ({ value: undefined as unknown }));
vi.mock("convex/react", () => ({ useQuery: () => tags.value }));
vi.mock("@marginalia/backend/convex/_generated/api", () => ({
  api: { tags: { forArticle: "forArticle" } },
}));

let root: Root;
const render = () =>
  act(async () =>
    root.render(<ArticleTags articleId={"art1" as Id<"articles">} />),
  );

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById("root") as HTMLElement);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

describe("ArticleTags", () => {
  it("shows the article's tags as small pencil chips, not links", async () => {
    tags.value = [
      { _id: "t1", name: "remote work" },
      { _id: "t2", name: "productivity" },
    ];
    await render();
    const items = [...document.querySelectorAll("li")];
    expect(items.map((li) => li.textContent)).toEqual([
      "remote work",
      "productivity",
    ]);
    expect(items[0].className).toContain("text-[var(--pencil)]");
    expect(document.querySelector("a, button")).toBeNull();
    expect(document.querySelector("ul")?.getAttribute("aria-label")).toBe(
      "Topics",
    );
  });

  it("shows nothing while loading, or when the article has no tags", async () => {
    tags.value = undefined;
    await render();
    expect(document.querySelector("ul")).toBeNull();
    tags.value = [];
    await render();
    expect(document.querySelector("ul")).toBeNull();
  });
});
