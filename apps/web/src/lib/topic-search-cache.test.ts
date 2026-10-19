import { describe, expect, it } from "vitest";
import {
  invalidateTopicSearchCache,
  topicSearchCache,
} from "./topic-search-cache";

describe("server/unsupported-browser public invalidator", () => {
  it("still invalidates locally without browser storage or a channel", () => {
    topicSearchCache.forScope("fixture-session");
    const generation = topicSearchCache.generation;
    const entry = {
      foundAt: Date.now(),
      find: { matches: [], more: false },
      reasons: {},
      explained: true,
    };
    topicSearchCache.set("query", entry);
    expect(() => invalidateTopicSearchCache()).not.toThrow();
    expect(topicSearchCache.get("query")).toBeUndefined();
    topicSearchCache.set("late", entry, generation);
    expect(topicSearchCache.get("late")).toBeUndefined();
  });
});
