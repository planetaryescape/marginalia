import { NoObjectGeneratedError } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const generateObject = vi.fn();
vi.mock("ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("ai")>()),
  generateObject: (...args: unknown[]) => generateObject(...args),
}));

const { generateObjectWithFallback } = await import("./aiModels");

const unparseable = () =>
  new NoObjectGeneratedError({
    message: "No object generated: could not parse the response.",
    text: '{"thesis": "cleanly properly cleanly properly',
    response: { id: "r", timestamp: new Date(), modelId: "m" },
    usage: {
      inputTokens: 1,
      outputTokens: 1,
      totalTokens: 2,
    } as never,
    finishReason: "length",
  });

const target = (id: string) =>
  ({ id, provider: "openrouter", model: id, apiKey: "k" }) as never;

describe("generateObjectWithFallback", () => {
  beforeEach(() => {
    generateObject.mockReset();
  });

  it("asks the same model again when its answer doesn't parse", async () => {
    generateObject
      .mockRejectedValueOnce(unparseable())
      .mockResolvedValueOnce({ object: { ok: true } });
    const result = await generateObjectWithFallback({
      schema: z.object({ ok: z.boolean() }),
      prompt: "p",
      targets: [target("first")],
    });
    expect(result).toEqual({ object: { ok: true }, modelId: "first" });
    expect(generateObject).toHaveBeenCalledTimes(2);
  });

  it("moves to the next model after two unparseable answers", async () => {
    generateObject
      .mockRejectedValueOnce(unparseable())
      .mockRejectedValueOnce(unparseable())
      .mockResolvedValueOnce({ object: { ok: true } });
    const result = await generateObjectWithFallback({
      schema: z.object({ ok: z.boolean() }),
      prompt: "p",
      targets: [target("first"), target("second")],
    });
    expect(result.modelId).toBe("second");
    expect(generateObject).toHaveBeenCalledTimes(3);
  });

  it("gives up on the last model after two unparseable answers", async () => {
    generateObject.mockRejectedValue(unparseable());
    await expect(
      generateObjectWithFallback({
        schema: z.object({ ok: z.boolean() }),
        prompt: "p",
        targets: [target("only")],
      }),
    ).rejects.toThrow(/could not parse/);
    expect(generateObject).toHaveBeenCalledTimes(2);
  });

  it("does not repeat a call that failed for another reason", async () => {
    generateObject.mockRejectedValue(new Error("bad request"));
    await expect(
      generateObjectWithFallback({
        schema: z.object({ ok: z.boolean() }),
        prompt: "p",
        targets: [target("only")],
      }),
    ).rejects.toThrow("bad request");
    expect(generateObject).toHaveBeenCalledTimes(1);
  });
});
