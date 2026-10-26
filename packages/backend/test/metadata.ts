import type { MutationCtx } from "../convex/_generated/server";
import { metadataTriggers } from "../convex/lib/metadataTriggers";

/** Raw t.run fixture writes otherwise bypass production registration. */
export function metadataContext(ctx: MutationCtx): MutationCtx {
  return metadataTriggers.wrapDB(ctx);
}
