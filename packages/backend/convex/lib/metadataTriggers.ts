import { Triggers } from "convex-helpers/server/triggers";
import type { DataModel } from "../_generated/dataModel";
import { syncArticleMetadata, syncBookPartCard } from "./articleMetadata";
import { membershipChanged } from "./shelfCounts";

export const metadataTriggers = new Triggers<DataModel>();
metadataTriggers.register("articles", (ctx, change) =>
  syncArticleMetadata(
    { ...ctx, db: ctx.innerDb },
    change.oldDoc,
    change.newDoc,
  ),
);
metadataTriggers.register("bookUnits", (ctx, change) =>
  syncBookPartCard({ ...ctx, db: ctx.innerDb }, change.oldDoc, change.newDoc),
);
metadataTriggers.register("savedArticles", (ctx, change) =>
  membershipChanged(
    { ...ctx, db: ctx.innerDb },
    "savedArticles",
    change.oldDoc,
    change.newDoc,
  ),
);
metadataTriggers.register("lovedArticles", (ctx, change) =>
  membershipChanged(
    { ...ctx, db: ctx.innerDb },
    "lovedArticles",
    change.oldDoc,
    change.newDoc,
  ),
);
