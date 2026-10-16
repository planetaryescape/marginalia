import { describe, expect, it } from "vitest";
import { KINDS, kindLabel, kindOf } from "./margin-kinds";

describe("margin kinds", () => {
  it("has ten kinds in three families", () => {
    const families = Object.values(KINDS).map((kind) => kind.family);
    expect(families.filter((f) => f === "pushback")).toHaveLength(5);
    expect(families.filter((f) => f === "support")).toHaveLength(2);
    expect(families.filter((f) => f === "connection")).toHaveLength(3);
    expect(Object.keys(KINDS)).toEqual(
      expect.arrayContaining([
        "cross_reference",
        "context",
        "tension",
        "question",
        "fallacy",
        "assumption",
        "unsupported",
        "other_explanation",
        "strong_point",
        "crux",
      ]),
    );
  });

  it("names a connection in plain words", () => {
    expect(kindOf("cross_reference")?.name).toBe("connection");
  });

  it("labels each kind with its family, a fallacy with its name", () => {
    expect(kindLabel("unsupported")).toEqual({
      name: "unsupported",
      family: "pushback",
    });
    expect(kindLabel("fallacy", { fallacyName: "false dilemma" })).toEqual({
      name: "fallacy · false dilemma",
      family: "pushback",
    });
    expect(kindLabel("fallacy")).toEqual({
      name: "fallacy",
      family: "pushback",
    });
    expect(kindLabel("crux").family).toBe("support");
    expect(kindLabel("question").family).toBe("for you");
    expect(kindLabel("cross_reference").family).toBe("in your notes");
    expect(kindLabel("cross_reference", { articleRefId: "x" }).family).toBe(
      "in your library",
    );
  });

  it("gives an unknown kind no colour, family or failure, whatever its name", () => {
    for (const type of [
      "something_new",
      "",
      "constructor",
      "__proto__",
      "toString",
      "hasOwnProperty",
    ]) {
      expect(kindOf(type)).toBeUndefined();
      expect(kindLabel(type)).toEqual({ name: "note", family: "" });
    }
  });
});
