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
} as const;

/** Fixed diagnostic vocabulary only: never emit prompts, source text, raw
 * provider messages, bodies, headers, credentials, or arbitrary error fields. */
export function studyFailureDiagnostic(error: unknown) {
  const fields = error && typeof error === "object" ? error : {};
  const name = "name" in fields ? fields.name : null;
  const status = "statusCode" in fields ? fields.statusCode : null;
  const message =
    "message" in fields && typeof fields.message === "string"
      ? fields.message
      : "";
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
      .filter(([, pattern]) => pattern.test(message))
      .map(([signal]) => signal),
  };
}
