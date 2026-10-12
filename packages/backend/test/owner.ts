import { convexTest } from "convex-test";
import { components } from "../convex/_generated/api";
import authSchema from "../convex/betterAuth/schema";
import schema from "../convex/schema";

export function readerTest(modules: Record<string, () => Promise<unknown>>) {
  const t = convexTest(schema, modules);
  t.registerComponent(
    "betterAuth",
    authSchema,
    import.meta.glob("../convex/betterAuth/**/*.ts"),
  );
  return t;
}

export async function ownerTest(
  modules: Record<string, () => Promise<unknown>>,
) {
  const t = readerTest(modules);
  const user = await t.mutation(components.betterAuth.adapter.create, {
    input: {
      model: "user",
      data: {
        name: "Owner fixture",
        email: "owner@example.com",
        emailVerified: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    },
  });
  const session = await t.mutation(components.betterAuth.adapter.create, {
    input: {
      model: "session",
      data: {
        userId: user._id,
        token: "fixture-session-token",
        expiresAt: Date.now() + 86400000,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    },
  });
  await t.run((ctx) =>
    ctx.db.insert("readerAccess", {
      key: "owner",
      authId: user._id,
      email: user.email,
    }),
  );
  process.env.CONVEX_SITE_URL = "https://fixture.convex.site";
  return {
    ...t.withIdentity({
      issuer: process.env.CONVEX_SITE_URL,
      subject: user._id,
      sessionId: session._id,
    }),
    withIdentity: t.withIdentity,
  };
}
