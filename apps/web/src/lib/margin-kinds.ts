import type { ANNOTATION_TYPES } from "@/components/annotation-card";

export type AnnotationKind = keyof typeof ANNOTATION_TYPES;

/** The margin names kinds by what the note does, with the kind colour tokens from globals.css. */
export const KINDS = {
  cross_reference: { name: "connection", color: "var(--kind-connection)" },
  context: { name: "context", color: "var(--kind-context)" },
  tension: { name: "tension", color: "var(--kind-tension)" },
  question: { name: "question", color: "var(--kind-question)" },
} satisfies Record<AnnotationKind, { name: string; color: string }>;

/** Note text as plain prose, for places that can't render the card's inline markup. */
export function plainNote(text: string): string {
  return text
    .replace(/\[([^\]\n]+)\]\([^)\s]+\)/g, "$1")
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}
