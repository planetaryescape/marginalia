import { v } from "convex/values";

/**
 * The kinds of margin note, by family (blueprint 02, Note kinds). The first
 * four are the original kinds and stay as they are stored.
 */
export const KIND_FAMILIES = {
  pushback: [
    "tension",
    "fallacy",
    "assumption",
    "unsupported",
    "other_explanation",
  ],
  support: ["strong_point", "crux"],
  connection: ["cross_reference", "context", "question"],
} as const;

export type KindFamily = keyof typeof KIND_FAMILIES;

export const ANNOTATION_KINDS = [
  ...KIND_FAMILIES.pushback,
  ...KIND_FAMILIES.support,
  ...KIND_FAMILIES.connection,
] as const;

export type AnnotationKind = (typeof ANNOTATION_KINDS)[number];

/** Narrows model output: anything that isn't a known kind is dropped, not stored. */
export function isAnnotationKind(value: unknown): value is AnnotationKind {
  return (
    typeof value === "string" &&
    (ANNOTATION_KINDS as readonly string[]).includes(value)
  );
}

/** The stored `type`. Additive: rows written before the families exist keep their kind. */
export const annotationType = v.union(
  v.literal("cross_reference"),
  v.literal("context"),
  v.literal("tension"),
  v.literal("question"),
  v.literal("fallacy"),
  v.literal("assumption"),
  v.literal("unsupported"),
  v.literal("other_explanation"),
  v.literal("strong_point"),
  v.literal("crux"),
);
