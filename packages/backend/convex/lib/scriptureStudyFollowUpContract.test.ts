// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { generateObjectWithFallback } from "./aiModels";
import type { ProviderTarget } from "./router";
import {
  studyFollowUpResponseSchema,
  studyFollowUpSchema,
} from "./scriptureStudyFollowUps";
import { studyObjectProviderSchema } from "./scriptureStudyModelSchema";

afterEach(() => vi.unstubAllGlobals());
it.each([
  "openai",
  "openrouter",
] as const)("uses a single object grammar for %s evidence requests and enforces the local answer boundary", async (provider) => {
  const target: ProviderTarget = {
    id:
      provider === "openai"
        ? "openai:gpt-6"
        : "openrouter:google/gemini-3.8-flash",
    name: "Public transport fixture",
    provider,
    model: provider === "openai" ? "gpt-6" : "google/gemini-3.8-flash",
    apiKey: "fixture-key",
  };
  const local = studyFollowUpResponseSchema(["web-1"]);
  const response = {
    answer: null,
    evidenceCoverage: null,
    evidenceIds: [],
    requestedReferences: ["Galatians 5:13-14"],
  };
  const fetch = vi.fn(
    async (_url: Parameters<typeof globalThis.fetch>[0], init: RequestInit) => {
      const request = JSON.parse(String(init.body));
      const wire = request.response_format.json_schema.schema;
      expect(wire.type).toBe("object");
      expect(wire.anyOf).toBeUndefined();
      expect(wire.additionalProperties).toBe(false);
      if (provider === "openai")
        expect(wire.required).toEqual(Object.keys(wire.properties));
      else expect(wire.properties.requestedReferences.maxItems).toBeUndefined();
      return Response.json({
        id: "fixture",
        object: "chat.completion",
        created: 1,
        model: target.model,
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: JSON.stringify(response) },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      });
    },
  );
  vi.stubGlobal("fetch", fetch);
  await expect(
    generateObjectWithFallback({
      schema: local,
      providerSchema: studyObjectProviderSchema(target.id, local),
      targets: [target],
      prompt: "Public contract fixture.",
      maxOutputTokens: 1600,
      maxParseAttempts: 1,
    }),
  ).resolves.toMatchObject({ object: response });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(
    local.safeParse({ ...response, answer: "Unsupported answer" }).success,
  ).toBe(false);
  expect(
    local.safeParse({
      ...response,
      requestedReferences: ["John 1", "John 2", "John 3"],
    }).success,
  ).toBe(false);
  expect(studyFollowUpSchema(["web-1"]).safeParse(response).success).toBe(
    false,
  );
});
