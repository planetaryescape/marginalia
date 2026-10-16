import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SettingsSection } from "./settings-section";

describe("SettingsSection", () => {
  it("renders quiet, progress and failed statuses with their own dot colour", () => {
    const quiet = renderToStaticMarkup(
      <SettingsSection title="T" status={{ tone: "quiet", label: "Synced" }} />,
    );
    expect(quiet).toContain("Synced");
    expect(quiet).not.toContain("--danger");
    expect(quiet).not.toContain("animate-pulse");

    const progress = renderToStaticMarkup(
      <SettingsSection
        title="T"
        status={{ tone: "progress", label: "Syncing" }}
      />,
    );
    // Pulses only when the user allows motion
    expect(progress).toContain("motion-safe:animate-pulse");

    const failed = renderToStaticMarkup(
      <SettingsSection
        title="T"
        status={{ tone: "failed", label: "Failed" }}
      />,
    );
    expect(failed).toContain("bg-[var(--danger)]");
    expect(failed).toContain('role="alert"');
  });

  it("puts technical detail behind a Details disclosure", () => {
    const html = renderToStaticMarkup(
      <SettingsSection title="T" details={<p>12 documents checked</p>}>
        <button type="button">Sync now</button>
      </SettingsSection>,
    );
    expect(html).toContain("<details");
    expect(html).toContain("Details ▸");
    expect(html).toContain("12 documents checked");
  });

  it("omits Details when there is none", () => {
    const html = renderToStaticMarkup(<SettingsSection title="T" />);
    expect(html).not.toContain("<details");
  });
});
