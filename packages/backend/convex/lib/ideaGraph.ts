// Pure helpers for the idea graph (rung 5d): node keys, how signals score,
// and the text that explains each kind of connection. The reads live in
// ideaGraph.ts; keeping these free of the database lets them be tested alone.
import { getConvexSize, type Value } from "convex/values";

export const NODE_KINDS = [
  "note",
  "highlight",
  "answer",
  "vault",
  "article",
] as const;
export type NodeKind = (typeof NODE_KINDS)[number];

/** The graph never shows more than this many ideas, centre included. */
export const MAX_NODES = 15;
/** Slots kept free in the graph for articles that tie several ideas together. */
export const HUB_SLOTS = 2;
/** Neighbours of the centre; the rest of the budget goes to the faint second ring. */
export const FIRST_RING = 7;

/**
 * Documents one graph query may read in all. Every read in the graph asks the
 * budget first, so a busy library can't push a query towards Convex's 16MiB
 * limit. A note, highlight or answer carries a ~12KB embedding, so 160 of
 * them are about 2MB.
 */
export const GRAPH_READ_BUDGET = 160;
/**
 * Of those, kept back for loading the ideas that are drawn. Discovery (finding
 * who is near) may only spend the rest, so a busy library can't use the whole
 * budget finding candidates and leave none to show.
 */
export const LOAD_RESERVE = 60;
/**
 * Whole-article reads allowed in one graph query. A document is not a fixed
 * size: an article holds its full text and can reach ~900KB, so counting
 * documents alone lets 20 of them read ~18MB. Eight is about 7MB at that
 * size, which with the ~2MB of embedded documents above stays well under 16MiB.
 */
export const ARTICLE_READS = 8;

/**
 * Bytes one graph query may read. A document is not a fixed size (a note or an
 * article can approach the 1MiB document limit), so counting documents alone
 * lets a few dozen large ones read tens of megabytes. Every document read is
 * charged its size after the fact, and a read is refused unless the remaining
 * bytes could hold every document it may return at the largest size a
 * document can have. The worst case is therefore 12MB, under the 16MiB limit.
 */
export const GRAPH_READ_BYTES = 12 * 1024 * 1024;
/** The largest a single Convex document can be. */
export const MAX_DOCUMENT_BYTES = 1024 * 1024;

interface BudgetState {
  left: number;
  articles: number;
  bytes: number;
}

/** A document's size as Convex counts it, or its JSON length where that can't be measured. */
function sizeOf(doc: unknown): number {
  try {
    return getConvexSize(doc as Value);
  } catch {
    return JSON.stringify(doc)?.length ?? 0;
  }
}

export class ReadBudget {
  private readonly state: BudgetState;
  private readonly floor: number;
  constructor(
    total = GRAPH_READ_BUDGET,
    articles = ARTICLE_READS,
    shared?: { state: BudgetState; floor: number },
    bytes = GRAPH_READ_BYTES,
  ) {
    this.state = shared?.state ?? { left: total, articles, bytes };
    this.floor = shared?.floor ?? 0;
  }
  /** The same budget, but leaving `reserve` documents untouched: for discovery. */
  discovery(reserve = LOAD_RESERVE): ReadBudget {
    return new ReadBudget(0, 0, {
      state: this.state,
      floor: this.floor + reserve,
    });
  }
  get remaining() {
    return Math.max(0, this.state.left - this.floor);
  }
  get remainingBytes() {
    return this.state.bytes;
  }
  /**
   * The most documents the next read may take: what it wants, capped by the
   * documents left and by how many could still fit in the bytes left if each
   * were as large as a document can be. Zero below one such document.
   */
  allow(want: number): number {
    const byBytes = Math.floor(this.state.bytes / MAX_DOCUMENT_BYTES);
    return Math.max(0, Math.min(want, this.remaining, byBytes));
  }
  /** Runs a read of up to `want` documents if any budget is left, and charges what it returned. */
  async take<T>(
    want: number,
    read: (limit: number) => Promise<T[]>,
  ): Promise<T[]> {
    const limit = this.allow(want);
    if (limit === 0) return [];
    const rows = await read(limit);
    this.spend(rows.length);
    this.charge(...rows);
    return rows;
  }
  /** Even an empty read costs one, so the number of queries is bounded too. */
  spend(read: number) {
    this.state.left -= Math.max(1, read);
  }
  /** Charges the size of documents already read. */
  charge(...docs: unknown[]) {
    for (const doc of docs) if (doc) this.state.bytes -= sizeOf(doc);
  }
  /** Whether another whole article may be read; see ARTICLE_READS. */
  get mayReadArticle() {
    return this.state.articles > 0 && this.allow(1) > 0;
  }
  spendArticle() {
    this.state.articles -= 1;
    this.spend(1);
  }
}

/** For reads outside the graph query, which have their own small fixed bounds. */
export const UNLIMITED = new ReadBudget(
  Number.POSITIVE_INFINITY,
  Number.POSITIVE_INFINITY,
  undefined,
  Number.POSITIVE_INFINITY,
);

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
export function fromArticleReason(): Reason {
  return { type: "article", text: "From this article" };
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
    { reasons: Reason[]; score: number; via?: string }
  >();

  constructor(private readonly self: string) {}

  /**
   * `via` is the vault chunk that brought a vault idea in: the passage that
   * matched. The first to name one keeps it.
   */
  add(
    key: string,
    reason: Reason,
    score = SIGNAL_SCORE[reason.type],
    via?: string,
  ) {
    if (key === this.self) return;
    const entry = this.byKey.get(key) ?? { reasons: [], score: 0 };
    entry.via ??= via;
    if (!entry.reasons.some((r) => r.text === reason.text)) {
      entry.reasons.push(reason);
      entry.score += score;
    }
    this.byKey.set(key, entry);
  }

  /** Puts an idea in the first ring whatever else is near: the one just written from the map. */
  pin(key: string, reason: Reason) {
    if (key === this.self) return;
    const entry = this.byKey.get(key) ?? { reasons: [], score: 0 };
    if (!entry.reasons.length) entry.reasons.push(reason);
    entry.score = Number.MAX_SAFE_INTEGER;
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
