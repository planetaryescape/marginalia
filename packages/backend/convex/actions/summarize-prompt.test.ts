import { describe, expect, it } from "vitest";
import { z } from "zod";
import { SYSTEM, summarySchema } from "./summarize";

const base = {
  gist: "Rest helps.",
  ideas: [
    {
      id: "a",
      label: "Rest helps",
      detail: "Rest supports clear thinking.",
      role: "conclusion",
      paragraphs: [1],
    },
  ],
  links: [],
  flow: "Rest leads to clear thinking.",
};

describe("summary prompt", () => {
  it("asks for about seven ideas at most, built as a tree", () => {
    expect(SYSTEM).toMatch(/about seven ideas at most/);
    expect(SYSTEM).toMatch(/mostly as a tree that leads to the conclusion/);
    expect(SYSTEM).toMatch(/two at most beyond that path/);
  });

  it("requires a thesis in the model output", () => {
    const withoutThesis = summarySchema.safeParse(base);
    expect(withoutThesis.success).toBe(false);
    const withThesis = summarySchema.safeParse({
      ...base,
      thesis: "Rest helps people think.",
    });
    expect(withThesis.success).toBe(true);
  });

  it("describes the idea limit and thesis in the schema sent to the model", () => {
    const json = z.toJSONSchema(summarySchema) as unknown as {
      required: string[];
      properties: { ideas: { description: string } };
    };
    expect(json.required).toContain("thesis");
    expect(json.properties.ideas.description).toMatch(/About 7 ideas at most/);
  });
});
