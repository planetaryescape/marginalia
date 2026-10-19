import { internal } from "../_generated/api";
import { pruneEdgeClaims } from "./edgeExplanations";
import { nodeKey } from "./ideaGraph";
import { metadataTriggers } from "./metadataTriggers";

// Only deletion/ownership boundaries, not an invented global graph revision.
for (const table of ["userNotes", "highlights", "companionThreads"] as const) {
  metadataTriggers.register(table, async (ctx, change) => {
    const before = change.oldDoc;
    if (!before || change.newDoc?.userId === before.userId) return;
    const kind =
      table === "userNotes"
        ? "note"
        : table === "highlights"
          ? "highlight"
          : "answer";
    const args = { userId: before.userId, node: nodeKey(kind, before._id) };
    if (await pruneEdgeClaims({ ...ctx, db: ctx.innerDb }, args))
      await ctx.scheduler.runAfter(0, internal.ideaEdgeReasons.prune, args);
  });
}
metadataTriggers.register("articles", async (ctx, change) => {
  const before = change.oldDoc;
  if (!before || change.newDoc?.userId === before.userId) return;
  const args = { userId: before.userId, articleId: before._id };
  if (await pruneEdgeClaims({ ...ctx, db: ctx.innerDb }, args))
    await ctx.scheduler.runAfter(0, internal.ideaEdgeReasons.prune, args);
});
metadataTriggers.register("noteChunks", async (ctx, change) => {
  const before = change.oldDoc;
  if (
    !before ||
    (change.newDoc?.userId === before.userId &&
      change.newDoc.filePath === before.filePath)
  )
    return;
  const args = {
    userId: before.userId,
    node: nodeKey("vault", before.filePath),
    via: String(before._id),
  };
  if (await pruneEdgeClaims({ ...ctx, db: ctx.innerDb }, args))
    await ctx.scheduler.runAfter(0, internal.ideaEdgeReasons.prune, args);
});
