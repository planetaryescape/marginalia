// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { type SuggestionDeck, useSuggestionDeck } from "./use-suggestion-deck";

type QueryArgs = { requestedMinutes?: number } | "skip";
const mocks = vi.hoisted(() => {
  const head: { _id: string; estimatedReadMinutes: number }[] = [];
  const queries: { ref: string; args: QueryArgs }[] = [];
  const pages: QueryArgs[] = [];
  return {
    head,
    queries,
    pages,
    annotate: vi.fn(async () => {}),
    loadMore: vi.fn(),
  };
});
vi.mock("@marginalia/backend/convex/_generated/api", () => ({
  api: {
    suggestions: {
      forWindow: "head",
      moreForWindow: "more",
      shortestUnread: "shortest",
    },
    articles: { annotateAhead: "annotate" },
  },
}));
vi.mock("convex/react", () => ({
  useQuery: (ref: string, args: QueryArgs) => {
    mocks.queries.push({ ref, args });
    return ref === "head" && args !== "skip" ? mocks.head : undefined;
  },
  usePaginatedQuery: (_ref: string, args: QueryArgs) => {
    mocks.pages.push(args);
    return {
      results: [],
      status: args === "skip" ? "LoadingFirstPage" : "CanLoadMore",
      loadMore: mocks.loadMore,
    };
  },
  useMutation: () => mocks.annotate,
}));
let deck: SuggestionDeck;
function Probe() {
  deck = useSuggestionDeck(10);
  return null;
}
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.queries = [];
  mocks.pages = [];
  mocks.head = ["a", "b", "c"].map((_id) => ({ _id, estimatedReadMinutes: 3 }));
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});
const render = () => act(async () => root.render(<Probe />));

it("releases the frozen head and waits for demand before starting continuation", async () => {
  await render();
  expect(deck.card?._id).toBe("a");
  expect(
    mocks.queries.filter((query) => query.ref === "head").at(-1)?.args,
  ).toBe("skip");
  expect(mocks.pages.every((args) => args === "skip")).toBe(true);
  await act(async () => deck.advance(0));
  expect(deck.card?._id).toBe("b");
  expect(mocks.pages.at(-1)).toEqual({ requestedMinutes: 10 });
  await act(async () => deck.advance(0));
  expect(deck.card?._id).toBe("b");
});

it("starts continuation when the head has no fitting cards instead of hanging", async () => {
  mocks.head = [{ _id: "long", estimatedReadMinutes: 20 }];
  await render();
  expect(mocks.pages.at(-1)).toEqual({ requestedMinutes: 10 });
  expect(deck.view).toBe("loading");
});
