"use node";
import { type JSONSchema7, jsonSchema } from "ai";
import { toJSONSchema, type ZodType } from "zod";
import { resultSchema } from "./scriptureStudy";

type StudyWireProvider = "gemini" | "openai";
function providerWire(
  schema: JSONSchema7,
  provider: StudyWireProvider,
): JSONSchema7;
function providerWire(
  schema: JSONSchema7 | boolean,
  provider: StudyWireProvider,
): JSONSchema7 | boolean;
function providerWire(
  schema: JSONSchema7 | boolean,
  provider: StudyWireProvider,
): JSONSchema7 | boolean {
  if (schema === true || schema === false) return schema;
  const wire = { ...schema };
  if (provider === "gemini") delete wire.maxItems;
  const visit = (child: JSONSchema7 | boolean) => providerWire(child, provider);
  if (wire.properties) {
    wire.properties = Object.fromEntries(
      Object.entries(wire.properties).map(([name, value]) => [
        name,
        visit(value),
      ]),
    );
    // Requiring a local optional field narrows the accepted output; it does not
    // invent a value or weaken local validation. Teaching already allows null.
    if (provider === "openai") wire.required = Object.keys(wire.properties);
  }
  if (wire.items) {
    wire.items = Array.isArray(wire.items)
      ? wire.items.map(visit)
      : visit(wire.items);
  }
  for (const key of ["anyOf", "oneOf", "allOf"] as const) {
    if (wire[key]) wire[key] = wire[key].map(visit);
  }
  return wire;
}

/** Provider grammar differences stay on the wire; local bounds remain authoritative. */
export function studyProviderSchema(modelId: string) {
  return studyObjectProviderSchema(modelId, resultSchema);
}

export function studyObjectProviderSchema<T>(
  modelId: string,
  local: ZodType<T>,
) {
  const provider = modelId.startsWith("openrouter:google/gemini-")
    ? "gemini"
    : modelId.startsWith("openai:") || modelId.startsWith("openrouter:openai/")
      ? "openai"
      : null;
  if (!provider) return undefined;
  // SAFETY: Zod emits draft-7 JSON Schema here, matching the SDK's JSONSchema7 contract.
  const schema = toJSONSchema(local, {
    target: "draft-7",
  }) as JSONSchema7;
  const wire = providerWire(schema, provider);
  return jsonSchema<T>(wire, {
    validate(value) {
      const parsed = local.safeParse(value);
      return parsed.success
        ? { success: true, value: parsed.data }
        : { success: false, error: parsed.error };
    },
  });
}
