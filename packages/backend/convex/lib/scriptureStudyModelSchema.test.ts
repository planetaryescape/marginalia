// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { generateObjectWithFallback } from "./aiModels";
import { resultSchema } from "./scriptureStudy";
import { studyFollowUpSchema } from "./scriptureStudyFollowUps";
import {
  studyObjectProviderSchema,
  studyProviderSchema,
} from "./scriptureStudyModelSchema";

afterEach(() => vi.unstubAllGlobals());
it.each([
  "openai:gpt-6",
  "openrouter:google/gemini-3.8-flash",
])("serializes the refined follow-up schema for %s without losing local citation checks", (model) => {
  const local = studyFollowUpSchema(["web-1"]);
  expect(() => studyObjectProviderSchema(model, local)).not.toThrow();
  expect(
    local.safeParse({
      answer: "An unsupported positive explanation",
      evidenceCoverage: "in_saved_sources",
      evidenceIds: [],
    }).success,
  ).toBe(false);
});

function hasArrayCap(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  if ("type" in value && value.type === "array" && "maxItems" in value)
    return true;
  return Object.values(value).some(hasArrayCap);
}

it("completes a Study through the real SDK when Gemini rejects nested array caps", async () => {
  const fetch = vi.fn(async (_url: unknown, init: RequestInit) => {
    const request = JSON.parse(String(init.body));
    if (hasArrayCap(request.response_format.json_schema.schema)) {
      return new Response(
        JSON.stringify({
          error: {
            message: "Provider returned error",
            code: 400,
            metadata: {
              raw: JSON.stringify({
                error: {
                  code: 400,
                  message: "Request contains an invalid argument.",
                  status: "INVALID_ARGUMENT",
                },
              }),
            },
          },
        }),
        { status: 400, headers: { "content-type": "application/json" } },
      );
    }
    return new Response(
      JSON.stringify({
        id: "fixture",
        object: "chat.completion",
        created: 1,
        model: "google/gemini-3.8-flash",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: '{"findings":[]}' },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
      { headers: { "content-type": "application/json" } },
    );
  });
  vi.stubGlobal("fetch", fetch);
  await expect(
    generateObjectWithFallback({
      schema: resultSchema,
      providerSchema: studyProviderSchema("openrouter:google/gemini-3.8-flash"),
      targets: [
        {
          id: "openrouter:google/gemini-3.8-flash",
          name: "Gemini 3.8 Flash",
          provider: "openrouter",
          model: "google/gemini-3.8-flash",
          apiKey: "fixture-key",
        },
      ],
      prompt: 'No evidence supplied. Return {"findings":[]}.',
      maxOutputTokens: 6000,
    }),
  ).resolves.toMatchObject({ object: { findings: [] } });
  expect(fetch).toHaveBeenCalledTimes(1);
});

const finding = {
  findingId: "presence",
  lens: "literary",
  anchor: {
    verseId: "PSA.23.4",
    referenceKey: "PSA.23.4-PSA.23.6",
    quote: "you are with me",
  },
  observation: "The speaker addresses the shepherd directly.",
  consequence: "The danger is described in the shepherd's presence.",
  interpretations: [],
  evidenceIds: ["web-selected"],
  limitations: [],
  relatedPassages: [],
};

it.each([
  ["seven findings", { findings: Array.from({ length: 7 }, () => finding) }],
  [
    "nine evidence references",
    {
      findings: [
        {
          ...finding,
          evidenceIds: Array.from(
            { length: 9 },
            (_, index) => `source-${index}`,
          ),
        },
      ],
    },
  ],
  [
    "four interpretations",
    {
      findings: [
        {
          ...finding,
          interpretations: Array.from({ length: 4 }, () => ({
            position: "A position",
            evidenceIds: ["web-selected"],
            limitations: [],
          })),
        },
      ],
    },
  ],
])("rejects %s locally even though the provider grammar omits array caps", async (_name, object) => {
  const fetch = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          id: "fixture",
          object: "chat.completion",
          created: 1,
          model: "google/gemini-3.8-flash",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: JSON.stringify(object) },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
        { headers: { "content-type": "application/json" } },
      ),
  );
  vi.stubGlobal("fetch", fetch);
  await expect(
    generateObjectWithFallback({
      schema: resultSchema,
      providerSchema: studyProviderSchema("openrouter:google/gemini-3.8-flash"),
      targets: [
        {
          id: "openrouter:google/gemini-3.8-flash",
          name: "Gemini 3.8 Flash",
          provider: "openrouter",
          model: "google/gemini-3.8-flash",
          apiKey: "fixture-key",
        },
      ],
      prompt: "Public validation fixture.",
      maxOutputTokens: 6000,
    }),
  ).rejects.toThrow();
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(resultSchema.safeParse(object).success).toBe(false);
});

it("uses the required-property adapter for OpenAI and leaves Anthropic on the bounded local schema", () => {
  expect(studyProviderSchema("openai:gpt-5")).toBeDefined();
  expect(studyProviderSchema("openrouter:openai/gpt-5")).toBeDefined();
  expect(studyProviderSchema("anthropic:claude-sonnet-4")).toBeUndefined();
  expect(
    studyProviderSchema("openrouter:anthropic/claude-sonnet-4"),
  ).toBeUndefined();
});
it("sends required object properties to OpenAI strict structured output, including nullable teaching and nested headings", async () => {
  const fetch = vi.fn(
    async (_url: Parameters<typeof globalThis.fetch>[0], init: RequestInit) => {
      const request = JSON.parse(String(init.body));
      const schema = request.response_format.json_schema.schema;
      if (
        !schema.required.includes("teaching") ||
        !schema.properties.findings.items.required.includes("heading")
      )
        return Response.json(
          {
            error: {
              message: "Strict schema requires every property in required",
              code: "invalid_json_schema",
            },
          },
          { status: 400 },
        );
      return Response.json({
        id: "fixture",
        object: "chat.completion",
        created: 1,
        model: "gpt-6",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: '{"findings":[],"teaching":null}',
            },
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
      schema: resultSchema,
      providerSchema: studyProviderSchema("openai:gpt-6"),
      targets: [
        {
          id: "openai:gpt-6",
          name: "OpenAI fixture",
          provider: "openai",
          model: "gpt-6",
          apiKey: "fixture-key",
        },
      ],
      prompt: "Public transport fixture; return no findings.",
      maxOutputTokens: 6000,
      maxParseAttempts: 1,
    }),
  ).resolves.toMatchObject({ object: { findings: [], teaching: null } });
  expect(fetch).toHaveBeenCalledTimes(1);
});
