import { describe, expect, it } from "vitest";
import {
  createStartupReporter,
  STARTUP_STALL_MESSAGE,
  type StartupStall,
} from "./startup-diagnostics";

const stall: StartupStall = {
  phase: "session",
  waitedMs: 30_000,
  connection: {
    isWebSocketConnected: false,
    hasEverConnected: true,
    connectionCount: 2,
    connectionRetries: 5,
  },
};

describe("startup stall reports", () => {
  it("reports each phase once per page load", () => {
    const seen: StartupStall[] = [];
    const report = createStartupReporter((_, s) => void seen.push(s));
    expect(report(stall)).toBe(true);
    expect(report(stall)).toBe(false);
    expect(report({ ...stall, phase: "reader" })).toBe(true);
    expect(seen.map((s) => s.phase)).toEqual(["session", "reader"]);
  });

  it("passes on only the allowlisted fields", () => {
    const seen: Array<[string, StartupStall]> = [];
    const report = createStartupReporter((message, s) => {
      seen.push([message, s]);
    });
    const wider = {
      ...stall,
      token: "secret-token",
      connection: { ...stall.connection, url: "https://private.example" },
    };
    report(wider);
    expect(seen).toEqual([[STARTUP_STALL_MESSAGE, stall]]);
    expect(JSON.stringify(seen)).not.toMatch(/secret|private\.example/);
  });
});
