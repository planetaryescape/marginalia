import { Triggers } from "convex-helpers/server/triggers";
import type { DataModel } from "../_generated/dataModel";
import { syncArticleMetadata, syncBookPartCard } from "./articleMetadata";
import { invalidateFeedPoll } from "./feedPollLifecycle";
import { cancelFeedArticleProof } from "./feedRemovalState";
import { syncFeedStatus } from "./feedStatus";
import { syncFingerprintSource } from "./fingerprintMetadata";
import {
  highlightArticleIdentityTrigger,
  highlightIdentityTrigger,
} from "./highlightIdentity";
import { syncResumeEligibility } from "./readingResume";
import { invalidateReflectionProof } from "./reflectionProtection";
import { membershipChanged } from "./shelfCounts";
import { syncTagAliases } from "./tagAliases";
import { syncTagVectors } from "./tagVectors";
import { syncTagVocabulary } from "./tagVocabulary";

export const metadataTriggers = new Triggers<DataModel>();
metadataTriggers.register("reflections", (ctx, change) =>
  invalidateReflectionProof(
    { ...ctx, db: ctx.innerDb },
    change.oldDoc,
    change.newDoc,
  ),
);
metadataTriggers.register("articles", (ctx, change) =>
  cancelFeedArticleProof(
    { ...ctx, db: ctx.innerDb },
    change.oldDoc,
    change.newDoc,
  ),
);
metadataTriggers.register("feeds", (ctx, change) =>
  syncFeedStatus({ ...ctx, db: ctx.innerDb }, change.oldDoc, change.newDoc),
);
metadataTriggers.register("tags", (ctx, change) =>
  syncTagVocabulary({ ...ctx, db: ctx.innerDb }, change.oldDoc, change.newDoc),
);
metadataTriggers.register("tags", (ctx, change) =>
  syncTagAliases({ ...ctx, db: ctx.innerDb }, change.oldDoc, change.newDoc),
);
metadataTriggers.register("tags", (ctx, change) =>
  syncTagVectors({ ...ctx, db: ctx.innerDb }, change.oldDoc, change.newDoc),
);
metadataTriggers.register("highlights", highlightIdentityTrigger);
metadataTriggers.register("articles", highlightArticleIdentityTrigger);
metadataTriggers.register("feeds", (ctx, change) =>
  change.oldDoc
    ? invalidateFeedPoll(
        { ...ctx, db: ctx.innerDb },
        change.oldDoc,
        change.newDoc,
      )
    : Promise.resolve(),
);
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
