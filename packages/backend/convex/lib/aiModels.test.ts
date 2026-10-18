import { APICallError, NoObjectGeneratedError, RetryError } from "ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

/** What the AI SDK throws when a 200 response's body fails to read or parse. */
const unusableBody = (message: string) =>
  new APICallError({
    message,
    cause: new TypeError("terminated"),
    statusCode: 200,
    url: "https://openrouter.ai/api/v1/chat/completions",
    requestBodyValues: {},
  });

const target = (id: string) =>
  ({ id, provider: "openrouter", model: id, apiKey: "k" }) as never;

describe("generateObjectWithFallback", () => {
  afterEach(() => vi.useRealTimers());
  beforeEach(() => {
    generateObject.mockReset();
  });
  it("normalizes SDK retry wrappers and uses explicit zero hidden retries", async () => {
    generateObject
      .mockRejectedValueOnce(
        new RetryError({
          message: "Retries exhausted",
          reason: "maxRetriesExceeded",
          errors: [
            new APICallError({
              message: "Unavailable",
              statusCode: 503,
              url: "https://fixture.invalid",
              requestBodyValues: {},
            }),
          ],
        }),
      )
      .mockResolvedValueOnce({ object: { ok: true } });
    const result = await generateObjectWithFallback({
      schema: z.object({ ok: z.boolean() }),
      targets: [target("first"), target("second")],
    });
    expect(result.modelId).toBe("second");
    expect(
      generateObject.mock.calls.every(
        ([options]) =>
          options.maxRetries === 0 &&
          options.abortSignal instanceof AbortSignal,
      ),
    ).toBe(true);
  });
  it("aborts a structured attempt on deadline before trying the next model", async () => {
    vi.useFakeTimers();
    let firstSignal!: AbortSignal;
    generateObject
      .mockImplementationOnce(({ abortSignal }) => {
        firstSignal = abortSignal;
        return new Promise(() => {});
      })
      .mockImplementationOnce(() => {
        expect(firstSignal.aborted).toBe(true);
        return { object: { ok: true } };
      });
    const pending = generateObjectWithFallback({
      schema: z.object({ ok: z.boolean() }),
      targets: [target("first"), target("second")],
      deadlineMs: 5,
    });
    await vi.advanceTimersByTimeAsync(6);
    expect((await pending).modelId).toBe("second");
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

  it.each([
    "Failed to process successful response",
    "Invalid JSON response",
  ])("asks the same model again after a %s", async (message) => {
    generateObject
      .mockRejectedValueOnce(unusableBody(message))
      .mockResolvedValueOnce({ object: { ok: true } });
    const result = await generateObjectWithFallback({
      schema: z.object({ ok: z.boolean() }),
      prompt: "p",
      targets: [target("first"), target("second")],
    });
    expect(result).toEqual({ object: { ok: true }, modelId: "first" });
    expect(generateObject).toHaveBeenCalledTimes(2);
  });

  it("moves to the next model after two unusable bodies", async () => {
    generateObject
      .mockRejectedValueOnce(
        unusableBody("Failed to process successful response"),
      )
      .mockRejectedValueOnce(
        unusableBody("Failed to process successful response"),
      )
      .mockResolvedValueOnce({ object: { ok: true } });
    const result = await generateObjectWithFallback({
      schema: z.object({ ok: z.boolean() }),
      prompt: "p",
      targets: [target("first"), target("second")],
    });
    expect(result.modelId).toBe("second");
    expect(generateObject).toHaveBeenCalledTimes(3);
  });

  it("does not repeat a request the provider refused with a 4xx", async () => {
    generateObject.mockRejectedValue(
      new APICallError({
        message: "Invalid request",
        statusCode: 400,
        url: "https://openrouter.ai/api/v1/chat/completions",
        requestBodyValues: {},
        isRetryable: false,
      }),
    );
    await expect(
      generateObjectWithFallback({
        schema: z.object({ ok: z.boolean() }),
        prompt: "p",
        targets: [target("first"), target("second")],
      }),
    ).rejects.toThrow("Invalid request");
    expect(generateObject).toHaveBeenCalledTimes(1);
  });
});
