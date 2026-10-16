// @vitest-environment happy-dom
import { act, type PropsWithChildren } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import NotesPage from "./page";

const mocks = vi.hoisted(() => ({
  listAll: [] as unknown[] | undefined,
  listKept: [] as unknown[] | undefined,
  removeThread: vi.fn(),
  removeNote: vi.fn(),
  push: vi.fn(),
}));

vi.mock("convex/react", () => ({
  useQuery: (ref: string) => (mocks as never)[ref],
  useMutation: (ref: string) => (mocks as never)[ref],
}));
vi.mock("@marginalia/backend/convex/_generated/api", () => ({
  api: {
    userNotes: { listAll: "listAll", remove: "removeNote" },
    companionThreads: { listKept: "listKept", remove: "removeThread" },
    articles: { getById: "getById" },
  },
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    className,
  }: PropsWithChildren<{ href: string; className?: string }>) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
vi.mock("@/components/desk-page", () => ({
  DeskPage: ({ children }: PropsWithChildren) => <main>{children}</main>,
}));

const note = (over: object) => ({
  _id: "n1",
  articleId: "art1",
  selectedText: "",
  contentPlain: "My own thought",
  createdAt: 1000,
  updatedAt: 1000,
  ...over,
});
const thread = (over: object) => ({
  _id: "t1",
  articleId: "art1",
  mode: "define",
  selection: "tarn",
  turns: [{ role: "assistant", content: "A small mountain lake." }],
  keptAt: 2000,
  createdAt: 2000,
  updatedAt: 2000,
  ...over,
});

let root: Root;
let host: HTMLElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  mocks.listAll = [];
  mocks.listKept = [];
  mocks.removeThread.mockReset();
  mocks.push.mockReset();
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const render = () => act(async () => root.render(<NotesPage />));
const lines = () => [
  ...host.querySelectorAll<HTMLElement>('[data-hand="pencil"] > button'),
];

describe("the Notes page", () => {
  it("shows a kept answer as one pencil line under its article, and expands it in place", async () => {
    mocks.listKept = [thread({})];
    await render();
    expect(host.textContent).not.toContain("No notes yet");
    const [line] = lines();
    expect(line.textContent).toContain("Marginalia’s answer · Define");
    expect(line.getAttribute("aria-expanded")).toBe("false");
    expect(host.textContent).not.toContain("A small mountain lake.");
    await act(async () => line.click());
    expect(line.getAttribute("aria-expanded")).toBe("true");
    expect(host.textContent).toContain("A small mountain lake.");
    expect(host.textContent).toContain("tarn");
  });

  it("puts the answer under the same article as the reader's notes, notes first", async () => {
    mocks.listAll = [note({})];
    mocks.listKept = [thread({})];
    await render();
    expect(
      host.querySelectorAll('a[href="/read/art1"]').length,
    ).toBeGreaterThan(0);
    const text = host.textContent ?? "";
    expect(text.indexOf("My own thought")).toBeLessThan(
      text.indexOf("Marginalia’s answer"),
    );
    // One article heading for both
    expect(host.querySelectorAll("a.text-xl")).toHaveLength(1);
  });

  it("orders articles by their most recent note or kept answer", async () => {
    mocks.listAll = [note({ articleId: "old", updatedAt: 100, _id: "n1" })];
    mocks.listKept = [thread({ articleId: "new", keptAt: 5000, _id: "t9" })];
    await render();
    const hrefs = [
      ...host.querySelectorAll<HTMLAnchorElement>("a.text-xl"),
    ].map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(["/read/new", "/read/old"]);
  });

  it("deletes a kept answer by removing its record", async () => {
    mocks.listKept = [thread({})];
    await render();
    await act(async () => lines()[0].click());
    const del = [...host.querySelectorAll("button")].find(
      (b) => b.textContent === "Delete",
    ) as HTMLElement;
    await act(async () => del.click());
    expect(mocks.removeThread).toHaveBeenCalledWith({ threadId: "t1" });
  });

  it("waits for both lists, and says so when there is nothing", async () => {
    mocks.listKept = undefined;
    await render();
    expect(host.querySelector('[role="status"]')).not.toBeNull();
    mocks.listKept = [];
    await render();
    expect(host.textContent).toContain("No notes yet");
  });
});
