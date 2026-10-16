import { describe, expect, it, vi } from "vitest";
import { fetchTokenWithRetry, type TokenAttempt } from "./auth-retry";

const noSleep = vi.fn(async () => {});
const attempts = (...results: (TokenAttempt | Error)[]) => {
  const queue = [...results];
  return vi.fn(async () => {
    const next = queue.shift();
    if (next instanceof Error) throw next;
    if (!next) throw new Error("no more attempts");
    return next;
  });
};

describe("fetching a Convex token", () => {
  it("returns the token on the first success", async () => {
    expect(await fetchTokenWithRetry(attempts({ token: "t" }), noSleep)).toBe(
      "t",
    );
  });

  it("retries a network failure and a server error", async () => {
    const attempt = attempts(
      new Error("offline"),
      { status: 502 },
      { token: "t" },
    );
    expect(await fetchTokenWithRetry(attempt, noSleep)).toBe("t");
    expect(attempt).toHaveBeenCalledTimes(3);
  });

  it("stops at once when the server says the session is signed out", async () => {
    const attempt = attempts({ status: 401 }, { token: "never" });
    expect(await fetchTokenWithRetry(attempt, noSleep)).toBeNull();
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it("gives up after its retries", async () => {
    const attempt = attempts(
      { status: 0 },
      { status: 0 },
      { status: 0 },
      { status: 0 },
      { token: "too late" },
    );
    expect(await fetchTokenWithRetry(attempt, noSleep)).toBeNull();
    expect(attempt).toHaveBeenCalledTimes(4);
  });
});
