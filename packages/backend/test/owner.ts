import { convexTest } from "convex-test";
import { vi } from "vitest";
import { components } from "../convex/_generated/api";
import authSchema from "../convex/betterAuth/schema";
import { encryptProviderKey } from "../convex/lib/providerKeys";
import type { Provider } from "../convex/lib/providers";
import schema from "../convex/schema";

type ReaderTest = ReturnType<typeof readerTest>;

export function readerTest(modules: Record<string, () => Promise<unknown>>) {
  const t = convexTest(schema, modules);
  t.registerComponent(
    "betterAuth",
    authSchema,
    import.meta.glob("../convex/betterAuth/**/*.ts"),
  );
  return t;
}

/** A Better Auth user with a live session, as the deployment would issue. */
async function signedInUser(t: ReaderTest, name: string, email: string) {
  const user = await t.mutation(components.betterAuth.adapter.create, {
    input: {
      model: "user",
      data: {
        name,
        email,
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
        token: `fixture-session-token-${email}`,
        expiresAt: Date.now() + 86400000,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    },
  });
  process.env.CONVEX_SITE_URL = "https://fixture.convex.site";
  return {
    user,
    identity: {
      issuer: process.env.CONVEX_SITE_URL,
      subject: user._id,
      sessionId: session._id,
    },
  };
}

async function addOwner(t: ReaderTest) {
  const { user, identity } = await signedInUser(
    t,
    "Owner fixture",
    "owner@example.com",
  );
  await t.run((ctx) =>
    ctx.db.insert("readerAccess", {
      key: "owner",
      authId: user._id,
      email: user.email,
    }),
  );
  return identity;
}

export async function ownerTest(
  modules: Record<string, () => Promise<unknown>>,
) {
  const t = readerTest(modules);
  const identity = await addOwner(t);
  return {
    ...t.withIdentity(identity),
    withIdentity: t.withIdentity,
  };
}

/**
 * Signs in another reader with their own library, named after their auth ID.
 * Pass `status: "disabled"` or `register: false` to test denied readers.
 */
export async function addReader(
  t: ReaderTest,
  {
    email,
    status = "active",
    register = true,
  }: {
    email: string;
    status?: "active" | "disabled";
    register?: boolean;
  },
) {
  const { user, identity } = await signedInUser(t, email, email);
  if (register)
    await t.run((ctx) =>
      ctx.db.insert("readers", {
        authId: user._id,
        libraryId: user._id,
        status,
        createdAt: Date.now(),
      }),
    );
  return { client: t.withIdentity(identity), libraryId: user._id };
}

/** The owner plus a second, active reader sharing one deployment. */
export async function secondReaderTest(
  modules: Record<string, () => Promise<unknown>>,
) {
  const t = readerTest(modules);
  const owner = t.withIdentity(await addOwner(t));
  const second = await addReader(t, { email: "reader@example.com" });
  return {
    t,
    owner,
    reader: second.client,
    readerLibraryId: second.libraryId,
  };
}

/** A fixed, test-only server key: 32 bytes, base64. */
export const TEST_ENCRYPTION_KEY = btoa(
  String.fromCharCode(...Array.from({ length: 32 }, (_, i) => i + 1)),
);

/** Stores a sealed provider key for a library, as saving it would. */
export async function saveTestCredential(
  t: Pick<ReaderTest, "run">,
  userId: string,
  provider: Provider,
  apiKey: string,
) {
  vi.stubEnv("PROVIDER_KEYS_ENCRYPTION_KEY", TEST_ENCRYPTION_KEY);
  const sealed = await encryptProviderKey(apiKey, userId, provider);
  const now = Date.now();
  return t.run((ctx) =>
    ctx.db.insert("providerCredentials", {
      userId,
      provider,
      ...sealed,
      last4: apiKey.slice(-4),
      createdAt: now,
      updatedAt: now,
      validatedAt: now,
    }),
  );
}
