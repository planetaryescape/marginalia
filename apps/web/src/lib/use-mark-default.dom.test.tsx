// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { markColor } from "./mark-colours";
import { useLegacyMarkDefaults, useSetMarkDefault } from "./use-mark-default";

const state = vi.hoisted(() => ({
  settings: { highlighter: "yellow", pen: "cobalt" },
  stamp: vi.fn(() => new Promise(() => {})),
  update: vi.fn(),
}));
vi.mock("convex/react", () => ({
  useQuery: () => "reader-mark-fixture",
  useMutation: () => state.stamp,
}));
vi.mock("./reader-settings", async (original) => ({
  ...(await original<typeof import("./reader-settings")>()),
  useReaderSettings: () => ({ settings: state.settings, update: state.update }),
}));
it("changes defaults synchronously while legacy marks retain their historical colour during a slow background stamp", async () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
  vi.stubGlobal("localStorage", storage);
  storage.setItem(
    "marginalia:reader-settings",
    JSON.stringify({ highlighter: "blue", pen: "cobalt" }),
  );
  state.update.mockImplementation((patch) => {
    state.settings = { ...state.settings, ...patch };
  });
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  let change: ReturnType<typeof useSetMarkDefault> | undefined;
  function Probe() {
    change = useSetMarkDefault();
    const { colors } = useLegacyMarkDefaults();
    return <span>{markColor({ kind: "highlight" }, colors)}</span>;
  }
  await act(async () => root.render(<Probe />));
  expect(state.stamp).toHaveBeenCalledTimes(2);
  expect(change?.("highlight", "pink")).toBeUndefined();
  expect(state.update).toHaveBeenCalledWith({ highlighter: "pink" });
  await act(async () => root.render(<Probe />));
  expect(host.textContent).toBe("blue");
  expect(state.stamp).toHaveBeenCalledWith({
    kind: "highlight",
    color: "blue",
  });
  expect(state.stamp).toHaveBeenCalledTimes(2);
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
