// @vitest-environment happy-dom
import { getFunctionName } from "convex/server";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BibleDiscovery } from "./bible-discovery";
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
  act(async () =>
    root.render(<BibleDiscovery preferences={{ ...state }} minutes={5} />),
  );

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
  it("uses the selected time and opens an actual passage", async () => {
    Object.assign(state, { enabled: true, scope: "bible" });
    await renderDiscovery();
    expect(suggest).toHaveBeenCalledWith({ question: "", minutes: 5 });
    const button = Array.from(document.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Psalms 23"),
    );
    expect(button).toBeDefined();
    await act(async () => button?.click());
    expect(openPassage).toHaveBeenCalledWith({ reference: "Psalms 23" });
    expect(push).toHaveBeenCalledWith("/read/passageid");
  });
  it("times out independently and ignores a late response", async () => {
    Object.assign(state, { enabled: true, scope: "mixed" });
    let resolve:
      | ((value: Awaited<ReturnType<typeof suggest>>) => void)
      | undefined;
    suggest.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    await act(async () =>
      root.render(
        <>
          <p>Ready article</p>
          <BibleDiscovery preferences={{ ...state }} minutes={5} />
        </>,
      ),
    );
    await act(async () => vi.advanceTimersByTimeAsync(30_000));
    expect(document.body.textContent).toContain("Ready article");
    expect(document.body.textContent).toContain(
      "Bible search couldn't complete",
    );
    await act(async () =>
      resolve?.({
        passages: [
          {
            reference: "Psalms 23",
            title: "Late",
            reason: "Too late",
            minutes: 1,
          },
        ],
        notice: null,
      }),
    );
    expect(document.body.textContent).not.toContain("Psalms 23");
    const retry = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent === "Retry Bible search",
    );
    await act(async () => retry?.click());
    expect(suggest).toHaveBeenCalledTimes(2);
    expect(document.body.textContent).toContain("Psalms 23");
  });
  it("opens licensed suggestions in the normal reader without automatically enabling comparison", async () => {
    Object.assign(state, { enabled: true, scope: "bible", translation: "niv" });
    await renderDiscovery();
    const passage = Array.from(document.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Psalms 23"),
    );
    await act(async () => passage?.click());
    expect(openPassage).toHaveBeenCalledWith({ reference: "Psalms 23" });
    expect(push).toHaveBeenCalledWith("/read/passageid");
  });
  it("drops passage results immediately after opt-out", async () => {
    Object.assign(state, { enabled: true, scope: "mixed" });
    await renderDiscovery();
    expect(document.body.textContent).toContain("Psalms 23");
    state.enabled = false;
    await renderDiscovery();
    expect(document.body.textContent).toBe("");
  });
});
