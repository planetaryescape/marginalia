// @vitest-environment happy-dom
import { getFunctionName } from "convex/server";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BibleDiscovery, BibleTimePick } from "./bible-discovery";
import { BibleSettings } from "./bible-settings";

const state = vi.hoisted(() => ({
  enabled: false,
  scope: "articles" as "articles" | "mixed" | "bible",
  translation: "web",
}));
const setPreferences = vi.hoisted(() => vi.fn().mockResolvedValue(null));
const suggest = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    passages: [
      {
        reference: "Psalms 23",
        title: "Rest",
        reason: "Comfort in uncertainty",
        minutes: 1,
      },
    ],
    notice: null,
  }),
);
const openPassage = vi.hoisted(() => vi.fn().mockResolvedValue("passageid"));
const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
vi.mock("convex/react", () => ({
  useQuery: (ref: Parameters<typeof getFunctionName>[0], args: unknown) => {
    if (args === "skip") return undefined;
    if (getFunctionName(ref) === "bible:preferences") return { ...state };
    if (getFunctionName(ref) === "bible:translations")
      return [
        {
          code: "web",
          name: "World English Bible",
          style: "Literal",
          available: true,
        },
        {
          code: "esv",
          name: "English Standard Version",
          style: "Literal",
          available: false,
        },
      ];
    throw new Error(`Unexpected query ${getFunctionName(ref)}`);
  },
  useMutation: () => setPreferences,
  useAction: (ref: Parameters<typeof getFunctionName>[0]) =>
    getFunctionName(ref) === "actions/bible:suggest" ? suggest : openPassage,
}));

let root: Root;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById("root")!);
  Object.assign(state, {
    enabled: false,
    scope: "articles",
    translation: "web",
  });
  vi.clearAllMocks();
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
const renderDiscovery = () =>
  act(async () => root.render(<BibleDiscovery preferences={{ ...state }} />));
const renderBiblePick = (minutes: number) =>
  act(async () => root.render(<BibleTimePick minutes={minutes} />));

describe("Bible opt-in controls", () => {
  it("shows only the opt-in setting before enabling", async () => {
    await act(async () => root.render(<BibleSettings />));
    expect(
      document.querySelector<HTMLInputElement>('[role="switch"]')?.checked,
    ).toBe(false);
    expect(document.querySelector("select")).toBeNull();
    await act(async () =>
      document.querySelector<HTMLButtonElement>('[role="switch"]')?.click(),
    );
    expect(setPreferences).toHaveBeenCalledWith({ enabled: true });
  });
  it("does not offer unavailable translations as working options", async () => {
    state.enabled = true;
    await act(async () => root.render(<BibleSettings />));
    expect(
      document.querySelector<HTMLOptionElement>('option[value="esv"]')
        ?.disabled,
    ).toBe(true);
    expect(
      document.querySelector<HTMLOptionElement>('option[value="web"]')
        ?.disabled,
    ).toBe(false);
  });
  it("does not show discovery or make requests while disabled", async () => {
    await renderDiscovery();
    expect(document.body.textContent).toBe("");
    expect(suggest).not.toHaveBeenCalled();
  });
  it("keeps article-only discovery free of Bible requests", async () => {
    state.enabled = true;
    await renderDiscovery();
    expect(document.body.textContent).toContain("Articles only");
    expect(document.body.textContent).not.toContain("Browse the Bible");
    expect(suggest).not.toHaveBeenCalled();
  });
  it("shows the selected source in the accessible radio group without an automatic search", async () => {
    Object.assign(state, { enabled: true, scope: "bible" });
    await renderDiscovery();
    expect(document.querySelector('[role="radiogroup"]')).not.toBeNull();
    expect(
      document
        .querySelector('[role="radio"][aria-checked="true"]')
        ?.getAttribute("aria-label"),
    ).toBe("Bible only");
    expect(suggest).not.toHaveBeenCalled();
  });
  it("does not start a topic request just by selecting a Bible scope", async () => {
    Object.assign(state, { enabled: true, scope: "bible", translation: "niv" });
    await renderDiscovery();
    expect(suggest).not.toHaveBeenCalled();
    expect(openPassage).not.toHaveBeenCalled();
  });
  it("drops source controls immediately after opt-out", async () => {
    Object.assign(state, { enabled: true, scope: "mixed" });
    await renderDiscovery();
    expect(document.body.textContent).toContain("Articles + Bible");
    state.enabled = false;
    await renderDiscovery();
    expect(document.body.textContent).toBe("");
  });
  it("cycles with unmodified F and moves focus through source radios with arrows", async () => {
    state.enabled = true;
    state.scope = "articles";
    await renderDiscovery();
    const radios = [
      ...document.querySelectorAll<HTMLButtonElement>("[role=radio]"),
    ];
    radios[0]?.focus();
    await act(async () =>
      radios[0]?.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "ArrowRight",
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    expect(document.activeElement).toBe(radios[1]);
    await act(async () =>
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "f",
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    expect(setPreferences).toHaveBeenCalledWith({ scope: "mixed" });
  });
  it("restores a Bible time pick in the same single-card Your pick pattern", async () => {
    await renderBiblePick(10);
    await act(async () => Promise.resolve());
    expect(suggest).toHaveBeenCalledWith({ question: "", minutes: 10 });
    expect(document.querySelector("h2")?.textContent).toBe("Rest");
    expect(document.body.textContent).toContain("Psalms 23 · ~1 min");
    expect(document.body.textContent).toContain("Read now");
    await act(async () =>
      [...document.querySelectorAll("button")]
        .find((button) => button.textContent === "Read now")
        ?.click(),
    );
    expect(openPassage).toHaveBeenCalledWith({ reference: "Psalms 23" });
    expect(push).toHaveBeenCalledWith("/read/passageid");
  });
  it("ignores a late timed-pick open after the selected time is replaced", async () => {
    let finishOpen!: (id: string) => void;
    openPassage.mockReturnValueOnce(
      new Promise((resolve) => (finishOpen = resolve)),
    );
    await renderBiblePick(10);
    await act(async () => Promise.resolve());
    await act(async () =>
      [...document.querySelectorAll("button")]
        .find((button) => button.textContent === "Read now")
        ?.click(),
    );
    await renderBiblePick(20);
    await act(async () => finishOpen("stale"));
    expect(push).not.toHaveBeenCalled();
  });
});
