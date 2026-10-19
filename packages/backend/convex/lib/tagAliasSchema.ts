import { defineTable } from "convex/server";
import { v } from "convex/values";

export const tagAliasTables = {
  tagAliases: defineTable({
    userId: v.string(),
    alias: v.string(),
    key: v.string(),
    sourceCreationTime: v.number(),
    tagId: v.id("tags"),
  })
    .index("by_userId_and_alias_and_key_and_sourceCreationTime_and_tagId", [
      "userId",
      "alias",
      "key",
      "sourceCreationTime",
      "tagId",
    ])
    .index("by_tagId", ["tagId"])
    .index("by_userId", ["userId"]),
  tagAliasSources: defineTable({
    userId: v.string(),
    tagId: v.id("tags"),
    overflow: v.boolean(),
  })
    .index("by_tagId", ["tagId"])
    .index("by_userId", ["userId"]),
  tagAliasState: defineTable({
    userId: v.string(),
    ready: v.boolean(),
    backfilled: v.boolean(),
    overflow: v.number(),
    cursor: v.union(v.string(), v.null()),
  }).index("by_userId", ["userId"]),
};
