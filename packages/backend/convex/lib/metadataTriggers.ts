import { Triggers } from "convex-helpers/server/triggers";
import type { DataModel } from "../_generated/dataModel";
import { syncArticleMetadata, syncBookPartCard } from "./articleMetadata";
import { syncFingerprintSource } from "./fingerprintMetadata";
import { syncResumeEligibility } from "./readingResume";
import { membershipChanged } from "./shelfCounts";

export const metadataTriggers = new Triggers<DataModel>();
for (const kind of [
  "articles",
  "userNotes",
  "highlights",
  "companionThreads",
  "noteChunks",
] as const)
  metadataTriggers.register(kind, (ctx, change) =>
    syncFingerprintSource(
      { ...ctx, db: ctx.innerDb },
      kind,
      change.oldDoc,
      change.newDoc,
    ),
  );
metadataTriggers.register("articles", (ctx, change) =>
  syncArticleMetadata(
    { ...ctx, db: ctx.innerDb },
    change.oldDoc,
    change.newDoc,
  ),
);
metadataTriggers.register("articles", (ctx, change) =>
  syncResumeEligibility(
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
