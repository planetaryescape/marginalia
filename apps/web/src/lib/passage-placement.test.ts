import { describe, expect, it } from "vitest";
import { passagePlacement } from "./passage-placement";

describe("mobile passage menu", () => {
  it("anchors above the highlighted passage when there's space", () => {
    expect(
      passagePlacement(
        { top: 450, bottom: 480, left: 40, width: 210 },
        { width: 390, height: 844, top: 0 },
        { width: 276, height: 192 },
      ),
    ).toMatchObject({ top: 242, below: false, mobile: true });
  });
  it("anchors below selections near the top and stays inside screen edges", () => {
    const p = passagePlacement(
      { top: 70, bottom: 110, left: 0, width: 20 },
      { width: 320, height: 568, top: 0 },
      { width: 276, height: 192 },
    );
    expect(p).toMatchObject({ top: 126, left: 150, below: true });
  });
  it("keeps the Ask editor above the mobile keyboard in the visual viewport", () => {
    const p = passagePlacement(
      { top: 480, bottom: 510, left: 300, width: 60 },
      { width: 390, height: 360, top: 100 },
      { width: 276, height: 240 },
    );
    expect(p.top).toBeGreaterThanOrEqual(168);
    expect(p.top + 240).toBeLessThanOrEqual(448);
    expect(p.left + 138).toBeLessThanOrEqual(378);
  });
});
