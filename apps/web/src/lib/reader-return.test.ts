import { describe, expect, it } from "vitest";
import {
  backTarget,
  canReach,
  isReaderPath,
  originRoom,
  recordRoom,
  rememberScroll,
  savedScroll,
} from "./reader-return";

describe("backTarget", () => {
  it("names the room the reader came from", () => {
    expect(backTarget("/library", null)).toEqual({
      label: "Library",
      href: "/library",
    });
    expect(backTarget("/notes", null)).toEqual({
      label: "Notes",
      href: "/notes",
    });
  });

  it("returns to the session an article was opened from", () => {
    expect(backTarget("/session/s1", null)).toEqual({
      label: "Desk",
      href: "/session/s1",
    });
  });

  it("falls back to Desk for a cold open, a direct link or another page", () => {
    expect(backTarget(null, null)).toEqual({ label: "Desk", href: "/" });
    expect(backTarget("/saved", null)).toEqual({ label: "Desk", href: "/" });
    expect(backTarget("/", null)).toEqual({ label: "Desk", href: "/" });
  });

  it("uses the session query param when no room was recorded", () => {
    expect(backTarget(null, "s9")).toEqual({
      label: "Desk",
      href: "/session/s9",
    });
  });
});

describe("room memory", () => {
  it("records rooms, never reader paths", () => {
    expect(isReaderPath("/read/a1")).toBe(true);
    expect(isReaderPath("/library")).toBe(false);
    recordRoom("/library");
    recordRoom("/read/a1");
    expect(originRoom()).toBe("/library");
  });

  it("remembers scroll per room", () => {
    rememberScroll("/library", 1200);
    rememberScroll("/notes", 40);
    expect(savedScroll("/library")).toBe(1200);
    expect(savedScroll("/notes")).toBe(40);
    expect(savedScroll("/saved")).toBeUndefined();
  });
});

describe("canReach", () => {
  it("waits until the room is tall enough for the saved position", () => {
    // Data still loading: the page is one screen tall, so 1200px can't be reached
    expect(canReach(1200, 900, 900)).toBe(false);
    expect(canReach(1200, 2100, 900)).toBe(true);
    expect(canReach(0, 900, 900)).toBe(true);
  });
});
