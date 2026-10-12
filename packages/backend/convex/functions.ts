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
import { requireOwner } from "./access";

export * from "./_generated/server";
export const query = customQuery(
  rawQuery,
  customCtx(async (ctx) => {
    await requireOwner(ctx);
    return {};
  }),
);
export const mutation = customMutation(
  rawMutation,
  customCtx(async (ctx) => {
    await requireOwner(ctx);
    return {};
  }),
);
export const action = customAction(
  rawAction,
  customCtx(async (ctx) => {
    await ctx.runQuery(internal.access.assertOwner, {});
    return {};
  }),
);
