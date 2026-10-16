import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./auth-client", () => ({ authClient: {} }));

import {
  forgetConvexToken,
  getConvexToken,
  rememberConvexToken,
  tokenExpiry,
} from "./convex-token";

const jwt = (expSeconds: number) =>
  `h.${btoa(JSON.stringify({ exp: expSeconds })).replace(/=/g, "")}.s`;
const NOW = 1_000_000_000_000;
const now = () => NOW;

beforeEach(() => forgetConvexToken());

describe("tokenExpiry", () => {
  it("reads exp in milliseconds", () => {
    expect(tokenExpiry(jwt(1_000_000_600))).toBe(1_000_000_600_000);
  });
  it("returns null for a malformed token", () => {
    expect(tokenExpiry("nope")).toBeNull();
    expect(tokenExpiry("a.!!.c")).toBeNull();
  });
});

describe("getConvexToken", () => {
  it("reuses a cached token that is more than 60s from expiry", async () => {
    const token = jwt(NOW / 1000 + 300);
    rememberConvexToken(token);
    const fetchToken = vi.fn();
    expect(await getConvexToken(now, fetchToken)).toBe(token);
    expect(fetchToken).not.toHaveBeenCalled();
  });

  it("refreshes a token within 60s of expiry", async () => {
    rememberConvexToken(jwt(NOW / 1000 + 30));
    const fresh = jwt(NOW / 1000 + 600);
    const fetchToken = vi.fn().mockResolvedValue(fresh);
    expect(await getConvexToken(now, fetchToken)).toBe(fresh);
    expect(await getConvexToken(now, fetchToken)).toBe(fresh);
    expect(fetchToken).toHaveBeenCalledTimes(1);
  });

  it("refreshes an expired token and when none is cached", async () => {
    rememberConvexToken(jwt(NOW / 1000 - 10));
    const fetchToken = vi.fn().mockResolvedValue(null);
    expect(await getConvexToken(now, fetchToken)).toBeNull();
    expect(fetchToken).toHaveBeenCalledTimes(1);
  });

  it("shares one refresh between concurrent callers", async () => {
    const fresh = jwt(NOW / 1000 + 600);
    const fetchToken = vi.fn().mockResolvedValue(fresh);
    await Promise.all([
      getConvexToken(now, fetchToken),
      getConvexToken(now, fetchToken),
    ]);
    expect(fetchToken).toHaveBeenCalledTimes(1);
  });

  it("does not cache a token without a readable expiry", async () => {
    rememberConvexToken("opaque");
    const fetchToken = vi.fn().mockResolvedValue(null);
    await getConvexToken(now, fetchToken);
    expect(fetchToken).toHaveBeenCalledTimes(1);
  });
});
