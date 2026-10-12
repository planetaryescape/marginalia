/// <reference types="vite/client" />
import { afterEach, describe, expect, it, vi } from "vitest";
import { addReader, secondReaderTest } from "../test/owner";
import { api, components, internal } from "./_generated/api";
import { sha256Hex } from "./lib/tokens";
import { WAITLIST_MESSAGE } from "./waitlist";

const modules = import.meta.glob("./**/*.ts");
const PASSWORD = "fixture-only-password-1234";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

type Fixture = Awaited<ReturnType<typeof secondReaderTest>>;

async function requestAccess(
  t: Fixture["t"],
  email = "new.reader@example.com",
) {
  await t.mutation(api.waitlist.request, { email, name: "New Reader" });
  const row = await t.run((ctx) =>
    ctx.db
      .query("accessRequests")
      .withIndex("by_email", (q) => q.eq("email", email.toLowerCase()))
      .unique(),
  );
  if (!row) throw new Error("Fixture request missing");
  return row._id;
}

async function invite(fixture: Fixture, email = "new.reader@example.com") {
  const requestId = await requestAccess(fixture.t, email);
  const approved = await fixture.owner.action(api.waitlist.approve, {
    requestId,
  });
  const token = new URL(approved.url).hash.replace(/^#invite=/, "");
  return { requestId, approved, token };
}

function signUp(
  t: Fixture["t"],
  body: { email: string; password?: string; name?: string },
  headers: Record<string, string> = {},
) {
  vi.stubEnv(
    "BETTER_AUTH_SECRET",
    "fixture-only-secret-at-least-32-characters",
  );
  return t.fetch("/api/auth/sign-up/email", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://reader.bhekani.com",
      ...headers,
    },
    body: JSON.stringify({ password: PASSWORD, name: "New Reader", ...body }),
  });
}

/** A signed-in client for an account created through sign-up. */
async function clientFor(t: Fixture["t"], email: string) {
  const user = await t.query(components.betterAuth.adapter.findOne, {
    model: "user",
    where: [{ field: "email", value: email }],
  });
  if (!user) throw new Error("Fixture user missing");
  const session = await t.query(components.betterAuth.adapter.findOne, {
    model: "session",
    where: [{ field: "userId", value: user._id }],
  });
  if (!session) throw new Error("Fixture session missing");
  return {
    userId: String(user._id),
    client: t.withIdentity({
      issuer: process.env.CONVEX_SITE_URL,
      subject: user._id,
      sessionId: session._id,
    }),
  };
}

describe("waitlist requests", () => {
  it("validates input and stores a normalized, pending request", async () => {
    const { t } = await secondReaderTest(modules);
    for (const args of [
      { email: "not-an-email", name: "A" },
      { email: "a@example.com", name: "   " },
      { email: "a@example.com", name: "x".repeat(101) },
      { email: "a@example.com", name: "A", note: "x".repeat(501) },
      { email: `${"x".repeat(250)}@example.com`, name: "A" },
    ])
      await expect(t.mutation(api.waitlist.request, args)).rejects.toThrow();
    expect(
      await t.mutation(api.waitlist.request, {
        email: "  Someone@Example.COM ",
        name: " Someone ",
        note: " I read a lot ",
      }),
    ).toEqual({ message: WAITLIST_MESSAGE });
    const rows = await t.run((ctx) => ctx.db.query("accessRequests").take(10));
    expect(rows).toMatchObject([
      {
        email: "someone@example.com",
        name: "Someone",
        note: "I read a lot",
        status: "pending",
      },
    ]);
  });

  it("is idempotent per email and answers the same whatever the email's state", async () => {
    const fixture = await secondReaderTest(modules);
    const { t } = fixture;
    const first = await t.mutation(api.waitlist.request, {
      email: "dup@example.com",
      name: "Dup",
    });
    const again = await t.mutation(api.waitlist.request, {
      email: "DUP@example.com",
      name: "Someone else",
      note: "Changed",
    });
    await invite(fixture, "approved@example.com");
    const approved = await t.mutation(api.waitlist.request, {
      email: "approved@example.com",
      name: "Approved",
    });
    expect(
      new Set([first, again, approved].map((r) => JSON.stringify(r))),
    ).toEqual(new Set([JSON.stringify({ message: WAITLIST_MESSAGE })]));
    const rows = await t.run((ctx) => ctx.db.query("accessRequests").take(10));
    expect(rows).toHaveLength(2);
    const dup = rows.find((r) => r.email === "dup@example.com");
    expect(dup?.name).toBe("Dup");
    expect(dup?.note).toBeUndefined();
    expect(rows.find((r) => r.email === "approved@example.com")?.status).toBe(
      "approved",
    );
  });

  it("caps new requests per hour without revealing the cap", async () => {
    vi.useFakeTimers();
    const { t } = await secondReaderTest(modules);
    for (let i = 0; i < 20; i++)
      await t.mutation(api.waitlist.request, {
        email: `person${i}@example.com`,
        name: "Person",
      });
    expect(
      await t.mutation(api.waitlist.request, {
        email: "late@example.com",
        name: "Late",
      }),
    ).toEqual({ message: WAITLIST_MESSAGE });
    const count = async () =>
      (await t.run((ctx) => ctx.db.query("accessRequests").take(50))).length;
    expect(await count()).toBe(20);
    vi.advanceTimersByTime(60 * 60_000);
    await t.mutation(api.waitlist.request, {
      email: "late@example.com",
      name: "Late",
    });
    expect(await count()).toBe(21);
  });
});

describe("owner review", () => {
  it("refuses every admin function to other readers and anonymous callers", async () => {
    const fixture = await secondReaderTest(modules);
    const { t, reader } = fixture;
    const requestId = await requestAccess(t);
    const readerRow = await t.run((ctx) => ctx.db.query("readers").first());
    if (!readerRow) throw new Error("Fixture reader missing");
    const inviteId = await t.run((ctx) =>
      ctx.db.insert("invites", {
        tokenHash: "a".repeat(64),
        email: "x@example.com",
        expiresAt: Date.now() + 60_000,
        createdAt: Date.now(),
      }),
    );
    for (const client of [t, reader]) {
      await expect(client.query(api.waitlist.listRequests, {})).rejects.toThrow(
        "Sign in",
      );
      await expect(client.query(api.waitlist.listInvites, {})).rejects.toThrow(
        "Sign in",
      );
      await expect(client.query(api.readers.list, {})).rejects.toThrow(
        "Sign in",
      );
      await expect(
        client.action(api.waitlist.approve, { requestId }),
      ).rejects.toThrow("Sign in");
      await expect(
        client.mutation(api.waitlist.decline, { requestId }),
      ).rejects.toThrow("Sign in");
      await expect(
        client.mutation(api.waitlist.revokeInvite, { inviteId }),
      ).rejects.toThrow("Sign in");
      await expect(
        client.mutation(api.readers.setStatus, {
          readerId: readerRow._id,
          status: "disabled",
        }),
      ).rejects.toThrow("Sign in");
    }
    const request = await t.run((ctx) => ctx.db.get(requestId));
    expect(request?.status).toBe("pending");
    expect(
      (await t.run((ctx) => ctx.db.query("invites").take(10))).length,
    ).toBe(1);
  });

  it("returns the invite link once and stores only the token's hash", async () => {
    vi.stubEnv("SITE_URL", "https://reader.example.org");
    const fixture = await secondReaderTest(modules);
    const { owner, t } = fixture;
    const { requestId, approved, token } = await invite(fixture);
    expect(approved.url).toBe(`https://reader.example.org/#invite=${token}`);
    expect(approved.email).toBe("new.reader@example.com");
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const rows = await t.run((ctx) => ctx.db.query("invites").take(10));
    expect(rows).toHaveLength(1);
    expect(rows[0].tokenHash).toBe(await sha256Hex(token));
    expect(JSON.stringify(rows)).not.toContain(token);
    expect(rows[0].expiresAt - rows[0].createdAt).toBe(7 * 24 * 60 * 60_000);
    const listed = await owner.query(api.waitlist.listInvites, {});
    expect(listed).toHaveLength(1);
    expect(JSON.stringify(listed)).not.toContain(token);
    expect(JSON.stringify(listed)).not.toContain(rows[0].tokenHash);
    await expect(
      owner.action(api.waitlist.approve, { requestId }),
    ).rejects.toThrow("already has an invite");
    const requests = await owner.query(api.waitlist.listRequests, {});
    expect(requests.pending).toEqual([]);
    expect(requests.recent).toMatchObject([{ status: "approved" }]);
  });

  it("declines requests and revokes unused invites back to pending", async () => {
    const fixture = await secondReaderTest(modules);
    const { owner, t } = fixture;
    const declined = await requestAccess(t, "no@example.com");
    await owner.mutation(api.waitlist.decline, { requestId: declined });
    expect((await t.run((ctx) => ctx.db.get(declined)))?.status).toBe(
      "declined",
    );
    const { requestId, token } = await invite(fixture);
    const [row] = await owner.query(api.waitlist.listInvites, {});
    await owner.mutation(api.waitlist.revokeInvite, { inviteId: row._id });
    expect(await owner.query(api.waitlist.listInvites, {})).toEqual([]);
    expect((await t.run((ctx) => ctx.db.get(requestId)))?.status).toBe(
      "pending",
    );
    const response = await signUp(
      t,
      { email: "new.reader@example.com" },
      { "x-reader-invite": token },
    );
    expect(response.status).toBe(403);
  });
});

describe("invite sign-up", () => {
  it("creates an isolated reader only for the invited email, and only once", async () => {
    const fixture = await secondReaderTest(modules);
    const { t, owner } = fixture;
    const { token } = await invite(fixture);
    const claimed = await signUp(
      t,
      { email: "New.Reader@example.com" },
      { "x-reader-invite": token },
    );
    expect(claimed.status).toBe(200);
    const { userId, client } = await clientFor(t, "new.reader@example.com");
    const reader = await t.run((ctx) =>
      ctx.db
        .query("readers")
        .withIndex("by_authId", (q) => q.eq("authId", userId))
        .unique(),
    );
    expect(reader).toMatchObject({
      libraryId: userId,
      status: "active",
      email: "new.reader@example.com",
    });
    expect(reader?.libraryId).not.toBe("default_user");
    const [used] = await t.run((ctx) => ctx.db.query("invites").take(5));
    expect(used).toMatchObject({ consumedBy: userId });
    expect(used.consumedAt).toBeTypeOf("number");
    expect(await client.query(api.auth.currentReader, {})).toEqual({
      isOwner: false,
      email: "new.reader@example.com",
      name: "New Reader",
    });

    // Their library is their own
    await client.mutation(api.feeds.add, {
      url: "https://new.example/feed",
      title: "New reader's feed",
    });
    await owner.mutation(api.feeds.add, {
      url: "https://owner.example/feed",
      title: "Owner feed",
    });
    expect(
      (await client.query(api.feeds.list, {})).map((f) => f.title),
    ).toEqual(["New reader's feed"]);
    expect((await owner.query(api.feeds.list, {})).map((f) => f.title)).toEqual(
      ["Owner feed"],
    );
    expect(await owner.query(api.readers.list, {})).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          email: "new.reader@example.com",
          status: "active",
        }),
      ]),
    );

    // The same link can't create a second account
    const reused = await signUp(
      t,
      { email: "new.reader@example.com", name: "Again" },
      { "x-reader-invite": token },
    );
    expect(reused.status).toBe(403);
    const other = await signUp(
      t,
      { email: "someone.else@example.com" },
      { "x-reader-invite": token },
    );
    expect(other.status).toBe(403);
    expect(
      (await t.run((ctx) => ctx.db.query("readers").take(10))).length,
    ).toBe(2);
  });

  it("refuses missing, wrong-email, expired and forged tokens", async () => {
    const fixture = await secondReaderTest(modules);
    const { t } = fixture;
    const { token } = await invite(fixture);
    expect((await signUp(t, { email: "new.reader@example.com" })).status).toBe(
      403,
    );
    expect(
      (
        await signUp(
          t,
          { email: "wrong@example.com" },
          { "x-reader-invite": token },
        )
      ).status,
    ).toBe(403);
    // An invite token isn't an owner setup token
    expect(
      (
        await signUp(
          t,
          { email: "new.reader@example.com" },
          { "x-reader-setup": token },
        )
      ).status,
    ).toBe(403);
    await expect(
      t.mutation(internal.waitlist.reserveInvite, {
        hash: await sha256Hex(`${token}x`),
        email: "new.reader@example.com",
      }),
    ).rejects.toThrow("invalid or has expired");
    await t.run(async (ctx) => {
      const row = await ctx.db.query("invites").first();
      if (row) await ctx.db.patch(row._id, { expiresAt: Date.now() - 1 });
    });
    await expect(
      t.mutation(internal.waitlist.reserveInvite, {
        hash: await sha256Hex(token),
        email: "new.reader@example.com",
      }),
    ).rejects.toThrow("invalid or has expired");
    const users = await t.query(components.betterAuth.adapter.findMany, {
      model: "user",
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(users.page.map((u: { email: string }) => u.email)).not.toContain(
      "new.reader@example.com",
    );
    expect(
      (await t.run((ctx) => ctx.db.query("readers").take(10))).length,
    ).toBe(1);
  });

  it("never creates an account from an unreserved invite or for the owner's library", async () => {
    const fixture = await secondReaderTest(modules);
    const { t } = fixture;
    const { token } = await invite(fixture);
    await expect(
      t.mutation(internal.auth.onCreate, {
        model: "user",
        doc: { _id: "unreserved", email: "new.reader@example.com" },
      }),
    ).rejects.toThrow("Public registration is disabled");
    await t.mutation(internal.waitlist.reserveInvite, {
      hash: await sha256Hex(token),
      email: "new.reader@example.com",
    });
    await expect(
      t.mutation(internal.auth.onCreate, {
        model: "user",
        doc: { _id: "default_user", email: "new.reader@example.com" },
      }),
    ).rejects.toThrow("Public registration is disabled");
    const readers = await t.run((ctx) => ctx.db.query("readers").take(10));
    expect(readers.map((r) => r.libraryId)).not.toContain("default_user");
    expect(readers).toHaveLength(1);
  });
});

describe("reader status", () => {
  it("disabling cuts access and sessions at once; enabling restores it", async () => {
    const fixture = await secondReaderTest(modules);
    const { t, owner, reader, readerLibraryId } = fixture;
    expect(await reader.query(api.auth.currentReader, {})).toMatchObject({
      isOwner: false,
      email: "reader@example.com",
    });
    const row = await t.run((ctx) =>
      ctx.db
        .query("readers")
        .withIndex("by_authId", (q) => q.eq("authId", readerLibraryId))
        .unique(),
    );
    if (!row) throw new Error("Fixture reader missing");
    await owner.mutation(api.readers.setStatus, {
      readerId: row._id,
      status: "disabled",
    });
    expect(await reader.query(api.auth.currentReader, {})).toBeNull();
    await expect(reader.query(api.home.overview, {})).rejects.toThrow(
      "Sign in",
    );
    expect(
      await t.query(components.betterAuth.adapter.findOne, {
        model: "session",
        where: [{ field: "userId", value: readerLibraryId }],
      }),
    ).toBeNull();

    await owner.mutation(api.readers.setStatus, {
      readerId: row._id,
      status: "active",
    });
    const session = await t.mutation(components.betterAuth.adapter.create, {
      input: {
        model: "session",
        data: {
          userId: readerLibraryId,
          token: "fixture-session-token-again",
          expiresAt: Date.now() + 86400000,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      },
    });
    const again = t.withIdentity({
      issuer: process.env.CONVEX_SITE_URL,
      subject: readerLibraryId,
      sessionId: session._id,
    });
    expect(await again.query(api.auth.currentReader, {})).toMatchObject({
      isOwner: false,
    });
    await expect(again.query(api.home.overview, {})).resolves.toBeDefined();
  });

  it("returns null for unknown users and the owner flag only for the owner", async () => {
    const fixture = await secondReaderTest(modules);
    const stranger = await addReader(fixture.t, {
      email: "stranger@example.com",
      register: false,
    });
    expect(await stranger.client.query(api.auth.currentReader, {})).toBeNull();
    expect(await fixture.t.query(api.auth.currentReader, {})).toBeNull();
    expect(await fixture.owner.query(api.auth.currentReader, {})).toEqual({
      isOwner: true,
      email: "owner@example.com",
      name: "Owner fixture",
    });
  });
});
