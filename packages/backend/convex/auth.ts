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
import { v } from "convex/values";
import { components, internal } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
// Raw, unauthenticated query: used ONLY for `currentReader`, which tells the
// web app whether this session may enter and returns null otherwise.
import { query as publicQuery } from "./_generated/server";
import { getReaderSession } from "./access";
import authConfig from "./auth.config";
import authSchema from "./betterAuth/schema";
import { DEFAULT_USER_ID } from "./lib/constants";
import { sha256Hex } from "./lib/tokens";
import { claimInvite } from "./waitlist";

const SIGNUP_CLOSED = "This is a private reader. Public signup is disabled.";
const INVITE_INVALID = "This invite link is invalid or has expired.";

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
            owner &&
            !owner.authId &&
            owner.email === user.email.toLowerCase() &&
            owner.setupHash &&
            (owner.setupExpiresAt ?? 0) > Date.now()
          ) {
            await ctx.db.patch(owner._id, {
              authId: user._id,
              setupHash: undefined,
              setupExpiresAt: undefined,
            });
            return;
          }
          // Otherwise only a reserved, matching invite may create an account
          if (!(await claimInvite(ctx, user)))
            throw new Error("Public registration is disabled");
        },
        onUpdate: async (_ctx, next, previous) => {
          if (next.email !== previous.email)
            throw new Error(
              "Owner email changes require administrator recovery",
            );
        },
        // Readers delete their accounts through account.deleteMine, which
        // purges auth records directly; Better Auth's own route stays closed
        onDelete: async () => {
          throw new Error("Account deletion runs from the account page");
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
          const email =
            typeof request.body?.email === "string" ? request.body.email : "";
          if (
            !("runMutation" in ctx) ||
            !(await ctx.runMutation(internal.access.allowPasswordAttempt, {
              email,
            }))
          )
            throw new APIError("TOO_MANY_REQUESTS", {
              message:
                "Too many password attempts. Wait a minute or use your passkey.",
            });
        }
        if (request.path !== "/sign-up/email") return;
        const invite = request.headers?.get("x-reader-invite");
        const setup = request.headers?.get("x-reader-setup");
        const token = invite || setup;
        const email =
          typeof request.body?.email === "string"
            ? request.body.email.trim().toLowerCase()
            : "";
        if (!token || !email || token.length > 200)
          throw new APIError("FORBIDDEN", { message: SIGNUP_CLOSED });
        const hash = await sha256Hex(token);
        if (!("runMutation" in ctx))
          throw new APIError("FORBIDDEN", {
            message: "Signup requires a writable context",
          });
        try {
          if (invite)
            await ctx.runMutation(internal.waitlist.reserveInvite, {
              hash,
              email,
            });
          else
            await ctx.runMutation(internal.access.reserveSetup, {
              hash,
              email,
            });
        } catch {
          throw new APIError("FORBIDDEN", {
            message: invite
              ? INVITE_INVALID
              : "Owner setup is closed or this link has expired.",
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

/** Who is signed in, when this session may use the reader; otherwise null. */
export const currentReader = publicQuery({
  args: {},
  returns: v.union(
    v.null(),
    v.object({ isOwner: v.boolean(), email: v.string(), name: v.string() }),
  ),
  handler: async (ctx) => {
    const session = await getReaderSession(ctx);
    if (!session) return null;
    const user = await ctx.runQuery(components.betterAuth.adapter.findOne, {
      model: "user",
      where: [{ field: "_id", value: session.authId }],
    });
    return {
      isOwner: session.libraryId === DEFAULT_USER_ID,
      email: String(user?.email ?? ""),
      name: String(user?.name ?? ""),
    };
  },
});
