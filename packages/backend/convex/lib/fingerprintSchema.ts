import { defineTable } from "convex/server";
import { v } from "convex/values";

export const fingerprintKind = v.union(
  v.literal("articles"),
  v.literal("userNotes"),
  v.literal("highlights"),
  v.literal("companionThreads"),
  v.literal("noteChunks"),
);

// No text, paths, vectors or revision counters. One independently written row
// per source; the state row is touched only by explicit migration, not writers.
export const fingerprintTables = {
  marginaliaSourceStamps: defineTable({
    sourceId: v.union(
      v.id("articles"),
      v.id("userNotes"),
      v.id("highlights"),
      v.id("companionThreads"),
      v.id("noteChunks"),
    ),
    kind: fingerprintKind,
    userId: v.string(),
    sourceCreationTime: v.number(),
    updatedAt: v.optional(v.number()),
    embeddedAt: v.optional(v.number()),
    indexedAt: v.optional(v.number()),
  })
    .index("by_sourceId", ["sourceId"])
    .index("by_userId_and_kind_and_sourceCreationTime", [
      "userId",
      "kind",
      "sourceCreationTime",
    ])
    .index("by_userId_and_kind_and_updatedAt", ["userId", "kind", "updatedAt"])
    .index("by_userId_and_kind_and_embeddedAt", [
      "userId",
      "kind",
      "embeddedAt",
    ])
    .index("by_userId_and_kind_and_indexedAt", ["userId", "kind", "indexedAt"]),
  marginaliaFingerprintState: defineTable({
    userId: v.string(),
    phase: v.union(fingerprintKind, v.literal("done")),
    cursor: v.union(v.string(), v.null()),
  }).index("by_userId", ["userId"]),
};
