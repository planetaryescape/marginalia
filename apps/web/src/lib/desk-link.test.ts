import { describe, expect, it } from "vitest";
import { deskLinkHref, parseDeskLink, parseWindowMinutes } from "./desk-link";

describe("desk links", () => {
  it("accepts a sensible window and nothing else", () => {
    expect(parseWindowMinutes("10")).toBe(10);
    expect(parseWindowMinutes("180")).toBe(180);
    for (const bad of [null, "", "0", "-5", "181", "abc", "NaN"])
      expect(parseWindowMinutes(bad)).toBeUndefined();
  });

  it("round-trips the window and the session", () => {
    const href = deskLinkHref({ minutes: 10, sessionId: "s1" as never });
    expect(href).toBe("/?m=10&session=s1");
    expect(parseDeskLink(new URL(href, "http://x").searchParams)).toEqual({
      minutes: 10,
      sessionId: "s1",
    });
    expect(parseDeskLink(new URLSearchParams("session=s1"))).toBeNull();
  });
});
