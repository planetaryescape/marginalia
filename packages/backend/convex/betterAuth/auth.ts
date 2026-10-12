// Tooling-only schema configuration; no deployment secrets or live database.

import { passkey } from "@better-auth/passkey";
import type { GenericCtx } from "@convex-dev/better-auth";
import { convexAdapter } from "@convex-dev/better-auth";
import { convex } from "@convex-dev/better-auth/plugins";
import { betterAuth } from "better-auth/minimal";
import { twoFactor } from "better-auth/plugins";
import type { DataModel } from "../_generated/dataModel";
import authConfig from "../auth.config";

export const auth = betterAuth({
  // The CLI only inspects the adapter/schema; it never executes a DB operation.
  database: convexAdapter<DataModel, GenericCtx<DataModel>>(
    {} as GenericCtx<DataModel>,
    {} as Parameters<typeof convexAdapter>[1],
  ),
  emailAndPassword: { enabled: true },
  rateLimit: { enabled: true, storage: "database" },
  plugins: [passkey(), twoFactor(), convex({ authConfig })],
});
