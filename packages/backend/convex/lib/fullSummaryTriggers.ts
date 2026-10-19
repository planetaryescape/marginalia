import { deleteFullSummaryState } from "./fullSummaries";
import { metadataTriggers } from "./metadataTriggers";

metadataTriggers.register("articles", async (ctx, change) => {
  if (change.oldDoc && !change.newDoc)
    await deleteFullSummaryState(
      { ...ctx, db: ctx.innerDb },
      change.oldDoc._id,
    );
});
