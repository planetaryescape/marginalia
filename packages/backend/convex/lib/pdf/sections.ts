// Splits a long document into reading units (spike S8, D-DES-055): the PDF's
// own outline when it has one, else detected headings, else even parts. Small
// sections are grouped so a unit is worth offering, and big ones are split on
// paragraph boundaries. Pure functions.
import { WORDS_PER_MINUTE } from "../constants";
import { type Block, blocksToHtml, blocksToText } from "./structure";

/** An entry of the PDF's outline, with the page its destination resolved to. */
export interface OutlineEntry {
  title: string;
  /** 0 for a chapter, 1 for a section in it */
  depth: number;
  /** 1-based; entries whose destination did not resolve are dropped before this point */
  page: number;
}

export interface Section {
  title: string;
  /** The chapter this section belongs to; grouping never crosses one. */
  chapter?: string;
  blocks: Block[];
}

export interface ReadingUnit {
  title: string;
  chapter?: string;
  content: string;
  contentHtml: string;
  wordCount: number;
  estimatedReadMinutes: number;
}

export const GROUP_MIN_TOKENS = 1_500;
export const GROUP_MAX_TOKENS = 4_000;
export const SPLIT_ABOVE_TOKENS = 6_000;
/** Parts a long section is cut into stay near this size. */
export const SPLIT_TARGET_TOKENS = 3_000;
const MERGE_HEADING_RUNS_UNDER_TOKENS = 300;
const EVEN_PART_TOKENS = 1_000;
const MAX_PARAGRAPH_CHARS = 8_000;
/** Text plus HTML of one stored unit; a row holds 1 MiB. */
export const MAX_UNIT_BYTES = 400_000;
const MAX_TITLE_CHARS = 120;
// Without an outline, headings are trusted only when they give a few units
const MIN_DETECTED_SECTIONS = 3;
// A rough count: no tokenizer ships in the backend, and sizes are only a guide
export const estimateTokens = (text: string) => Math.ceil(text.length / 4);

const blockTokens = (block: Block) => estimateTokens(block.text);
const sectionTokens = (section: Section) =>
  section.blocks.reduce((sum, block) => sum + blockTokens(block), 0);

/** Minutes to read `wordCount` words, at least one. */
export const minutesFor = (wordCount: number) =>
  Math.max(1, Math.ceil(wordCount / WORDS_PER_MINUTE));

export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

/**
 * Cuts text into pieces of at most `max` characters, at sentence ends where it
 * can, else at spaces, else anywhere.
 */
export function splitText(text: string, max: number): string[] {
  const pieces: string[] = [];
  let current = "";
  const close = () => {
    if (current.trim()) pieces.push(current.trim());
    current = "";
  };
  const sentences = text.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) ?? [text];
  for (const sentence of sentences) {
    if (sentence.length > max) {
      close();
      for (let rest = sentence; rest.length > 0; ) {
        let cut = Math.min(max, rest.length);
        if (cut < rest.length) {
          const space = rest.lastIndexOf(" ", cut);
          if (space > max / 2) cut = space;
        }
        pieces.push(rest.slice(0, cut).trim());
        rest = rest.slice(cut);
      }
      continue;
    }
    if (current.length + sentence.length > max) close();
    current += sentence;
  }
  close();
  return pieces.filter(Boolean);
}

/**
 * Cuts any block too big for a unit into smaller ones. A heading that long was
 * never a heading, so its pieces are paragraphs.
 */
export function splitHugeParagraphs(blocks: readonly Block[]): Block[] {
  return blocks.flatMap((block) =>
    block.text.length <= MAX_PARAGRAPH_CHARS
      ? [block]
      : splitText(block.text, MAX_PARAGRAPH_CHARS).map((text) => ({
          ...block,
          kind: "p" as const,
          text,
        })),
  );
}

const stripNumbering = (title: string) =>
  title
    .toLowerCase()
    .replace(/^\d+(\.\d+)*\.?\s*/, "")
    .slice(0, 25);

/**
 * Index of the block where an outline entry starts: the block on its page that
 * holds its heading text, else the first block on or after that page. Never
 * before `from`.
 */
function startOfEntry(
  blocks: readonly Block[],
  entry: OutlineEntry,
  from: number,
): number {
  const needle = stripNumbering(entry.title);
  if (needle) {
    for (let i = from; i < blocks.length; i++) {
      if (blocks[i].page > entry.page) break;
      if (
        blocks[i].page === entry.page &&
        blocks[i].text.toLowerCase().includes(needle)
      )
        return i;
    }
  }
  for (let i = from; i < blocks.length; i++)
    if (blocks[i].page >= entry.page) return i;
  return -1;
}

/** Sections cut at the entries of depth 0 and 1 of the PDF's outline. */
export function sectionsFromOutline(
  blocks: readonly Block[],
  outline: readonly OutlineEntry[],
): Section[] {
  const starts: { entry: OutlineEntry; at: number }[] = [];
  let from = 0;
  for (const entry of outline) {
    if (entry.depth > 1 || entry.page < 1) continue;
    // An entry that points back behind the one before it can't be placed
    if (entry.page < (starts.at(-1)?.entry.page ?? 0)) continue;
    const at = startOfEntry(blocks, entry, from);
    // An entry past the end of the text is dropped
    if (at < from || at === -1) continue;
    if (starts.length && at === starts.at(-1)?.at) continue;
    starts.push({ entry, at });
    from = at + 1;
  }
  if (!starts.length) return [];

  const sections: Section[] = [];
  let chapter: string | undefined;
  // Text before the first entry (cover, copyright) is kept only if it is a body of its own
  const opening = blocks.slice(0, starts[0].at);
  if (
    opening.reduce((sum, b) => sum + blockTokens(b), 0) >=
    MERGE_HEADING_RUNS_UNDER_TOKENS
  )
    sections.push({ title: "Opening", blocks: opening });
  for (const [i, { entry, at }] of starts.entries()) {
    if (entry.depth === 0) chapter = entry.title;
    const end = starts[i + 1]?.at ?? blocks.length;
    const own = blocks.slice(at, end);
    if (own.length) sections.push({ title: entry.title, chapter, blocks: own });
  }
  return sections;
}

/** Sections cut at detected headings; runs under 300 tokens merge into the next. */
export function sectionsFromHeadings(blocks: readonly Block[]): Section[] {
  const sections: Section[] = [];
  let current: Section | null = null;
  let chapter: string | undefined;
  const close = () => {
    if (current?.blocks.length) sections.push(current);
    current = null;
  };
  for (const block of blocks) {
    if (block.kind !== "p") {
      // Short runs are not emitted on their own: the next heading joins them
      if (current && sectionTokens(current) >= MERGE_HEADING_RUNS_UNDER_TOKENS)
        close();
      if (block.kind === "h1") chapter = block.text;
      if (!current) current = { title: block.text, chapter, blocks: [block] };
      else current.blocks.push(block);
    } else {
      if (!current) current = { title: "Opening", chapter, blocks: [] };
      current.blocks.push(block);
    }
  }
  close();
  return sections;
}

/** Paragraph-aligned parts of about a thousand tokens, titled "Part N". */
export function sectionsInEvenParts(blocks: readonly Block[]): Section[] {
  const sections: Section[] = [];
  let current: Block[] = [];
  let tokens = 0;
  const close = () => {
    if (current.length)
      sections.push({ title: `Part ${sections.length + 1}`, blocks: current });
    current = [];
    tokens = 0;
  };
  for (const block of blocks) {
    const size = blockTokens(block);
    if (tokens + size > EVEN_PART_TOKENS && current.length) close();
    current.push(block);
    tokens += size;
  }
  close();
  return sections;
}

/** Which of the three rules applies, in order of how well the structure is known. */
export function sectionDocument(
  blocks: readonly Block[],
  outline: readonly OutlineEntry[],
): { sections: Section[]; basis: "outline" | "headings" | "even" } {
  const prepared = splitHugeParagraphs(blocks);
  const fromOutline = sectionsFromOutline(prepared, outline);
  if (fromOutline.length >= 2)
    return { sections: fromOutline, basis: "outline" };
  const fromHeadings = sectionsFromHeadings(prepared);
  if (fromHeadings.length >= MIN_DETECTED_SECTIONS)
    return { sections: fromHeadings, basis: "headings" };
  return { sections: sectionsInEvenParts(prepared), basis: "even" };
}

/** Titles a section's parts "(part i of n)". */
function nameParts(
  title: string,
  chapter: string | undefined,
  parts: Block[][],
) {
  return parts.map((blocks, i) => ({
    title: `${title} (part ${i + 1} of ${parts.length})`,
    chapter,
    blocks,
  }));
}

/** Cuts one section over the limit into parts at paragraph boundaries. */
function splitSection(section: Section): Section[] {
  const total = sectionTokens(section);
  const per = total / Math.max(2, Math.ceil(total / SPLIT_TARGET_TOKENS));
  const parts: Block[][] = [[]];
  let tokens = 0;
  for (const block of section.blocks) {
    const size = blockTokens(block);
    // No ceiling on the number of parts: a paragraph never joins a part that is already full
    if (tokens + size > per && parts.at(-1)?.length) {
      parts.push([]);
      tokens = 0;
    }
    parts.at(-1)?.push(block);
    tokens += size;
  }
  return nameParts(section.title, section.chapter, parts);
}

const encoder = new TextEncoder();
/** What a unit costs in its row: its text plus its HTML. */
export function storedBytes(blocks: readonly Block[]): number {
  return (
    encoder.encode(blocksToText(blocks)).length +
    encoder.encode(blocksToHtml(blocks)).length
  );
}

/**
 * Splits any unit over MAX_UNIT_BYTES further, at paragraph boundaries, so no
 * row can reach the 1 MiB document limit however the structure came out.
 */
export function enforceByteBound(units: readonly Section[]): Section[] {
  return units.flatMap((unit) => {
    if (storedBytes(unit.blocks) <= MAX_UNIT_BYTES) return [unit];
    // Any block, of any kind, is cut to a size a unit can hold
    const blocks = splitHugeParagraphs(unit.blocks);
    const parts: Block[][] = [[]];
    let bytes = 0;
    for (const block of blocks) {
      const size = storedBytes([block]);
      if (bytes + size > MAX_UNIT_BYTES && parts.at(-1)?.length) {
        parts.push([]);
        bytes = 0;
      }
      parts.at(-1)?.push(block);
      bytes += size;
    }
    return nameParts(unit.title, unit.chapter, parts);
  });
}

/**
 * Groups consecutive small sections of one chapter into units of 1,500 to
 * 4,000 tokens, and splits any section over 6,000. A short remainder at the
 * end of a chapter joins the unit before it.
 */
export function groupSections(sections: readonly Section[]): Section[] {
  const units: Section[] = [];
  // The unit being built, kept as plain state so no closure hides its type
  let title = "";
  let chapter: string | undefined;
  let blocks: Block[] = [];
  let tokens = 0;

  const emit = () => {
    if (blocks.length) units.push({ title, chapter, blocks });
    blocks = [];
    tokens = 0;
  };
  const endChapter = () => {
    const before = units.at(-1);
    if (
      blocks.length &&
      tokens < GROUP_MIN_TOKENS / 2 &&
      before &&
      before.chapter === chapter &&
      sectionTokens(before) + tokens <= SPLIT_ABOVE_TOKENS
    ) {
      before.blocks = [...before.blocks, ...blocks];
      blocks = [];
      tokens = 0;
    }
    emit();
  };

  for (const section of sections) {
    if (blocks.length && section.chapter !== chapter) endChapter();
    const size = sectionTokens(section);
    if (size > SPLIT_ABOVE_TOKENS) {
      endChapter();
      units.push(...splitSection(section));
      continue;
    }
    if (blocks.length && tokens + size > GROUP_MAX_TOKENS) emit();
    if (!blocks.length) {
      title = section.title;
      chapter = section.chapter;
    }
    blocks.push(...section.blocks);
    tokens += size;
    if (tokens >= GROUP_MIN_TOKENS) emit();
  }
  endChapter();
  return units;
}

/** Reading units with their text, HTML and length, ready to store. */
export function toReadingUnits(sections: readonly Section[]): ReadingUnit[] {
  return sections.map((section) => {
    const first = section.blocks[0];
    const title = section.title.slice(0, MAX_TITLE_CHARS);
    // A unit that doesn't open on a heading gets its title as one
    const blocks: Block[] =
      first && first.kind !== "p"
        ? section.blocks
        : [
            { kind: "h2", text: title, page: first?.page ?? 1 },
            ...section.blocks,
          ];
    const content = blocksToText(blocks);
    const wordCount = countWords(content);
    return {
      title,
      chapter: section.chapter?.slice(0, MAX_TITLE_CHARS),
      content,
      contentHtml: blocksToHtml(blocks),
      wordCount,
      estimatedReadMinutes: minutesFor(wordCount),
    };
  });
}

/** The whole path from blocks and outline to the units of a book. */
export function readingUnitsOf(
  blocks: readonly Block[],
  outline: readonly OutlineEntry[],
) {
  const { sections, basis } = sectionDocument(blocks, outline);
  return {
    units: toReadingUnits(enforceByteBound(groupSections(sections))),
    basis,
  };
}
