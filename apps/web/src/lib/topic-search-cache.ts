import { SessionCache } from "@/lib/session-cache";
import type { TopicMatch } from "@/lib/topic-card";

export const TOPIC_CACHE_TTL_MS = 5 * 60_000;

export interface TopicCacheEntry {
  foundAt: number;
  find: { matches: TopicMatch[]; more: boolean };
  reasons: Record<string, string>;
  explained: boolean;
}

// Mutation callbacks import this small module, not the search hook or HTTP client.
export const topicSearchCache = new SessionCache<TopicCacheEntry>(
  20,
  TOPIC_CACHE_TTL_MS,
);

export function invalidateTopicSearchCache() {
  topicSearchCache.forScope(null);
}
