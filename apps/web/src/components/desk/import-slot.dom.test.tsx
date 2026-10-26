// @vitest-environment happy-dom
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rememberedTitle } from "@/lib/title-handoff";
import { ImportView } from "./import-slot";

const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@marginalia/backend/convex/_generated/api", () => ({
  api: new Proxy(
    {},
    {
      get: (_, ns) =>
        new Proxy({}, { get: (_t, fn) => `${String(ns)}.${String(fn)}` }),
    },
  ),
}));
vi.mock("convex/react", () => ({
  useQuery: () => undefined,
  useMutation: () => vi.fn(),
}));

type Latest = NonNullable<ComponentProps<typeof ImportView>["latest"]>;
// SAFETY: fixtures carry only the fields the slot reads; the rest of the query row is irrelevant here.
const row = (fields: object) => fields as Latest;
const ready = row({
  _id: "imp1",
  fileName: "book.pdf",
  status: "ready",
  step: "point",
  articleId: "art1",
  title: "On Cows",
  pages: 12,
  minutes: 9,
});
const failed = row({
  _id: "imp2",
  fileName: "scan.pdf",
  status: "failed",
  step: "text",
  failure: "scanned",
});

let root: Root;
const onDismiss = vi.fn();
const view = (latest: Latest, autoOpen: boolean) =>
  act(() =>
    root.render(
      <ImportView
        latest={latest}
        autoOpen={autoOpen}
        upload={null}
        problem={null}
        onFile={vi.fn()}
        onClearProblem={vi.fn()}
        onDismiss={onDismiss}
      >
        <p>resting</p>
      </ImportView>,
    ),
  );

beforeEach(() => {
  push.mockReset();
  onDismiss.mockReset();
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
});

describe("an imported PDF that becomes readable", () => {
  it("opens the reader straight away when the reader is still waiting on the desk", () => {
    view(ready, true);
    expect(push).toHaveBeenCalledTimes(1);
    expect(push.mock.calls[0]?.[0]).toBe("/read/art1");
    expect(rememberedTitle("art1")).toBe("On Cows");
    expect(onDismiss).toHaveBeenCalledWith("imp1");
  });

  it("opens only once however often the desk re-renders", () => {
    view(ready, true);
    view({ ...ready }, true);
    expect(push).toHaveBeenCalledTimes(1);
  });

  it("stays at the Ready card when the reader has moved on", () => {
    view(ready, false);
    expect(push).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("Ready to read");
    expect(document.body.textContent).toContain("Start reading");
  });

  it("leaves a scanned refusal in place and opens nothing", () => {
    view(failed, true);
    expect(push).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain(
      "This PDF is scanned pages, with no text to read.",
    );
  });
});
