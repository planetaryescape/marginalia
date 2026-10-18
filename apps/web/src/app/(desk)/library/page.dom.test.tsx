// @vitest-environment happy-dom
import { act, type PropsWithChildren } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import LibraryPage from "./page";

type QueryArgs = Record<string, never> | "skip";
interface StreamRequest {
  onText: (text: string) => void;
  signal: AbortSignal;
  resolve: () => void;
}
const mocks = vi.hoisted(() => {
  const queries: { name: string; args: QueryArgs }[] = [];
  const requests: StreamRequest[] = [];
  return { search: "", queries, requests };
});
vi.mock("convex/react", async () => {
  const { getFunctionName } = await import("convex/server");
  return {
    useQuery: (ref: never, args: QueryArgs) => {
      mocks.queries.push({ name: getFunctionName(ref), args });
      return undefined;
    },
  };
});
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(mocks.search),
}));
vi.mock("framer-motion", () => ({
  useReducedMotion: () => true,
  motion: { h1: ({ children }: PropsWithChildren) => <h1>{children}</h1> },
}));
vi.mock("next/link", () => ({
  default: ({ children, href }: PropsWithChildren<{ href: string }>) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("@/components/library-matches", () => ({
  LibraryMatches: () => <p>Matches</p>,
}));
vi.mock("@/components/library-topic", () => ({ LibraryTopic: () => null }));
vi.mock("@/components/library-shelves", () => ({
  SavedShelf: () => null,
  LovedShelf: () => null,
  FinishedShelf: () => null,
}));
vi.mock("@/components/up-next-shelf", () => ({ UpNextShelf: () => null }));
vi.mock("@/components/library-thread", () => ({
  LibraryThread: ({ turns }: { turns: { content: string }[] }) => (
    <div>{turns.map((turn) => turn.content).join(" ")}</div>
  ),
}));
vi.mock("@/lib/companion", () => ({
  ReaderRequestError: class extends Error {},
  streamFromConvex: (
    _path: string,
    _body: { question: string; history: { role: string; content: string }[] },
    callbacks: { onText: (text: string) => void; signal: AbortSignal },
  ) =>
    new Promise<void>((resolve) => {
      mocks.requests.push({ ...callbacks, resolve });
    }),
}));
let root: Root;
let host: HTMLElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.requests = [];
  mocks.queries = [];
  mocks.search = "";
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
const render = () => act(async () => root.render(<LibraryPage />));
const ask = async (text: string) => {
  const input = host.querySelector("input");
  if (!input) throw new Error("Missing question input");
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set?.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () =>
    host
      .querySelector("form")
      ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
};

it("ignores all updates and finalization from an aborted request after replacement", async () => {
  await render();
  await ask("first question");
  const first = mocks.requests[0];
  await act(async () =>
    [...host.querySelectorAll("button")]
      .find((button) => button.textContent === "New question")
      ?.click(),
  );
  expect(first.signal.aborted).toBe(true);
  await ask("replacement");
  const second = mocks.requests[1];
  await act(async () => {
    first.onText("STALE");
    first.resolve();
  });
  expect(host.textContent).not.toContain("STALE");
  expect(
    host.querySelector<HTMLButtonElement>('button[aria-label="Ask"]')?.disabled,
  ).toBe(true);
  await act(async () => {
    second.onText("Current answer");
    second.resolve();
  });
  expect(host.textContent).toContain("Current answer");
  expect(host.textContent).not.toContain("No answer came back");
});

it("skips every shelf-only query on committed search branches", async () => {
  mocks.search = "q=attention";
  await render();
  expect(mocks.queries.length).toBeGreaterThan(0);
  expect(mocks.queries.every((query) => query.args === "skip")).toBe(true);
});
