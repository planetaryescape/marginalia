// Pure placement of margin notes (S2 in docs/design/blueprint/09-open-questions.md).
// The DOM side only measures anchors and heights and applies the result.

export const NOTE_GAP = 8;
/** Notes whose lines sit this close share one stacked box and one connector. */
export const MERGE_WITHIN = 40;
/** A note pushed further than this below its line collapses to one line. */
export const COLLAPSE_AFTER = 240;
/** Space between notes stacked in the same box. */
export const STACK_GAP = 6;

export interface LayoutNote {
  id: string;
  /** Top of the line the note belongs to. */
  anchor: number;
  /** Height of the note at its three-line clamp. */
  height: number;
  /** Height of the note when it is a single line. */
  collapsedHeight: number;
  /** Notes only merge with notes written by the same hand (pencil or pen). */
  hand?: string;
  /** False for notes that always stand alone, like the waiting line. */
  mergeable?: boolean;
}

export interface Placement {
  id: string;
  top: number;
  anchor: number;
  collapsed: boolean;
  /** Only the first note in a stacked box draws the connector. */
  connector: boolean;
  /** How far below its line the box sits; the connector bends by this much. */
  elbow: number;
}

interface Group {
  anchor: number;
  members: LayoutNote[];
}

function groupNotes(sorted: LayoutNote[]): Group[] {
  const groups: Group[] = [];
  for (const note of sorted) {
    const current = groups[groups.length - 1];
    const first = current?.members[0];
    if (
      current &&
      first &&
      note.mergeable !== false &&
      first.mergeable !== false &&
      note.hand === first.hand &&
      note.anchor - current.anchor <= MERGE_WITHIN
    ) {
      current.members.push(note);
    } else {
      groups.push({ anchor: note.anchor, members: [note] });
    }
  }
  return groups;
}

function groupHeight(group: Group, collapsed: boolean): number {
  const heights = group.members.map((m) =>
    collapsed ? m.collapsedHeight : m.height,
  );
  return (
    heights.reduce((sum, h) => sum + h, 0) +
    STACK_GAP * (group.members.length - 1)
  );
}

interface PlacedGroup {
  group: Group;
  top: number;
  collapsed: boolean;
  height: number;
}

function isOpen(group: Group, openId: string | undefined): boolean {
  return group.members.some((m) => m.id === openId);
}

function place(
  groups: Group[],
  forced: ReadonlySet<Group>,
  openId: string | undefined,
): PlacedGroup[] {
  let previousBottom = Number.NEGATIVE_INFINITY;
  return groups.map((group) => {
    const top = Math.max(group.anchor, previousBottom + NOTE_GAP);
    // The open note is the card: it keeps its height however far it is pushed.
    const collapsed =
      !isOpen(group, openId) &&
      (forced.has(group) || top - group.anchor > COLLAPSE_AFTER);
    const height = groupHeight(group, collapsed);
    previousBottom = top + height;
    return { group, top, collapsed, height };
  });
}

/**
 * Places notes in anchor order, each at `max(anchor, previousBottom + 8)`.
 * Notes within 40px of each other merge into one box, a note pushed more than
 * 240px collapses to a line, and if the stack would end more than one note
 * below `contentEnd`, every other displaced note collapses too. The open note
 * (`openId`) is never merged or collapsed; it takes its open height in the
 * stack, so notes below it move down and notes above it stay put.
 */
export function layoutMargin(
  notes: LayoutNote[],
  options: { contentEnd?: number; openId?: string } = {},
): Placement[] {
  // Array.sort is stable, so equal anchors keep the order they came in.
  const sorted = [...notes].sort((a, b) => a.anchor - b.anchor);
  const groups = groupNotes(sorted);
  const { openId } = options;
  let placed = place(groups, new Set(), openId);

  const last = placed[placed.length - 1];
  if (last && options.contentEnd !== undefined) {
    const fullHeight = groupHeight(last.group, false);
    if (last.top + last.height > options.contentEnd + fullHeight) {
      const displaced = new Set(
        placed
          .filter((p) => p.top - p.group.anchor > 1 && !isOpen(p.group, openId))
          .map((p) => p.group),
      );
      placed = place(groups, displaced, openId);
    }
  }

  return placed.flatMap(({ group, top, collapsed }) => {
    let offset = 0;
    return group.members.map((note, index) => {
      const placement: Placement = {
        id: note.id,
        top: top + offset,
        anchor: note.anchor,
        collapsed,
        connector: index === 0,
        elbow: Math.max(0, top - group.anchor),
      };
      offset += (collapsed ? note.collapsedHeight : note.height) + STACK_GAP;
      return placement;
    });
  });
}
