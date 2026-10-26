import { defineTable } from "convex/server";
import { v } from "convex/values";

export const tagVectorTables = {
  tagVectors: defineTable({
    userId: v.string(),
    tagId: v.id("tags"),
    key: v.string(),
    sourceCreationTime: v.number(),
    embedding: v.optional(v.array(v.float64())),
  })
    .index("by_userId_and_key_and_sourceCreationTime_and_tagId", [
      "userId",
      "key",
      "sourceCreationTime",
      "tagId",
    ])
    .index("by_tagId", ["tagId"]),
  // Size/overflow bookkeeping is deliberately off the vector row: aliases,
  // counts and promotion must never read or rewrite the vector collection.
  tagVectorSources: defineTable({
    userId: v.string(),
    tagId: v.id("tags"),
    vectorBytes: v.number(),
    overflow: v.boolean(),
  })
    .index("by_tagId", ["tagId"])
    .index("by_userId", ["userId"]),
  tagVectorState: defineTable({
    userId: v.string(),
    ready: v.boolean(),
    backfilled: v.boolean(),
    cursor: v.union(v.string(), v.null()),
    count: v.number(),
    vectorBytes: v.number(),
    overflow: v.number(),
    // Missing is the initial observer epoch for already-populated deployments.
    epoch: v.optional(v.number()),
    proof: v.optional(
      v.object({
        run: v.number(),
        epoch: v.number(),
        step: v.number(),
        phase: v.union(
          v.literal("canonical"),
          v.literal("vectors"),
          v.literal("sources"),
          v.literal("complete"),
          v.literal("failed"),
        ),
        cursor: v.union(v.string(), v.null()),
        count: v.number(),
        vectorBytes: v.number(),
        checkedCount: v.number(),
        checkedBytes: v.number(),
      }),
    ),
  }).index("by_userId", ["userId"]),
};
