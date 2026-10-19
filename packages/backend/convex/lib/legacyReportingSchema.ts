import { defineTable } from "convex/server";
import { v } from "convex/values";

// Additive schema contract. Main owns registration, purge and readiness rollout.
export const legacyReportingTables = {
  noteReportingMetadata: defineTable({
    noteId: v.id("userNotes"),
    userId: v.string(),
    articleId: v.id("articles"),
    sourceCreationTime: v.number(),
    createdAt: v.number(),
    annotationId: v.optional(v.id("annotations")),
    nonblank: v.boolean(),
  })
    .index("by_noteId", ["noteId"])
    .index("by_userId", ["userId"])
    .index("by_userId_and_createdAt_and_sourceCreationTime_and_noteId", [
      "userId",
      "createdAt",
      "sourceCreationTime",
      "noteId",
    ]),
  reflectionReportingMetadata: defineTable({
    reflectionId: v.id("reflections"),
    userId: v.string(),
    sourceCreationTime: v.number(),
    respondedAt: v.optional(v.number()),
    nonblank: v.boolean(),
  })
    .index("by_reflectionId", ["reflectionId"])
    .index("by_userId", ["userId"])
    .index(
      "by_userId_and_respondedAt_and_sourceCreationTime_and_reflectionId",
      ["userId", "respondedAt", "sourceCreationTime", "reflectionId"],
    ),
  legacyReportingState: defineTable({
    userId: v.string(),
    kind: v.union(v.literal("notes"), v.literal("reflections")),
    ready: v.boolean(),
    overflow: v.number(),
    cursor: v.union(v.null(), v.string()),
    backfilled: v.optional(v.boolean()),
  })
    .index("by_userId_and_kind", ["userId", "kind"])
    .index("by_userId", ["userId"]),
};
