import { describe, expect, it, vi } from "vitest";
import {
  ANNOTATE_AHEAD,
  annotateAheadIds,
  appendFitting,
  appendUnseen,
  createSingleFlight,
  deckView,
  LOAD_AHEAD,
  shouldLoadMore,
} from "./suggestion-deck";

const item = (id: string) => ({ _id: id, title: id });
const ids = (rows: { _id: string }[]) => rows.map((r) => r._id);

describe("appendUnseen", () => {
  it("keeps shown cards in place when a live update reorders the rows", () => {
    const shown = [item("a"), item("b")];
    const after = appendUnseen(shown, [item("c"), item("a"), item("b")]);
    expect(ids(after)).toEqual(["a", "b", "c"]);
  });

  it("never removes a card that a later result no longer includes", () => {
    const shown = [item("a"), item("b"), item("c")];
    expect(ids(appendUnseen(shown, [item("c"), item("d")]))).toEqual([
      "a",
      "b",
      "c",
      "d",
    ]);
  });

  it("drops duplicates within the incoming page too", () => {
    expect(ids(appendUnseen([], [item("x"), item("x"), item("y")]))).toEqual([
      "x",
      "y",
    ]);
  });

  it("does not mutate the list it was given", () => {
    const shown = [item("a")];
    appendUnseen(shown, [item("b")]);
    expect(ids(shown)).toEqual(["a"]);
  });
});

describe("appendFitting", () => {
  const card = (id: string, minutes: number) => ({
    _id: id,
    title: id,
    estimatedReadMinutes: minutes,
  });

  it("drops any card longer than the window, even from the server's first three", () => {
    const after = appendFitting(
      [],
      [card("long", 40), card("short", 4), card("exact", 5)],
      5,
    );
    expect(ids(after)).toEqual(["short", "exact"]);
  });

  it("keeps the first three fitting cards the server offered, in order", () => {
    const after = appendFitting(
      [],
      [card("a", 2), card("b", 3), card("c", 4)],
      5,
    );
    expect(ids(after)).toEqual(["a", "b", "c"]);
  });
});

describe("deckView", () => {
  it("shows the card while one is left to show", () => {
    expect(deckView({ length: 3, index: 2, exhausted: false })).toBe("card");
    expect(deckView({ length: 3, index: 2, exhausted: true })).toBe("card");
  });

  it("shows loading, not the end, when the list runs out before the server is done", () => {
    expect(deckView({ length: 3, index: 3, exhausted: false })).toBe("loading");
    expect(deckView({ length: 0, index: 0, exhausted: false })).toBe("loading");
  });

  it("shows the end once the server has nothing more", () => {
    expect(deckView({ length: 3, index: 3, exhausted: true })).toBe("end");
  });

  it("shows empty when nothing fits at all", () => {
    expect(deckView({ length: 0, index: 0, exhausted: true })).toBe("empty");
  });
});

describe("shouldLoadMore", () => {
  it("asks for the next page when the reader is near the end of the loaded cards", () => {
    expect(
      shouldLoadMore({
        length: 10,
        index: 10 - 1 - LOAD_AHEAD,
        canLoadMore: true,
      }),
    ).toBe(true);
    expect(shouldLoadMore({ length: 10, index: 0, canLoadMore: true })).toBe(
      false,
    );
  });

  it("does not ask while a page is already loading or the list is exhausted", () => {
    expect(shouldLoadMore({ length: 3, index: 2, canLoadMore: false })).toBe(
      false,
    );
  });
});

describe("createSingleFlight", () => {
  it("runs one task and drops a second that starts while the first is pending", async () => {
    const run = createSingleFlight();
    let release: () => void = () => {};
    const first = vi.fn(
      () => new Promise<void>((resolve) => (release = resolve)),
    );
    const second = vi.fn(async () => {});
    const pending = run(first);
    await run(second);
    expect(second).not.toHaveBeenCalled();
    release();
    await pending;
    expect(first).toHaveBeenCalledTimes(1);
  });

  it("accepts the next task once the first has failed", async () => {
    const run = createSingleFlight();
    await expect(
      run(async () => {
        throw new Error("network");
      }),
    ).rejects.toThrow("network");
    const next = vi.fn(async () => {});
    await run(next);
    expect(next).toHaveBeenCalledTimes(1);
  });
});

describe("annotateAheadIds", () => {
  const deck = [
    { _id: "a", deferred: true },
    { _id: "b" },
    { _id: "c", deferred: true },
    { _id: "d", deferred: true },
  ];

  it("takes the deferred cards among the one shown and the next two", () => {
    expect(ANNOTATE_AHEAD).toBe(3);
    expect(annotateAheadIds(deck, 0, new Set())).toEqual(["a", "c"]);
    expect(annotateAheadIds(deck, 1, new Set())).toEqual(["c", "d"]);
  });

  it("skips cards already asked for and cards behind the reader", () => {
    expect(annotateAheadIds(deck, 1, new Set(["c"]))).toEqual(["d"]);
    expect(annotateAheadIds(deck, 3, new Set(["d"]))).toEqual([]);
  });
});
