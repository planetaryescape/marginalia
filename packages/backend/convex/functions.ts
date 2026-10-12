import {
  customAction,
  customCtx,
  customMutation,
  customQuery,
} from "convex-helpers/server/customFunctions";
import { internal } from "./_generated/api";
import {
  action as rawAction,
  mutation as rawMutation,
  query as rawQuery,
} from "./_generated/server";
import { requireOwner, requireReader } from "./access";

export * from "./_generated/server";

// Every public function runs for one signed-in reader. `ctx.readerId` is that
// reader's library ID; it never comes from client arguments.
export const query = customQuery(
  rawQuery,
  customCtx(async (ctx) => ({ readerId: await requireReader(ctx) })),
);
export const mutation = customMutation(
  rawMutation,
  customCtx(async (ctx) => ({ readerId: await requireReader(ctx) })),
);
export const action = customAction(
  rawAction,
  customCtx(async (ctx) => {
    const readerId: string = await ctx.runQuery(
      internal.access.assertReader,
      {},
    );
    return { readerId };
  }),
);

// Administration that only the owner's live session may run
export const ownerQuery = customQuery(
  rawQuery,
  customCtx(async (ctx) => {
    await requireOwner(ctx);
    return {};
  }),
);
export const ownerMutation = customMutation(
  rawMutation,
  customCtx(async (ctx) => {
    await requireOwner(ctx);
    return {};
  }),
);
export const ownerAction = customAction(
  rawAction,
  customCtx(async (ctx) => {
    await ctx.runQuery(internal.access.assertOwner, {});
    return {};
  }),
);
