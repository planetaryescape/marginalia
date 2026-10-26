// @vitest-environment happy-dom
import type { api } from "@marginalia/backend/convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import { act, useSyncExternalStore } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { markColor } from "./mark-colours";
import { DEFAULT_SETTINGS, type ReaderSettings } from "./reader-settings";
import { useLegacyMarkDefaults, useSetMarkDefault } from "./use-mark-default";

type Status = FunctionReturnType<typeof api.highlights.legacyDefaults>;
const mocks = vi.hoisted(() => ({
  settings: null as ReaderSettings | null,
  status: undefined as Status | undefined,
  listeners: new Set<() => void>(),
  update: vi.fn(),
  stamp: vi.fn(),
}));

const subscribe = (listener: () => void) => {
  mocks.listeners.add(listener);
  return () => mocks.listeners.delete(listener);
};
const notify = () => {
  for (const listener of mocks.listeners) listener();
};

vi.mock("./reader-settings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./reader-settings")>();
  return {
    ...actual,
    useReaderSettings: () => ({
      settings: useSyncExternalStore(
        subscribe,
        () => mocks.settings ?? actual.DEFAULT_SETTINGS,
        () => actual.DEFAULT_SETTINGS,
      ),
      update: mocks.update,
    }),
  };
});
vi.mock("convex/react", () => ({
  useMutation: () => mocks.stamp,
  useQuery: () =>
    useSyncExternalStore(
      subscribe,
      () => mocks.status,
      () => mocks.status,
    ),
}));
vi.mock("@marginalia/backend/convex/_generated/api", () => ({
  api: { highlights: { legacyDefaults: "status", stampUncoloured: "stamp" } },
}));

let host: HTMLElement;
let root: Root | null;
let choose: ReturnType<typeof useSetMarkDefault>;
let ordinal = 0;
function Harness() {
  const { colors, readerId } = useLegacyMarkDefaults();
  choose = useSetMarkDefault();
  const settings = useSyncExternalStore(
    subscribe,
    () => mocks.settings ?? DEFAULT_SETTINGS,
    () => DEFAULT_SETTINGS,
  );
  return (
    <div
      data-reader={readerId}
      data-legacy={colors.highlighter}
      data-pen={colors.pen}
      data-current={settings.highlighter}
    />
  );
}
async function render() {
  root ??= createRoot(host);
  await act(async () => root?.render(<Harness />));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("localStorage", new Storage());
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  root = null;
  host = document.body.appendChild(document.createElement("div"));
  mocks.settings = { ...DEFAULT_SETTINGS, highlighter: "pink", pen: "forest" };
  mocks.status = {
    readerId: `mark-default-test-${++ordinal}`,
    highlighter: null,
    pen: null,
  };
  window.localStorage.setItem(
    "marginalia:reader-settings",
    JSON.stringify(mocks.settings),
  );
  mocks.stamp.mockReset().mockResolvedValue(undefined);
  mocks.update
    .mockReset()
    .mockImplementation((patch: Partial<ReaderSettings>) => {
      mocks.settings = { ...DEFAULT_SETTINGS, ...mocks.settings, ...patch };
      window.localStorage.setItem(
        "marginalia:reader-settings",
        JSON.stringify(mocks.settings),
      );
      notify();
    });
});
afterEach(async () => {
  await act(async () => root?.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("never starts a migration during SSR and initializes from the stored preference after real hydration, not SSR yellow/cobalt", async () => {
  const storage = vi.spyOn(Storage.prototype, "getItem");
  const html = renderToString(<Harness />);
  expect(html).toContain('data-legacy="yellow"');
  expect(mocks.stamp).not.toHaveBeenCalled();
  expect(storage).not.toHaveBeenCalled();
  host.innerHTML = html;
  await act(async () => {
    root = hydrateRoot(host, <Harness />);
  });
  expect(mocks.stamp).toHaveBeenCalledWith({
    kind: "highlight",
    color: "pink",
    expectedReaderId: mocks.status?.readerId,
  });
  expect(mocks.stamp).toHaveBeenCalledWith({
    kind: "underline",
    color: "forest",
    expectedReaderId: mocks.status?.readerId,
  });
  expect(host.firstElementChild?.getAttribute("data-legacy")).toBe("pink");
});

it("changes the local default synchronously without waiting for stamping, retaining the old colour for legacy marks", async () => {
  mocks.stamp.mockImplementation(() => new Promise(() => {}));
  await render();
  act(() => {
    expect(choose("highlight", "green")).toBeUndefined();
  });
  expect(mocks.update).toHaveBeenCalledWith({ highlighter: "green" });
  expect(host.firstElementChild?.getAttribute("data-current")).toBe("green");
  expect(host.firstElementChild?.getAttribute("data-legacy")).toBe("pink");
  expect(
    markColor({ kind: "highlight" }, { highlighter: "pink", pen: "forest" }),
  ).toBe("pink");
  expect(
    markColor(
      { kind: "highlight", color: "green" },
      { highlighter: "pink", pen: "forest" },
    ),
  ).toBe("green");
});

it("does not initialize from unpersisted SSR defaults when storage is denied; an intentional change freezes the previous hydrated display", async () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("denied");
  });
  const html = renderToString(<Harness />);
  expect(mocks.stamp).not.toHaveBeenCalled();
  host.innerHTML = html;
  await act(async () => {
    root = hydrateRoot(host, <Harness />);
  });
  expect(mocks.stamp).not.toHaveBeenCalled();
  await act(async () => choose("highlight", "green"));
  expect(mocks.stamp).toHaveBeenCalledWith({
    kind: "highlight",
    color: "pink",
    expectedReaderId: mocks.status?.readerId,
  });
  expect(
    mocks.stamp.mock.calls.some(([args]) => args.kind === "underline"),
  ).toBe(false);
});

it("keeps a fresh QA profile read-only until an intentional colour change, then preserves its previous display without waiting", async () => {
  mocks.settings = { ...DEFAULT_SETTINGS };
  window.localStorage.removeItem("marginalia:reader-settings");
  await render();
  await act(async () => vi.advanceTimersByTime(30_000));
  expect(mocks.stamp).not.toHaveBeenCalled();
  expect(host.firstElementChild?.getAttribute("data-legacy")).toBe("yellow");
  mocks.stamp.mockImplementation(() => new Promise(() => {}));
  await act(async () => {
    expect(choose("highlight", "green")).toBeUndefined();
  });
  expect(host.firstElementChild?.getAttribute("data-current")).toBe("green");
  expect(host.firstElementChild?.getAttribute("data-legacy")).toBe("yellow");
  expect(mocks.stamp).toHaveBeenCalledWith({
    kind: "highlight",
    color: "yellow",
    expectedReaderId: mocks.status?.readerId,
  });
  expect(
    mocks.stamp.mock.calls.some(([args]) => args.kind === "underline"),
  ).toBe(false);
});

it("does not promote a fresh profile merely because an unrelated setting persists default colour fields", async () => {
  mocks.settings = { ...DEFAULT_SETTINGS };
  window.localStorage.removeItem("marginalia:reader-settings");
  await render();
  await act(async () => mocks.update({ theme: "night" }));
  expect(mocks.stamp).not.toHaveBeenCalled();
});

it("requires strictly validated prior colour preferences, not repaired/corrupt saved defaults", async () => {
  window.localStorage.setItem(
    "marginalia:reader-settings",
    JSON.stringify({ highlighter: "invalid", pen: "forest" }),
  );
  await render();
  expect(mocks.stamp).not.toHaveBeenCalled();
});

it("resumes an existing canonical baseline even from a fresh profile without choosing a new baseline", async () => {
  mocks.settings = { ...DEFAULT_SETTINGS };
  window.localStorage.removeItem("marginalia:reader-settings");
  mocks.status = {
    readerId: mocks.status?.readerId ?? "missing",
    highlighter: { color: "pink", version: 1, ready: false },
    pen: null,
  };
  await render();
  expect(host.firstElementChild?.getAttribute("data-legacy")).toBe("pink");
  expect(mocks.stamp).toHaveBeenCalledWith({
    kind: "highlight",
    color: "pink",
    expectedReaderId: mocks.status?.readerId,
  });
  expect(
    mocks.stamp.mock.calls.some(([args]) => args.kind === "underline"),
  ).toBe(false);
});

it("freezes locally while offline, retries kickoff safely on reconnect and after failure, and cancels local retry timers on unmount", async () => {
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  mocks.stamp.mockRejectedValue(new Error("offline"));
  await render();
  expect(mocks.stamp).not.toHaveBeenCalled();
  act(() => choose("highlight", "blue"));
  expect(host.firstElementChild?.getAttribute("data-current")).toBe("blue");
  expect(host.firstElementChild?.getAttribute("data-legacy")).toBe("pink");
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  await act(async () => window.dispatchEvent(new Event("online")));
  expect(mocks.stamp).toHaveBeenCalledWith({
    kind: "highlight",
    color: "pink",
    expectedReaderId: mocks.status?.readerId,
  });
  const attempts = mocks.stamp.mock.calls.length;
  await act(async () => vi.advanceTimersByTime(5_000));
  expect(mocks.stamp.mock.calls.length).toBeGreaterThan(attempts);
  await act(async () => root?.unmount());
  root = null;
  const before = mocks.stamp.mock.calls.length;
  await act(async () => vi.advanceTimersByTime(30_000));
  expect(mocks.stamp).toHaveBeenCalledTimes(before);
});

it("uses an existing canonical baseline despite different device preferences and stops kickoff when both tools are ready", async () => {
  mocks.status = {
    readerId: mocks.status?.readerId ?? "missing",
    highlighter: { color: "blue", version: 1, ready: true },
    pen: { color: "cobalt", version: 1, ready: true },
  };
  await render();
  expect(host.firstElementChild?.getAttribute("data-legacy")).toBe("blue");
  expect(host.firstElementChild?.getAttribute("data-pen")).toBe("cobalt");
  expect(mocks.stamp).not.toHaveBeenCalled();
  act(() => choose("highlight", "green"));
  expect(host.firstElementChild?.getAttribute("data-current")).toBe("green");
  expect(host.firstElementChild?.getAttribute("data-legacy")).toBe("blue");
  expect(mocks.stamp).not.toHaveBeenCalled();
});

it("does not lose a failed kickoff's retry when the other tool's readiness changes while it is pending", async () => {
  let reject: (reason: Error) => void = () => {};
  let attempts = 0;
  mocks.stamp.mockImplementation(
    ({ kind }: { kind: "highlight" | "underline" }) => {
      if (kind === "highlight" && attempts++ === 0)
        return new Promise<void>((_resolve, fail) => {
          reject = fail;
        });
      return Promise.resolve();
    },
  );
  await render();
  await act(async () => {
    mocks.status = {
      readerId: mocks.status?.readerId ?? "missing",
      highlighter: null,
      pen: { color: "forest", version: 1, ready: true },
    };
    notify();
  });
  await act(async () => reject(new Error("offline")));
  await act(async () => vi.advanceTimersByTime(5_000));
  expect(attempts).toBe(2);
});

it("lets a canonical response win over an offline provisional freeze without changing the new default", async () => {
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  await render();
  act(() => choose("highlight", "green"));
  expect(host.firstElementChild?.getAttribute("data-legacy")).toBe("pink");
  await act(async () => {
    mocks.status = {
      readerId: mocks.status?.readerId ?? "missing",
      highlighter: { color: "yellow", version: 1, ready: false },
      pen: { color: "graphite", version: 1, ready: false },
    };
    notify();
  });
  expect(host.firstElementChild?.getAttribute("data-legacy")).toBe("yellow");
  expect(host.firstElementChild?.getAttribute("data-pen")).toBe("graphite");
  expect(host.firstElementChild?.getAttribute("data-current")).toBe("green");
});

it("rejects invalid colour/tool combinations before changing local settings", async () => {
  await render();
  expect(() => choose("highlight", "cobalt")).toThrow();
  expect(() => choose("underline", "yellow")).toThrow();
  expect(mocks.update).not.toHaveBeenCalled();
});

it("scopes provisional preferences and queued kickoffs to the identity returned by the status query", async () => {
  await render();
  const nextId = `mark-default-test-${++ordinal}`;
  await act(async () => {
    mocks.settings = {
      ...DEFAULT_SETTINGS,
      highlighter: "green",
      pen: "graphite",
    };
    window.localStorage.setItem(
      "marginalia:reader-settings",
      JSON.stringify(mocks.settings),
    );
    mocks.status = { readerId: nextId, highlighter: null, pen: null };
    notify();
  });
  expect(host.firstElementChild?.getAttribute("data-reader")).toBe(nextId);
  expect(host.firstElementChild?.getAttribute("data-legacy")).toBe("green");
  expect(mocks.stamp).toHaveBeenCalledWith({
    kind: "highlight",
    color: "green",
    expectedReaderId: nextId,
  });
  expect(mocks.stamp).toHaveBeenCalledWith({
    kind: "underline",
    color: "graphite",
    expectedReaderId: nextId,
  });
});
