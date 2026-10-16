// Pure helpers for the idea graph (rung 5d): node keys, how signals score,
// and the text that explains each kind of connection. The reads live in
// ideaGraph.ts; keeping these free of the database lets them be tested alone.

export const NODE_KINDS = ["note", "highlight", "answer", "vault"] as const;
export type NodeKind = (typeof NODE_KINDS)[number];

/** The graph never shows more than this many ideas, centre included. */
export const MAX_NODES = 15;
/** Neighbours of the centre; the rest of the budget goes to the faint second ring. */
export const FIRST_RING = 7;

export type ReasonType =
  | "linked"
  | "connection"
  | "article"
  | "tag"
  | "similar";
export interface Reason {
  type: ReasonType;
  text: string;
}

/** Higher scores win a place in the first ring. */
export const SIGNAL_SCORE: Record<ReasonType, number> = {
  linked: 100,
  connection: 70,
  similar: 60,
  article: 40,
  tag: 25,
};

/** Cosine floor under which an embedding hit is too loose to draw. */
export const SIMILARITY_FLOOR = 0.4;

export interface NodeRef {
  kind: NodeKind;
  id: string;
}

export function nodeKey(kind: NodeKind, id: string): string {
  return `${kind}:${id}`;
}

export function parseKey(key: string): NodeRef | null {
  const at = key.indexOf(":");
  if (at < 1) return null;
  const kind = key.slice(0, at);
  const id = key.slice(at + 1);
  if (!id || !(NODE_KINDS as readonly string[]).includes(kind)) return null;
  return { kind: kind as NodeKind, id };
}

/** One identity for the line between two ideas, whichever way round. */
export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export function snippet(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
}

export function similarityReason(): Reason {
  return { type: "similar", text: "Close in meaning" };
}
export function linkedReason(): Reason {
  return { type: "linked", text: "You linked these" };
}
export function articleReason(title: string | null): Reason {
  return {
    type: "article",
    text: title ? `Same article: ${snippet(title, 60)}` : "Same article",
  };
}
export function tagReason(name: string): Reason {
  return { type: "tag", text: `Shared tag: ${name}` };
}
export function connectionReason(what: string): Reason {
  return { type: "connection", text: `Marginalia connected ${what}` };
}

/** What a candidate has gathered: why it is near the centre, and how strongly. */
export class Candidates {
  private readonly byKey = new Map<
    string,
    { reasons: Reason[]; score: number }
  >();

  constructor(private readonly self: string) {}

  add(key: string, reason: Reason, score = SIGNAL_SCORE[reason.type]) {
    if (key === this.self) return;
    const entry = this.byKey.get(key) ?? { reasons: [], score: 0 };
    if (!entry.reasons.some((r) => r.text === reason.text)) {
      entry.reasons.push(reason);
      entry.score += score;
    }
    this.byKey.set(key, entry);
  }

  /** Best first; equal scores fall back to the key so the order is stable. */
  ranked(limit: number) {
    return [...this.byKey.entries()]
      .map(([key, entry]) => ({ key, ...entry }))
      .sort((a, b) => b.score - a.score || (a.key < b.key ? -1 : 1))
      .slice(0, limit);
  }
}

/** FNV-1a over both texts: cheap, and enough to notice an edit. */
export function fingerprint(a: string, b: string): string {
  let hash = 0x811c9dc5;
  for (const ch of `${a}\u0000${b}`) {
    hash ^= ch.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16);
}

/** The same for a pair whichever way round it is asked. */
export function pairFingerprint(
  a: { key: string; text: string },
  b: { key: string; text: string },
): string {
  const [first, second] = a.key < b.key ? [a, b] : [b, a];
  return fingerprint(first.text, second.text);
}

/** Only the sentence, never a heading or quote marks the model added. */
export function cleanReason(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^["“']+|["”']+$/g, "")
    .slice(0, 400);
}
