import type { api } from "@marginalia/backend/convex/_generated/api";
import type { FunctionReturnType } from "convex/server";

export type Graph = FunctionReturnType<typeof api.ideaGraph.graph>;
export type GraphNode = Graph["nodes"][number];
export type GraphEdge = Graph["edges"][number];
export type NodeKind = GraphNode["kind"];

/** How each kind of idea is named, in the reader's terms. */
export const KIND_LABELS: Record<NodeKind, string> = {
  note: "Your note",
  highlight: "Your highlight",
  answer: "Marginalia's answer, kept",
  vault: "From your vault",
  article: "Article",
};

/** The short phrase written on a line between two ideas. */
export function edgeLabel(edge: GraphEdge): string {
  const [first] = edge.reasons;
  if (!first) return "";
  const text = {
    linked: "you linked these",
    connection: "Marginalia noticed",
    article: first.text.startsWith("From")
      ? "from this article"
      : "same article",
    similar: "close in meaning",
    tag: first.text.replace(/^Shared tag/, "shared tag"),
  }[first.type as "linked" | "connection" | "article" | "similar" | "tag"];
  return edge.reasons.length > 1 ? `${text} +${edge.reasons.length - 1}` : text;
}
