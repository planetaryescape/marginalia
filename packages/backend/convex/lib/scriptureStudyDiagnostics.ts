const ERROR_TYPES = new Set([
  "Error",
  "ConvexError",
  "AbortError",
  "TimeoutError",
  "ZodError",
  "AI_APICallError",
  "AI_NoObjectGeneratedError",
  "AI_TypeValidationError",
  "AI_JSONParseError",
  "AI_InvalidArgumentError",
]);
const SIGNALS = {
  schema: /schema|response.format/i,
  quota: /credits?|quota|balance|payment/i,
  authentication: /auth|api.key|saved key/i,
  model: /model|endpoint/i,
  output: /output|tokens?|length|finish.reason/i,
  parse: /parse|json|validation|no object/i,
  network: /fetch|network|connect|timeout/i,
  provider_rejection: /provider returned error/i,
  invalid_argument: /invalid.argument|unknown name|unsupported property/i,
} as const;
const PARAMETERS = [
  "response_format",
  "response_schema",
  "responseSchema",
  "responseJsonSchema",
  "$schema",
  "json_schema",
  "additionalProperties",
  "minLength",
  "maxLength",
  "minItems",
  "maxItems",
  "pattern",
  "propertyNames",
  "max_tokens",
  "max_output_tokens",
  "maxOutputTokens",
  "temperature",
  "top_p",
  "anyOf",
  "oneOf",
  "nullable",
  "required",
  "strict",
] as const;

function providerMessages(
  value: unknown,
  depth = 0,
  budget = { remaining: 48 },
): string[] {
  if (depth > 12 || budget.remaining-- <= 0) return [];
  if (typeof value === "string") {
    if (value.length > 16_000) return [];
    try {
      return providerMessages(JSON.parse(value), depth + 1, budget);
    } catch {
      return [value];
    }
  }
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value))
    return value
      .slice(0, 4)
      .flatMap((item) => providerMessages(item, depth + 1, budget));
  const messages =
    "message" in value && typeof value.message === "string"
      ? [value.message.slice(0, 16_000)]
      : [];
  if ("error" in value)
    messages.push(...providerMessages(value.error, depth + 1, budget));
  for (const key of [
    "details",
    "fieldViolations",
    "description",
    "field",
    "param",
  ] as const) {
    if (key in value)
      messages.push(...providerMessages(value[key], depth + 1, budget));
  }
  if (
    "metadata" in value &&
    value.metadata &&
    typeof value.metadata === "object" &&
    "raw" in value.metadata
  )
    messages.push(...providerMessages(value.metadata.raw, depth + 1, budget));
  return messages;
}

/** Fixed diagnostic vocabulary only: never emit prompts, source text, raw
 * provider messages, bodies, headers, credentials, or arbitrary error fields. */
export function studyFailureDiagnostic(error: unknown) {
  const fields = error && typeof error === "object" ? error : {};
  const name = "name" in fields ? fields.name : null;
  const status = "statusCode" in fields ? fields.statusCode : null;
  const message =
    "message" in fields && typeof fields.message === "string"
      ? fields.message.slice(0, 16_000)
      : "";
  const messages = [
    message,
    ...providerMessages("responseBody" in fields ? fields.responseBody : null),
    ...providerMessages("data" in fields ? fields.data : null),
  ];
  return {
    errorType:
      typeof name === "string" && ERROR_TYPES.has(name) ? name : "unknown",
    status:
      typeof status === "number" &&
      Number.isInteger(status) &&
      status >= 100 &&
      status <= 599
        ? status
        : null,
    signals: Object.entries(SIGNALS)
      .filter(([, pattern]) =>
        messages.some((message) => pattern.test(message)),
      )
      .map(([signal]) => signal),
    parameters: PARAMETERS.filter((name) =>
      messages.some((message) => message.includes(name)),
    ),
  };
}
