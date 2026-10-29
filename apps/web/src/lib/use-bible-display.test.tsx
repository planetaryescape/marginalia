// @vitest-environment happy-dom
import type { Id } from "@marginalia/backend/convex/_generated/dataModel";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useBibleDisplay } from "./use-bible-display";

const state = vi.hoisted(() => ({ active: "" }));
const read = vi.hoisted(() => vi.fn());
vi.mock("convex/react", () => ({
  useConvexConnectionState: () => ({ isWebSocketConnected: true }),
  useAction: () => read,
  useQuery: () => state.active,
}));
// The synthetic ID stays inside the mocked Convex boundary.
const source: NonNullable<Parameters<typeof useBibleDisplay>[0]> = {
  _id: "study-fixture" as Id<"articles">,
  title: "John 3:16",
  url: "https://bible-api.com",
  author: "WEB",
  imageUrl: undefined,
  content: "3:16 Public study words",
  contentHtml: '<p id="JHN.3.16">3:16 Public study words</p>',
  wordCount: 4,
  estimatedReadMinutes: 1,
  annotationStatus: "annotated",
  extractionStatus: "extracted",
  uploadedFileName: undefined,
  bookUnitCount: undefined,
  finishedAt: undefined,
  skipReason: undefined,
  bible: {
    reference: "John 3:16",
    translation: "web",
    copyright: "Public domain",
    displayVersionId: 111,
    displayVersionName: "NIV",
  },
};
let latest: ReturnType<typeof useBibleDisplay>;
let root: Root;
function Probe() {
  latest = useBibleDisplay(source);
  return <p>{latest.article?.content ?? "No licensed text"}</p>;
}
const render = () => act(async () => root.render(<Probe />));
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById("root")!);
  state.active = "";
  read
    .mockReset()
    .mockImplementation(
      async (args: {
        reference: string;
        versionIds: number[];
        displayToken: string;
      }) => {
        state.active = args.displayToken;
        return {
          token: args.displayToken,
          reference: args.reference,
          fontCss: "",
          panes: args.versionIds.map((id) => ({
            id,
            title: id === 111 ? "NIV" : "NASB",
            abbreviation: String(id),
            language: "en",
            html: `<p><span data-usfm="JHN.3.16">${id === 111 ? "NIV-display-only" : "NASB-display-only"}</span></p>`,
            copyright: "Current notice",
            publisher: "Publisher",
            publisherUrl: "https://example.com",
          })),
        };
      },
    );
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});
describe("normal-reader Bible display", () => {
  it("loads one display version by default, keeps the AI source separate, and compares only after explicit opt-in", async () => {
    await render();
    expect(read.mock.calls[0][0].versionIds).toEqual([111]);
    expect(latest.comparing).toBe(false);
    expect(latest.comparison).toBeUndefined();
    expect(latest.article?.content).toContain("NIV-display-only");
    expect(latest.source?.content).toBe("3:16 Public study words");
    await act(async () => latest.setComparing(true));
    expect(read.mock.calls.at(-1)?.[0].versionIds).toEqual([111, 2692]);
    expect(latest.comparison?.html).toContain("NASB-display-only");
    await act(async () => latest.setComparing(false));
    expect(latest.comparison).toBeUndefined();
    expect(read.mock.calls.at(-1)?.[0].versionIds).toEqual([111]);
  });
  it("does not lose the primary reading when an optional comparison fails", async () => {
    await render();
    read.mockImplementationOnce(async (args: { displayToken: string }) => {
      state.active = args.displayToken;
      throw new Error("Other edition unavailable");
    });
    await act(async () => latest.setComparing(true));
    expect(latest.error).toContain("Other edition unavailable");
    expect(latest.article?.content).toContain("NIV-display-only");
    expect(latest.comparison).toBeUndefined();
  });
  it("hides a retired licensed display rather than silently substituting the WEB study source", async () => {
    await render();
    state.active = "another-window";
    await render();
    expect(latest.article).toBeUndefined();
    expect(document.body.textContent).not.toContain("Public study words");
  });
});
