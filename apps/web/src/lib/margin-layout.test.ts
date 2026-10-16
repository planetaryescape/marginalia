import { describe, expect, it } from "vitest";
import {
  COLLAPSE_AFTER,
  type LayoutNote,
  layoutMargin,
  NOTE_GAP,
  STACK_GAP,
} from "./margin-layout";
import { marginModeFor } from "./margin-mode";

const note = (id: string, anchor: number, extra: Partial<LayoutNote> = {}) => ({
  id,
  anchor,
  height: 70,
  collapsedHeight: 20,
  hand: "pencil",
  ...extra,
});
const byId = (notes: LayoutNote[], contentEnd?: number) =>
  Object.fromEntries(layoutMargin(notes, { contentEnd }).map((p) => [p.id, p]));

describe("layoutMargin", () => {
  it("leaves notes at their lines when they clear each other", () => {
    const p = byId([note("a", 100), note("b", 400)]);
    expect(p.a).toMatchObject({ top: 100, elbow: 0, collapsed: false });
    expect(p.b).toMatchObject({ top: 400, elbow: 0 });
  });

  it("pushes a later note below the one above with an 8px gap and bends its connector", () => {
    const p = byId([note("a", 100), note("b", 201)]);
    // a ends at 170; 170 + 8 = 178 < 201, so b stays on its line
    expect(p.b.top).toBe(201);
    const q = byId([note("a", 100), note("b", 150)]);
    // 50px apart is outside the 40px merge range, so these are separate boxes
    expect(q.b.top).toBe(100 + 70 + NOTE_GAP);
    expect(q.b.elbow).toBe(28);
    expect(q.b.connector).toBe(true);
  });

  it("places in anchor order whatever order the notes arrive in", () => {
    const p = byId([note("late", 500), note("early", 100), note("mid", 300)]);
    expect(p.early.top).toBe(100);
    expect(p.mid.top).toBe(300);
    expect(p.late.top).toBe(500);
  });

  it("keeps input order for equal anchors (stable ties)", () => {
    const placements = layoutMargin([
      note("first", 100, { hand: "pen" }),
      note("second", 100, { hand: "pencil" }),
    ]);
    expect(placements.map((p) => p.id)).toEqual(["first", "second"]);
    expect(placements[1].top).toBe(100 + 70 + NOTE_GAP);
  });

  it("merges notes within 40px into one stack with one connector", () => {
    const placements = layoutMargin([
      note("a", 100),
      note("b", 140),
      note("c", 140),
    ]);
    expect(placements.map((p) => p.connector)).toEqual([true, false, false]);
    expect(placements.map((p) => p.top)).toEqual([
      100,
      100 + 70 + STACK_GAP,
      100 + 2 * (70 + STACK_GAP),
    ]);
    expect(new Set(placements.map((p) => p.elbow))).toEqual(new Set([0]));
  });

  it("does not chain merges beyond 40px from the first note", () => {
    const placements = layoutMargin([
      note("a", 100),
      note("b", 135),
      note("c", 170),
    ]);
    expect(placements.map((p) => p.connector)).toEqual([true, false, true]);
  });

  it("does not merge across hands or with unmergeable notes", () => {
    const p = layoutMargin([
      note("a", 100),
      note("mine", 110, { hand: "pen" }),
      note("wait", 120, { mergeable: false }),
    ]);
    expect(p.map((x) => x.connector)).toEqual([true, true, true]);
    expect(p[1].top).toBe(100 + 70 + NOTE_GAP);
  });

  it("collapses a note pushed more than 240px and frees its neighbours", () => {
    // Chain of notes 50px apart: each is pushed 28 further than the last.
    const notes = Array.from({ length: 12 }, (_, i) =>
      note(`n${i}`, 100 + i * 50),
    );
    const placements = layoutMargin(notes);
    const firstCollapsed = placements.findIndex((p) => p.collapsed);
    expect(firstCollapsed).toBeGreaterThan(0);
    for (const p of placements.slice(0, firstCollapsed)) {
      expect(p.top - p.anchor).toBeLessThanOrEqual(COLLAPSE_AFTER);
    }
    expect(
      placements[firstCollapsed].top - placements[firstCollapsed].anchor,
    ).toBeGreaterThan(COLLAPSE_AFTER);
    // The next note starts below the collapsed line (20px), not below 70px.
    const after = placements[firstCollapsed + 1];
    expect(after.top).toBe(placements[firstCollapsed].top + 20 + NOTE_GAP);
  });

  it("does not collapse a note displaced exactly 240px", () => {
    const p = byId([
      note("a", 0, { height: 240 - NOTE_GAP + 0 }),
      note("b", 50),
    ]);
    // a ends at 232, b starts at 240: displacement 190, below the threshold
    expect(p.b.collapsed).toBe(false);
    const q = byId([note("a", 0, { height: 300 }), note("b", 50)]);
    expect(q.b.top - q.b.anchor).toBe(258);
    expect(q.b.collapsed).toBe(true);
  });

  it("collapses remaining displaced notes when the stack would hang below the article", () => {
    const notes = Array.from({ length: 6 }, (_, i) => note(`n${i}`, i * 45));
    const without = layoutMargin(notes);
    const contentEnd = 100;
    const bottom = (ps: ReturnType<typeof layoutMargin>) => {
      const l = ps[ps.length - 1];
      return l.top + (l.collapsed ? 20 : 70);
    };
    expect(bottom(without)).toBeGreaterThan(contentEnd + 70);
    const fitted = layoutMargin(notes, { contentEnd });
    expect(fitted[0].collapsed).toBe(false);
    expect(fitted.slice(1).every((p) => p.collapsed)).toBe(true);
    expect(bottom(fitted)).toBeLessThan(bottom(without));
  });

  it("leaves a stack that ends within one note-height of the article end alone", () => {
    const notes = [note("a", 0), note("b", 45)];
    const placements = layoutMargin(notes, { contentEnd: 90 });
    expect(placements.every((p) => !p.collapsed)).toBe(true);
  });

  it("does not collapse notes that sit on their lines when the end rule fires", () => {
    const placements = layoutMargin(
      [note("a", 0), note("b", 45), note("c", 1000)],
      { contentEnd: 10 },
    );
    expect(placements.find((p) => p.id === "a")?.collapsed).toBe(false);
    expect(placements.find((p) => p.id === "c")?.collapsed).toBe(false);
  });

  it("returns nothing for no notes", () => {
    expect(layoutMargin([])).toEqual([]);
  });
});

describe("marginModeFor", () => {
  it("uses sidenotes at 300px of gutter or more", () => {
    expect(marginModeFor(1440, 408)).toBe("sidenotes");
    expect(marginModeFor(1280, 300)).toBe("sidenotes");
  });
  it("falls back to the card when the gutter is narrow", () => {
    expect(marginModeFor(1280, 299)).toBe("sheet");
    expect(marginModeFor(900, 120)).toBe("sheet");
  });
  it("is phone below 640px whatever the gutter", () => {
    expect(marginModeFor(390, 400)).toBe("phone");
    expect(marginModeFor(640, 400)).toBe("sidenotes");
  });
});
