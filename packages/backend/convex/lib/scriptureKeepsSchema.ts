import { defineTable } from "convex/server";
import { v } from "convex/values";

export const scriptureKeepTables = {
  scriptureKeeps: defineTable({
    userId: v.string(), referenceKey: v.string(), reference: v.string(),
    estimatedReadMinutes: v.number(), createdAt: v.number(),
    targetArticleId: v.optional(v.id("articles")),
    lastOpenedAt: v.optional(v.number()), lastOfferedAt: v.optional(v.number()),
  }).index("by_userId_and_referenceKey", ["userId", "referenceKey"])
    .index("by_userId", ["userId"])
    .index("by_targetArticleId", ["targetArticleId"]),
  scriptureKeepOrigins: defineTable({
    userId: v.string(), keepId: v.id("scriptureKeeps"), originKey: v.string(),
    sourceArticleId: v.optional(v.id("articles")), sourceReference: v.string(),
    sourceStudyId: v.optional(v.id("scriptureStudies")),
    sourceAnnotationId: v.optional(v.id("annotations")),
    reason: v.string(), createdAt: v.number(),
  }).index("by_userId_and_originKey", ["userId", "originKey"])
    .index("by_keepId", ["keepId"])
    .index("by_userId", ["userId"])
    .index("by_sourceArticleId", ["sourceArticleId"]),
};
