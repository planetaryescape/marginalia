import { passkey } from "@better-auth/passkey";
import {
  type AuthFunctions,
  createClient,
  type GenericCtx,
} from "@convex-dev/better-auth";
import { convex } from "@convex-dev/better-auth/plugins";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { type BetterAuthOptions, betterAuth } from "better-auth/minimal";
import { twoFactor } from "better-auth/plugins";
import { components, internal } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import { query } from "./_generated/server";
import { getOwner } from "./access";
import authConfig from "./auth.config";
import authSchema from "./betterAuth/schema";

const authFunctions: AuthFunctions = internal.auth;
export const authComponent = createClient<DataModel, typeof authSchema>(
  components.betterAuth,
  {
    local: { schema: authSchema },
    authFunctions,
    triggers: {
      user: {
        onCreate: async (ctx, user) => {
          const owner = await ctx.db
            .query("readerAccess")
            .withIndex("by_key", (q) => q.eq("key", "owner"))
            .unique();
          if (
            !owner ||
            owner.authId ||
            owner.email !== user.email.toLowerCase() ||
            !owner.setupHash ||
            (owner.setupExpiresAt ?? 0) <= Date.now()
          )
            throw new Error("Public registration is disabled");
          await ctx.db.patch(owner._id, {
            authId: user._id,
            setupHash: undefined,
            setupExpiresAt: undefined,
          });
        },
        onUpdate: async (_ctx, next, previous) => {
          if (next.email !== previous.email)
            throw new Error(
              "Owner email changes require administrator recovery",
            );
        },
        onDelete: async () => {
          throw new Error("Owner deletion requires administrator recovery");
        },
      },
    },
  },
);
export const { onCreate, onUpdate, onDelete } = authComponent.triggersApi();

export const createAuthOptions = (ctx: GenericCtx<DataModel>) =>
  ({
    appName: "Marginalia",
    baseURL: {
      allowedHosts: [
        new URL(process.env.SITE_URL ?? "https://reader.bhekani.com").host,
        "localhost:3107",
        "localhost:3108",
      ],
      fallback: process.env.SITE_URL ?? "https://reader.bhekani.com",
    },
    advanced: { trustedProxyHeaders: true },
    secret: process.env.BETTER_AUTH_SECRET,
    trustedOrigins: [
      process.env.SITE_URL ?? "https://reader.bhekani.com",
      "http://localhost:3107",
      "http://localhost:3108",
    ],
    database: authComponent.adapter(ctx),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 12,
      requireEmailVerification: false,
    },
    session: { expiresIn: 60 * 60 * 24 * 30, updateAge: 60 * 60 * 24 },
    rateLimit: {
      enabled: true,
      storage: "database",
      window: 60,
      max: 100,
      customRules: {
        "/sign-in/email": { window: 60, max: 8 },
        "/sign-up/email": { window: 60, max: 3 },
      },
    },
    hooks: {
      after: createAuthMiddleware(async (request) => {
        if (request.path !== "/passkey/generate-authenticate-options") return;
        const options = request.context.returned;
        if (
          options &&
          typeof options === "object" &&
          "challenge" in options &&
          "rpId" in options
        )
          return request.json({ ...options, userVerification: "required" });
      }),
      before: createAuthMiddleware(async (request) => {
        if (request.path === "/sign-in/email") {
          if (
            !("runMutation" in ctx) ||
            !(await ctx.runMutation(internal.access.allowPasswordAttempt, {}))
          )
            throw new APIError("TOO_MANY_REQUESTS", {
              message:
                "Too many password attempts. Wait a minute or use your passkey.",
            });
        }
        if (request.path !== "/sign-up/email") return;
        const token = request.headers?.get("x-reader-setup");
        const email =
          typeof request.body?.email === "string"
            ? request.body.email.trim().toLowerCase()
            : "";
        if (!token || !email)
          throw new APIError("FORBIDDEN", {
            message: "This is a private reader. Public signup is disabled.",
          });
        const digest = await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(token),
        );
        const hash = [...new Uint8Array(digest)]
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");
        if (!("runMutation" in ctx))
          throw new APIError("FORBIDDEN", {
            message: "Signup requires a writable context",
          });
        try {
          await ctx.runMutation(internal.access.reserveSetup, { hash, email });
        } catch {
          throw new APIError("FORBIDDEN", {
            message: "Owner setup is closed or this link has expired.",
          });
        }
        request.body.email = email;
      }),
    },
    plugins: [
      passkey({
        rpName: "Marginalia",
        origin: [
          process.env.SITE_URL ?? "https://reader.bhekani.com",
          "http://localhost:3107",
          "http://localhost:3108",
        ],
        authenticatorSelection: { userVerification: "required" },
        registration: {
          afterVerification: async ({ verification }) => {
            if (!verification.registrationInfo?.userVerified)
              throw new APIError("UNAUTHORIZED", {
                message: "Verify on your device to register this passkey.",
              });
          },
        },
        authentication: {
          afterVerification: async ({ verification }) => {
            if (!verification.authenticationInfo.userVerified)
              throw new APIError("UNAUTHORIZED", {
                message: "Verify on your device to sign in.",
              });
          },
        },
      }),
      twoFactor({ issuer: "Marginalia" }),
      convex({ authConfig }),
    ],
  }) satisfies BetterAuthOptions;
export const createAuth = (ctx: GenericCtx<DataModel>) =>
  betterAuth(createAuthOptions(ctx));

export const currentOwner = query({
  args: {},
  handler: async (ctx) => {
    const owner = await getOwner(ctx);
    return owner ? { email: owner.email } : null;
  },
});
