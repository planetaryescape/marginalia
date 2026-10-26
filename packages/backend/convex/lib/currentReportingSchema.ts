import { defineTable } from "convex/server";
import { v } from "convex/values";

// Main registers these additive tables before the generic callbacks/backfill.
export const currentReportingTables = {
  visitReportingMetadata: defineTable({
    activityId: v.id("readingActivity"),
    userId: v.string(),
    articleId: v.id("articles"),
    sourceCreationTime: v.number(),
    startedAt: v.number(),
    activeTimeMs: v.number(),
    estimatedReadMinutes: v.optional(v.number()),
  })
    .index("by_activityId", ["activityId"])
    .index("by_userId", ["userId"])
    .index("by_userId_startedAt_sourceCreationTime_activityId", [
      "userId",
      "startedAt",
      "sourceCreationTime",
      "activityId",
    ]),
  dwellReportingMetadata: defineTable({
    dwellId: v.id("paragraphDwell"),
    userId: v.string(),
    articleId: v.id("articles"),
    sourceCreationTime: v.number(),
    updatedAt: v.number(),
    // One value per source record entry, in Object.values(source.dwell) order.
    // A Convex record has <=1024 entries; this is not an unbounded event list
    // (and is below the native 8192-element array limit).
    values: v.array(v.number()),
  })
    .index("by_dwellId", ["dwellId"])
    .index("by_userId", ["userId"])
    .index("by_userId_articleId_sourceCreationTime_dwellId", [
      "userId",
      "articleId",
      "sourceCreationTime",
      "dwellId",
    ]),
  currentReportingState: defineTable({
    userId: v.string(),
    kind: v.union(v.literal("visits"), v.literal("dwell")),
    ready: v.boolean(),
    cursor: v.union(v.null(), v.string()),
    backfilled: v.boolean(),
  })
    .index("by_userId_and_kind", ["userId", "kind"])
    .index("by_userId", ["userId"]),
};
