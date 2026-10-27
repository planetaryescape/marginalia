"use node";
import { type JSONSchema7, jsonSchema } from "ai";
import { toJSONSchema } from "zod";
import { resultSchema, type StudyResult } from "./scriptureStudy";

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
  return wire;
}

/** Google's Study grammar rejects the nested maxItems bounds. Keep those bounds
 * in SDK validation and publication, not in this provider's response grammar. */
export function studyProviderSchema(modelId: string) {
  if (!modelId.startsWith("openrouter:google/gemini-")) return undefined;
  // SAFETY: Zod emits draft-7 JSON Schema here, matching the SDK's JSONSchema7 contract.
  const schema = toJSONSchema(resultSchema, {
    target: "draft-7",
  }) as JSONSchema7;
  const wire = withoutArrayCaps(schema);
  if (typeof wire === "boolean")
    throw new Error("Study schema must be an object");
  return jsonSchema<StudyResult>(wire, {
    validate(value) {
      const parsed = resultSchema.safeParse(value);
      return parsed.success
        ? { success: true, value: parsed.data }
        : { success: false, error: parsed.error };
    },
  });
}
