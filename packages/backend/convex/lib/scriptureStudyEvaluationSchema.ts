import { toJSONSchema } from "zod";
import { resultSchema } from "./scriptureStudy";

/** Shared wire-schema snapshot for the local fixture runner's byte reservation. */
export function scriptureStudyEvaluationSchemaJson() {
  return JSON.stringify(toJSONSchema(resultSchema, { target: "draft-7" }));
}
