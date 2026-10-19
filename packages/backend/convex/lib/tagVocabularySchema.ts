import { defineTable } from "convex/server";
import { v } from "convex/values";

/** Small, vector-free projections. Main registers these tables and the trigger. */
export const tagVocabularyTables = {
  tagVocabulary: defineTable({
    userId: v.string(),
    tagId: v.id("tags"),
    sourceCreationTime: v.number(),
    key: v.string(),
    count: v.number(),
    active: v.boolean(),
    overflow: v.boolean(),
    payloadId: v.id("tagVocabularyPayloads"),
    left: v.union(v.id("tagVocabulary"), v.null()),
    right: v.union(v.id("tagVocabulary"), v.null()),
    height: v.number(),
  })
    .index("by_tagId", ["tagId"])
    .index("by_userId_and_key_and_sourceCreationTime_and_tagId", [
      "userId",
      "key",
      "sourceCreationTime",
      "tagId",
    ])
    .index("by_userId", ["userId"]),
  // Rotations/height reads must never hydrate names, aliases or embedding text.
  tagVocabularyPayloads: defineTable({
    userId: v.string(),
    tagId: v.id("tags"),
    sourceCreationTime: v.number(),
    key: v.string(),
    missing: v.boolean(),
    name: v.string(),
    aliases: v.array(v.string()),
    text: v.string(),
  })
    .index("by_userId", ["userId"])
    // Explicit source ties retain canonical key-index order even after rename.
    .index("by_userId_and_missing_and_key", [
      "userId",
      "missing",
      "key",
      "sourceCreationTime",
      "tagId",
    ]),
  tagVocabularyState: defineTable({
    userId: v.string(),
    root: v.union(v.id("tagVocabulary"), v.null()),
    overflow: v.number(),
    ready: v.boolean(),
    cursor: v.union(v.string(), v.null()),
  }).index("by_userId", ["userId"]),
};
