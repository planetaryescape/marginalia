// @vitest-environment happy-dom
import { getFunctionName } from "convex/server";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BibleStudy } from "./bible-study";

const state = vi.hoisted(() => ({
  enabled: true,
  active: "",
  connected: true,
}));
const catalogue = vi.hoisted(() => vi.fn());
const compare = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
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
  useConvexConnectionState: () => ({ isWebSocketConnected: state.connected }),
  useQuery: (ref: Parameters<typeof getFunctionName>[0]) =>
    getFunctionName(ref) === "bible:preferences"
      ? { enabled: state.enabled, translation: "niv" }
      : state.active,
  useAction: (ref: Parameters<typeof getFunctionName>[0]) =>
    getFunctionName(ref) === "actions/bible:catalogue" ? catalogue : compare,
}));
let root: Root;
const render = () => act(async () => root.render(<BibleStudy />));
function button(text: string) {
  return Array.from(document.querySelectorAll("button")).find(
    (b) => b.textContent === text,
  );
}
function reading() {
  return {
    reference: "John 3:16-21",
    token: "view-one",
    fontCss: "/* font CSS */",
    panes: [111, 2692].map((id) => ({
      id,
      title:
        id === 111
          ? "New International Version"
          : "New American Standard Bible 2020",
      abbreviation: id === 111 ? "NIV11" : "NASB2020",
      language: "en",
      html: `<p>Source text for edition ${id}</p><span>Original footnote</span>`,
      copyright: `Notice for ${id}`,
      publisher: "Publisher",
      publisherUrl: "https://example.com",
    })),
  };
}
beforeEach(() => {
  // Keep the DOM test offline; stylesheet rendering is checked in browser QA.
  if (
    "happyDOM" in window &&
    typeof window.happyDOM === "object" &&
    window.happyDOM !== null &&
    "settings" in window.happyDOM &&
    typeof window.happyDOM.settings === "object" &&
    window.happyDOM.settings !== null
  )
    Object.assign(window.happyDOM.settings, {
      disableCSSFileLoading: true,
      handleDisabledFileLoadingAsSuccess: true,
    });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById("root")!);
  Object.assign(state, { enabled: true, active: "", connected: true });
  catalogue.mockReset().mockResolvedValue([
    { id: 111, title: "New International Version", language: "en" },
    { id: 2692, title: "New American Standard Bible 2020", language: "en" },
    ...Array.from({ length: 100 }, (_, i) => ({
      id: i + 3000,
      title: `Authorized edition ${i}`,
      language: "es",
    })),
  ]);
  compare.mockReset().mockImplementation(async () => {
    state.active = "view-one";
    return reading();
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

describe("Bible catalogue and comparison", () => {
  it("makes no requests while opted out", async () => {
    state.enabled = false;
    await render();
    expect(document.body.textContent).toContain("Bible reading is off");
    expect(catalogue).not.toHaveBeenCalled();
    expect(compare).not.toHaveBeenCalled();
  });
  it("defaults to NIV and NASB, searches the full catalogue beyond the visible first page, and chooses a pane", async () => {
    await render();
    const selects = document.querySelectorAll<HTMLSelectElement>("select");
    expect(selects[0].value).toBe("111");
    expect(selects[1].value).toBe("2692");
    expect(document.body.textContent).toContain("102 matching versions");
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
    const choose = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Use Authorized edition 99 on right"]',
    );
    await act(async () => choose?.click());
    expect(
      document.querySelectorAll<HTMLSelectElement>("select")[1].value,
    ).toBe("3099");
  });
  it("shows both real editions, notices and footnotes without AI controls, then hides stale or disconnected views", async () => {
    await render();
    await act(async () => button("Compare verses")?.click());
    expect(compare).toHaveBeenCalledWith({
      reference: "John 3:16-21",
      versionIds: [111, 2692],
    });
    expect(document.querySelectorAll(".licensed-bible-text")).toHaveLength(2);
    expect(document.body.textContent).toContain("Source text for edition 111");
    expect(document.body.textContent).toContain("Source text for edition 2692");
    expect(document.body.textContent).toContain("Original footnote");
    expect(document.body.textContent).toContain("Notice for 111");
    expect(button("Ask")).toBeUndefined();
    state.connected = false;
    await render();
    expect(document.querySelector(".licensed-bible-text")).toBeNull();
    state.connected = true;
    state.active = "other-window";
    await render();
    expect(document.querySelector(".licensed-bible-text")).toBeNull();
    expect(document.body.textContent).toContain("Only one Bible comparison");
  });
  it("keeps the catalogue usable after a comparison error and hides everything immediately on opt-out", async () => {
    compare.mockRejectedValueOnce(new Error("Not authorized"));
    await render();
    await act(async () => button("Compare verses")?.click());
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "Not authorized",
    );
    expect(document.body.textContent).toContain("Available Bibles");
    await act(async () => button("Retry passage")?.click());
    expect(document.querySelectorAll(".licensed-bible-text")).toHaveLength(2);
    state.enabled = false;
    await render();
    expect(document.querySelector(".licensed-bible-text")).toBeNull();
    expect(document.body.textContent).not.toContain("Available Bibles");
  });
});
