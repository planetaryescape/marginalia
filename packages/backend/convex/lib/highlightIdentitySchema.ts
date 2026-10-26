import { defineTable } from "convex/server";
import { v } from "convex/values";

export const highlightIdentityTables = {
  highlightIdentities: defineTable({
    userId: v.string(),
    articleId: v.id("articles"),
    highlightId: v.id("highlights"),
    textHash: v.string(),
  })
    .index("by_highlightId", ["highlightId"])
    .index("by_userId", ["userId"])
    .index("by_userId_and_articleId_and_textHash", [
      "userId",
      "articleId",
      "textHash",
    ]),
  highlightIdentityState: defineTable({
    userId: v.string(),
    articleId: v.id("articles"),
    cursor: v.union(v.string(), v.null()),
    ready: v.boolean(),
  })
    .index("by_articleId", ["articleId"])
    .index("by_userId", ["userId"]),
};
