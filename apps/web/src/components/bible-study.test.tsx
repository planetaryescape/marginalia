// @vitest-environment happy-dom
import { getFunctionName } from "convex/server";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BibleStudy } from "./bible-study";

const state = vi.hoisted(() => ({ enabled: true, params: "" }));
const catalogue = vi.hoisted(() => vi.fn());
const openReading = vi.hoisted(() => vi.fn());
const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(state.params),
  useRouter: () => ({ push }),
}));
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: ReactNode;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock("convex/react", () => ({
  useQuery: () => ({ enabled: state.enabled, translation: "niv" }),
  useAction: (ref: Parameters<typeof getFunctionName>[0]) =>
    getFunctionName(ref) === "actions/bible:catalogue"
      ? catalogue
      : openReading,
}));
let root: Root;
const render = () => act(async () => root.render(<BibleStudy />));
function button(text: string) {
  return Array.from(document.querySelectorAll("button")).find(
    (b) => b.textContent === text,
  );
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById("root")!);
  Object.assign(state, { enabled: true, params: "" });
  push.mockReset();
  catalogue.mockReset().mockResolvedValue([
    { id: 111, title: "New International Version", language: "en" },
    { id: 2692, title: "New American Standard Bible 2020", language: "en" },
    ...Array.from({ length: 100 }, (_, i) => ({
      id: i + 3000,
      title: `Authorized edition ${i}`,
      language: "es",
    })),
  ]);
  openReading.mockReset().mockResolvedValue("study-article");
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});
describe("authorized Bible catalogue", () => {
  it("makes no requests before opt-in", async () => {
    state.enabled = false;
    await render();
    expect(document.body.textContent).toContain("Bible reading is off");
    expect(catalogue).not.toHaveBeenCalled();
    expect(openReading).not.toHaveBeenCalled();
  });
  it("defaults to one preferred version and opens the normal reader, not a comparison page", async () => {
    await render();
    expect(document.querySelectorAll("select")).toHaveLength(2); // version + language
    expect(document.querySelector<HTMLSelectElement>("select")?.value).toBe(
      "111",
    );
    expect(button("Compare verses")).toBeUndefined();
    await act(async () => button("Read passage")?.click());
    expect(openReading).toHaveBeenCalledWith({
      reference: "John 3:16-21",
      versionId: 111,
    });
    expect(push).toHaveBeenCalledWith("/read/study-article");
  });
  it("searches all metadata, including rows beyond the visible page, and reads the actual chosen edition", async () => {
    await render();
    const search = document.querySelector<HTMLInputElement>(
      'input[type="search"]',
    )!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(search, "Authorized edition 99");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(document.body.textContent).toContain("1 matching versions");
    await act(async () =>
      document
        .querySelector<HTMLButtonElement>(
          'button[aria-label="Read Authorized edition 99"]',
        )
        ?.click(),
    );
    expect(openReading).toHaveBeenCalledWith({
      reference: "John 3:16-21",
      versionId: 3099,
    });
  });
  it("does not re-enable comparison from an older two-version URL", async () => {
    state.params = "reference=Romans+8&left=2692&right=111";
    await render();
    expect(document.querySelector<HTMLSelectElement>("select")?.value).toBe(
      "2692",
    );
    expect(button("Compare verses")).toBeUndefined();
    await act(async () => button("Read passage")?.click());
    expect(openReading).toHaveBeenCalledWith({
      reference: "Romans 8",
      versionId: 2692,
    });
  });
  it("keeps the catalogue usable after an open failure and retries in place", async () => {
    openReading.mockRejectedValueOnce(new Error("Not authorized"));
    await render();
    await act(async () => button("Read passage")?.click());
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "Not authorized",
    );
    expect(document.body.textContent).toContain("All authorized editions");
    await act(async () => button("Retry passage")?.click());
    expect(push).toHaveBeenCalledWith("/read/study-article");
  });
});
