import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SyncBar } from "./sync-bar";

describe("sync progress", () => {
  it("names unknown progress without inventing a percentage", () => {
    const html = renderToStaticMarkup(
      <SyncBar label="Checking feeds" text="Checking feeds…" />,
    );
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-label="Checking feeds"');
    expect(html).toContain("Checking feeds…</p>");
    expect(html).not.toContain("aria-valuenow");
  });

  it("exposes a real percentage and fills by that amount", () => {
    const html = renderToStaticMarkup(
      <SyncBar
        label="Checking feeds"
        value={50}
        text="3 of 6 sources processed"
      />,
    );
    expect(html).toContain('aria-valuenow="50"');
    expect(html).toContain('aria-valuemax="100"');
    expect(html).toContain('aria-valuetext="3 of 6 sources processed"');
    expect(html).toContain("scaleX(0.5)");
  });

  it.each([
    [120, 100],
    [-10, 0],
  ])("clamps an out-of-range percentage %s to %s", (value, expected) => {
    expect(
      renderToStaticMarkup(<SyncBar label="Checking feeds" value={value} />),
    ).toContain(`aria-valuenow="${expected}"`);
  });

  it("treats an invalid measurement as unknown", () => {
    expect(
      renderToStaticMarkup(
        <SyncBar label="Checking feeds" value={Number.NaN} />,
      ),
    ).not.toContain("aria-valuenow");
  });
});
