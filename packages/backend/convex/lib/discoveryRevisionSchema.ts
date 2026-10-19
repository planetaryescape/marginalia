import { defineTable } from "convex/server";
import { v } from "convex/values";

export const discoveryEpochs = defineTable({
  userId: v.string(),
  shard: v.number(),
  epoch: v.number(),
}).index("by_userId_and_shard", ["userId", "shard"]);
