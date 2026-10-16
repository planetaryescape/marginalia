export type KindFamily = "pushback" | "support" | "connection";

export interface KindInfo {
  /** The reader's word for it: "connection", never "cross-reference". */
  name: string;
  family: KindFamily;
  /** The kind colour token, defined per reader theme in globals.css. */
  color: string;
  /** What the follow-up field asks. */
  prompt: string;
}

const PUSH_BACK = "Where do you land on this?";
const THOUGHTS = "Add your thoughts…";

/**
 * The kinds of margin note and their families (blueprint 02, Note kinds). Each
 * family has one colour family: pushback is terracotta, support sage,
 * connection slate (and purple for the question). The stored type for a
 * connection is still `cross_reference`.
 */
export const KINDS = {
  tension: {
    name: "tension",
    family: "pushback",
    color: "var(--kind-tension)",
    prompt: PUSH_BACK,
  },
  fallacy: {
    name: "fallacy",
    family: "pushback",
    color: "var(--kind-fallacy)",
    prompt: PUSH_BACK,
  },
  assumption: {
    name: "assumption",
    family: "pushback",
    color: "var(--kind-assumption)",
    prompt: PUSH_BACK,
  },
  unsupported: {
    name: "unsupported",
    family: "pushback",
    color: "var(--kind-unsupported)",
    prompt: PUSH_BACK,
  },
  other_explanation: {
    name: "other explanation",
    family: "pushback",
    color: "var(--kind-other-explanation)",
    prompt: PUSH_BACK,
  },
  strong_point: {
    name: "strong point",
    family: "support",
    color: "var(--kind-strong-point)",
    prompt: THOUGHTS,
  },
  crux: {
    name: "crux",
    family: "support",
    color: "var(--kind-crux)",
    prompt: THOUGHTS,
  },
  cross_reference: {
    name: "connection",
    family: "connection",
    color: "var(--kind-connection)",
    prompt: THOUGHTS,
  },
  context: {
    name: "context",
    family: "connection",
    color: "var(--kind-context)",
    prompt: THOUGHTS,
  },
  question: {
    name: "question",
    family: "connection",
    color: "var(--kind-question)",
    prompt: "Write your reflection…",
  },
} as const satisfies Record<string, KindInfo>;

export type AnnotationKind = keyof typeof KINDS;

/**
 * The kind for a stored type, or undefined for one this build doesn't know
 * (a newer backend may add kinds). Callers draw an unknown kind as a plain
 * pencil note rather than failing.
 */
export function kindOf(type: string): KindInfo | undefined {
  // SAFETY: hasOwn just confirmed `type` is one of KINDS' own keys.
  return Object.hasOwn(KINDS, type) ? KINDS[type as AnnotationKind] : undefined;
}

export interface KindLabel {
  /** "tension", or "fallacy · false dilemma". */
  name: string;
  /** The muted words after it: the family, or where a connection points. */
  family: string;
}

/** What the margin writes at the head of a note. */
export function kindLabel(
  type: string,
  detail: { fallacyName?: string; articleRefId?: string } = {},
): KindLabel {
  const kind = kindOf(type);
  if (!kind) return { name: "note", family: "" };
  const name =
    type === "fallacy" && detail.fallacyName
      ? `${kind.name} · ${detail.fallacyName}`
      : kind.name;
  if (type === "cross_reference")
    return {
      name,
      family: detail.articleRefId ? "in your library" : "in your notes",
    };
  if (type === "question") return { name, family: "for you" };
  return { name, family: kind.family };
}

/** Note text as plain prose, for places that can't render the card's inline markup. */
export function plainNote(text: string): string {
  return text
    .replace(/\[([^\]\n]+)\]\([^)\s]+\)/g, "$1")
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}
