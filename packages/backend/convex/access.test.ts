/// <reference types="vite/client" />
import { afterEach, describe, expect, it, vi } from "vitest";
import { ownerTest, readerTest } from "../test/owner";
import { api, components, internal } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("private reader access", () => {
  it("limits password attempts per email, with a global ceiling, independently of forwarded IP headers", async () => {
    const t = readerTest(modules);
    const attempt = (email: string) =>
      t.mutation(internal.access.allowPasswordAttempt, { email });
    vi.useFakeTimers();
    try {
      for (let i = 0; i < 8; i++)
        expect(await attempt("owner@example.com")).toBe(true);
      expect(await attempt("owner@example.com")).toBe(false);
      // Case and spacing don't open a fresh budget for the same account
      expect(await attempt(" OWNER@example.com ")).toBe(false);
      // Another account keeps its own budget
      expect(await attempt("reader@example.com")).toBe(true);
      vi.advanceTimersByTime(60000);
      expect(await attempt("owner@example.com")).toBe(true);

      // Spraying many emails hits the global ceiling
      vi.advanceTimersByTime(60000);
      for (let i = 0; i < 60; i++)
        expect(await attempt(`spray-${i}@example.com`)).toBe(true);
      expect(await attempt("fresh@example.com")).toBe(false);
      expect(await attempt("owner@example.com")).toBe(false);
      vi.advanceTimersByTime(60000);
      expect(await attempt("owner@example.com")).toBe(true);
      // A refused attempt doesn't spend another account's budget
      expect(await attempt("spray-0@example.com")).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
  it("claims once, signs in with a password, and revokes the session on sign-out", async () => {
    const t = readerTest(modules);
    vi.stubEnv(
      "BETTER_AUTH_SECRET",
      "fixture-only-secret-at-least-32-characters",
    );
    const setup = "fixture-only-owner-setup-token";
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(setup),
    );
    const hash = [...new Uint8Array(digest)]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    await t.mutation(internal.access.prepareSetup, {
      hash,
      expiresAt: Date.now() + 60000,
    });
    const call = (
      path: string,
      body: Record<string, string>,
      extra: Record<string, string> = {},
    ) =>
      t.fetch(`/api/auth/${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://reader.bhekani.com",
          ...extra,
        },
        body: JSON.stringify(body),
      });
    const credentials = {
      email: "OWNER@example.com",
      password: "fixture-only-password-1234",
      name: "Owner",
    };
    const claimed = await call("sign-up/email", credentials, {
      "x-reader-setup": setup,
    });
    expect(claimed.status).toBe(200);
    const owner = await t.run((ctx) => ctx.db.query("readerAccess").unique());
    expect(owner).toMatchObject({ email: "owner@example.com" });
    expect(owner?.authId).toBeTruthy();
    expect(
      (
        await call(
          "sign-up/email",
          { ...credentials, email: "stranger@example.com" },
          { "x-reader-setup": setup },
        )
      ).status,
    ).not.toBe(200);
    const signedIn = await call("sign-in/email", {
      email: "owner@example.com",
      password: credentials.password,
    });
    expect(signedIn.status).toBe(200);
    const cookies = signedIn.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");
    expect(cookies).toContain("session_token=");
    const enrollment = await call(
      "two-factor/enable",
      { password: credentials.password },
      { Cookie: cookies },
    );
    expect(enrollment.status).toBe(200);
    const factor = await enrollment.json();
    expect(factor.backupCodes).toHaveLength(10);
    const secret = new URL(factor.totpURI).searchParams.get("secret");
    if (!secret) throw new Error("Fixture missing authenticator secret");
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    const bits = [...secret.toUpperCase()]
      .map((letter) => alphabet.indexOf(letter).toString(2).padStart(5, "0"))
      .join("");
    const bytes = new Uint8Array(Math.floor(bits.length / 8));
    for (let i = 0; i < bytes.length; i++)
      bytes[i] = Number.parseInt(bits.slice(i * 8, i * 8 + 8), 2);
    const key = await crypto.subtle.importKey(
      "raw",
      bytes,
      { name: "HMAC", hash: "SHA-1" },
      false,
      ["sign"],
    );
    const counter = new ArrayBuffer(8);
    new DataView(counter).setBigUint64(
      0,
      BigInt(Math.floor(Date.now() / 30000)),
    );
    const signature = new Uint8Array(
      await crypto.subtle.sign("HMAC", key, counter),
    );
    const offset = signature[signature.length - 1] & 15;
    const number =
      new DataView(signature.buffer).getUint32(offset) & 0x7fffffff;
    const code = String(number % 1000000).padStart(6, "0");
    const verified = await call(
      "two-factor/verify-totp",
      { code },
      { Cookie: cookies },
    );
    expect(verified.status).toBe(200);
    const factorCookies = verified.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");
    const signedOut = await call(
      "sign-out",
      {},
      { Cookie: factorCookies || cookies },
    );
    expect(signedOut.status).toBe(200);
    const token = (await signedIn.json()).token;
    expect(
      await t.query(components.betterAuth.adapter.findOne, {
        model: "session",
        where: [{ field: "token", value: token }],
      }),
    ).toBeNull();
    const challenge = await call("sign-in/email", {
      email: "owner@example.com",
      password: credentials.password,
    });
    expect(await challenge.json()).toMatchObject({ twoFactorRedirect: true });
    const challengeCookies = challenge.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");
    const noToken = await t.fetch("/api/auth/convex/token", {
      headers: { Cookie: challengeCookies },
    });
    expect(noToken.status).toBe(401);
    const recovered = await call(
      "two-factor/verify-backup-code",
      { code: factor.backupCodes[0] },
      { Cookie: challengeCookies },
    );
    expect(recovered.status).toBe(200);
    const consumed = await call(
      "two-factor/verify-backup-code",
      { code: factor.backupCodes[0] },
      { Cookie: challengeCookies },
    );
    expect(consumed.status).not.toBe(200);
  });
  it("uses separate, origin-bound passkeys for the reader domain and localhost", async () => {
    const t = readerTest(modules);
    vi.stubEnv(
      "BETTER_AUTH_SECRET",
      "fixture-only-secret-at-least-32-characters",
    );
    for (const [host, protocol, rpID] of [
      ["reader.bhekani.com", "https", "reader.bhekani.com"],
      ["localhost:3108", "http", "localhost"],
    ]) {
      const response = await t.fetch(
        "/api/auth/passkey/generate-authenticate-options",
        {
          headers: {
            Origin: `${protocol}://${host}`,
            "x-better-auth-forwarded-host": host,
            "x-better-auth-forwarded-proto": protocol,
          },
        },
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        rpId: rpID,
        userVerification: "required",
      });
    }
  });
  it("denies personal queries, writes and paid actions before any work", async () => {
    const t = readerTest(modules);
    await expect(t.query(api.home.overview, {})).rejects.toThrow("Sign in");
    await expect(t.query(api.stats.getDashboard, {})).rejects.toThrow(
      "Sign in",
    );
    await expect(
      t.mutation(api.feeds.add, {
        url: "https://example.com/feed",
        title: "Fixture",
      }),
    ).rejects.toThrow("Sign in");
    await expect(
      t.action(api.actions.addArticleByUrl.add, {
        url: "https://example.com/article",
      }),
    ).rejects.toThrow("Sign in");
    const provider = vi.fn();
    vi.stubGlobal("fetch", provider);
    for (const path of [
      "companion",
      "library",
      "library/search",
      "engagement",
      "feeds/poll",
    ]) {
      const response = await t.fetch(`/api/${path}`, {
        method: "POST",
        body: "{}",
      });
      expect(response.status).toBe(401);
    }
    expect(provider).not.toHaveBeenCalled();
    expect(await t.run((ctx) => ctx.db.query("feeds").take(1))).toEqual([]);
  });

  it("accepts only the owner's live session from this deployment", async () => {
    const t = await ownerTest(modules);
    expect(await t.query(api.auth.currentReader, {})).toEqual({
      isOwner: true,
      email: "owner@example.com",
      name: "Owner fixture",
    });
    const identity = await t.run((ctx) => ctx.auth.getUserIdentity());
    if (!identity) throw new Error("Fixture missing identity");
    await expect(
      t
        .withIdentity({ ...identity, issuer: "https://elsewhere.example" })
        .query(api.home.overview, {}),
    ).rejects.toThrow("Sign in");
    await expect(
      t
        .withIdentity({ ...identity, subject: "stranger" })
        .query(api.home.overview, {}),
    ).rejects.toThrow("Sign in");
    await t.mutation(components.betterAuth.adapter.deleteOne, {
      input: {
        model: "session",
        where: [{ field: "_id", value: String(identity.sessionId) }],
      },
    });
    await expect(t.query(api.home.overview, {})).rejects.toThrow("Sign in");
    expect(await t.query(api.auth.currentReader, {})).toBeNull();
  });

  it("rejects expired sessions even when their JWT identity remains", async () => {
    const t = await ownerTest(modules);
    const identity = await t.run((ctx) => ctx.auth.getUserIdentity());
    if (!identity) throw new Error("Fixture missing identity");
    await t.mutation(components.betterAuth.adapter.updateOne, {
      input: {
        model: "session",
        where: [{ field: "_id", value: String(identity.sessionId) }],
        update: { expiresAt: Date.now() - 1 },
      },
    });
    await expect(t.query(api.home.overview, {})).rejects.toThrow("Sign in");
  });

  it("keeps public signup closed and setup restricted to a valid, unused token", async () => {
    const t = readerTest(modules);
    const response = await t.fetch("/api/auth/sign-up/email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://reader.bhekani.com",
      },
      body: JSON.stringify({
        email: "stranger@example.com",
        password: "fixture-password-only",
        name: "Stranger",
      }),
    });
    expect(response.status).toBe(403);
    const hash = "a".repeat(64);
    await t.mutation(internal.access.prepareSetup, {
      hash,
      expiresAt: Date.now() + 10000,
    });
    await expect(
      t.mutation(internal.access.reserveSetup, {
        hash: "b".repeat(64),
        email: "stranger@example.com",
      }),
    ).rejects.toThrow("setup");
    await t.mutation(internal.access.reserveSetup, {
      hash,
      email: "owner@example.com",
    });
    await expect(
      t.mutation(internal.access.reserveSetup, {
        hash,
        email: "stranger@example.com",
      }),
    ).rejects.toThrow("setup");
    await t.mutation(internal.auth.onCreate, {
      model: "user",
      doc: { _id: "claimed-owner", email: "owner@example.com" },
    });
    await expect(
      t.mutation(internal.access.reserveSetup, {
        hash,
        email: "owner@example.com",
      }),
    ).rejects.toThrow("setup");
    await expect(
      t.mutation(internal.access.prepareSetup, {
        hash,
        expiresAt: Date.now() + 10000,
      }),
    ).rejects.toThrow("already has an owner");
    const owner = await t.run((ctx) => ctx.db.query("readerAccess").unique());
    expect(owner?.setupHash).toBeUndefined();
    expect(owner?.authId).toBe("claimed-owner");
  });
});
