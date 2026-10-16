/**
 * The session's card list only grows. A live query can reorder or insert rows
 * anywhere, so cards already shown stay where they are and new ones go on the end.
 */
export function appendUnseen<T extends { _id: string }>(
  shown: readonly T[],
  incoming: readonly T[],
): T[] {
  const seen = new Set(shown.map((item) => item._id));
  const next = [...shown];
  for (const item of incoming) {
    if (seen.has(item._id)) continue;
    seen.add(item._id);
    next.push(item);
  }
  return next;
}

/**
 * Cards for a window the reader can finish in that time. The server's first
 * three can include a longer article, and an article without an estimate has
 * its length inferred from word count, so the page checks each card again.
 */
export function appendFitting<
  T extends { _id: string; estimatedReadMinutes: number },
>(shown: readonly T[], incoming: readonly T[], minutes: number): T[] {
  return appendUnseen(
    shown,
    incoming.filter((card) => card.estimatedReadMinutes <= minutes),
  );
}

/**
 * Runs one card action at a time. A call made while another is still pending is
 * dropped: the page reads the index at click time, so a second action that got
 * through would advance from the same card and skip one.
 */
export function createSingleFlight(): (
  task: () => Promise<void>,
) => Promise<void> {
  let pending = false;
  return async (task) => {
    if (pending) return;
    pending = true;
    try {
      await task();
    } finally {
      pending = false;
    }
  };
}

export type DeckView = "card" | "loading" | "end" | "empty";

/**
 * "end" and "empty" only once the server has nothing left to load; before that
 * a missing card means the next page is still on its way.
 */
export function deckView(input: {
  length: number;
  index: number;
  exhausted: boolean;
}): DeckView {
  if (input.index < input.length) return "card";
  if (!input.exhausted) return "loading";
  return input.length === 0 ? "empty" : "end";
}

// Fetch the next page while the reader still has this many cards to go
export const LOAD_AHEAD = 2;

export function shouldLoadMore(input: {
  length: number;
  index: number;
  canLoadMore: boolean;
}): boolean {
  return input.canLoadMore && input.length - input.index - 1 <= LOAD_AHEAD;
}
