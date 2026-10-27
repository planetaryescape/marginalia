"use node";
import { type JSONSchema7, jsonSchema } from "ai";
import { toJSONSchema, type ZodType } from "zod";
import { resultSchema } from "./scriptureStudy";

function withoutArrayCaps(schema: JSONSchema7): JSONSchema7;
function withoutArrayCaps(schema: JSONSchema7 | boolean): JSONSchema7 | boolean;
function withoutArrayCaps(
  schema: JSONSchema7 | boolean,
): JSONSchema7 | boolean {
  if (typeof schema === "boolean") return schema;
  const wire = { ...schema };
  delete wire.maxItems;
  if (wire.properties) {
    wire.properties = Object.fromEntries(
      Object.entries(wire.properties).map(([name, value]) => [
        name,
        withoutArrayCaps(value),
      ]),
    );
  }
  if (wire.items) {
    wire.items = Array.isArray(wire.items)
      ? wire.items.map(withoutArrayCaps)
      : withoutArrayCaps(wire.items);
  }
  for (const key of ["anyOf", "oneOf", "allOf"] as const) {
    if (wire[key]) wire[key] = wire[key].map(withoutArrayCaps);
  }
  return wire;
}

/** Google's Study grammar rejects the nested maxItems bounds. Keep those bounds
 * in SDK validation and publication, not in this provider's response grammar. */
export function studyProviderSchema(modelId: string) {
  return studyObjectProviderSchema(modelId, resultSchema);
}

export function studyObjectProviderSchema<T>(
  modelId: string,
  local: ZodType<T>,
) {
  if (!modelId.startsWith("openrouter:google/gemini-")) return undefined;
  // SAFETY: Zod emits draft-7 JSON Schema here, matching the SDK's JSONSchema7 contract.
  const schema = toJSONSchema(local, {
    target: "draft-7",
  }) as JSONSchema7;
  const wire = withoutArrayCaps(schema);
  return jsonSchema<T>(wire, {
    validate(value) {
      const parsed = local.safeParse(value);
      return parsed.success
        ? { success: true, value: parsed.data }
        : { success: false, error: parsed.error };
    },
  });
}
