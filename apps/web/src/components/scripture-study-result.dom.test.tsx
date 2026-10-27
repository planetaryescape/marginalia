// @vitest-environment happy-dom
import type {
  StudyEvidence,
  StudyFinding,
} from "@marginalia/backend/scripture-study";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ScriptureStudyEvidence,
  ScriptureStudyResult,
  studyReferenceLabel,
} from "./scripture-study-result";

const finding: StudyFinding = {
  findingId: "address-shift",
  lens: "literary",
  anchor: {
    verseId: "PSA.23.4",
    referenceKey: "PSA.23.4-PSA.23.6",
    quote: "you are with me",
  },
  observation: "The speaker turns from description to direct address.",
  consequence:
    "The danger is addressed in the presence of the shepherd, rather than denied.",
  interpretations: [],
  evidenceIds: ["web-selection"],
  limitations: [
    "This is a literary observation, not a claim about every reading.",
  ],
  relatedPassages: [
    {
      evidenceId: "web-related",
      referenceKey: "JHN.10.11",
      relation: "thematic_parallel",
      explanation: "The shepherd image also appears here.",
    },
  ],
};
const evidence: StudyEvidence = {
  evidenceId: "web-selection",
  referenceKey: "PSA.23.4-PSA.23.6",
  locator: "Psalms 23:4–6",
  excerpt: "you are with me",
  contentHash: "fixture-hash",
  retrievedAt: 1,
  source: {
    id: "web",
    title: "World English Bible",
    revision: "fixture",
    rights: "Public domain",
    licenseUrl: "https://worldenglish.bible/",
    attribution: "World English Bible",
    url: "https://worldenglish.bible/",
    capabilities: ["passage_text"],
  },
  limitations: ["No English/original-word alignment."],
};
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
function button(text: string) {
  const match = [...host.querySelectorAll("button")].find((node) =>
    node.textContent?.includes(text),
  );
  if (!match) throw new Error(`Missing button: ${text}`);
  return match;
}

describe("Study findings stay in the reading", () => {
  it("opens saved evidence only on demand and jumps to the actual anchor", () => {
    const inspect = vi.fn(() => <ScriptureStudyEvidence evidence={evidence} />);
    const jump = vi.fn();
    act(() =>
      root.render(
        <ScriptureStudyResult
          findings={[finding]}
          outcome="findings"
          renderEvidence={inspect}
          onAnchor={jump}
          onKeep={vi.fn()}
        />,
      ),
    );
    expect(inspect).not.toHaveBeenCalled();
    act(() => button("you are with me").click());
    expect(jump).toHaveBeenCalledWith("PSA.23.4");
    const disclosure = host.querySelector("details");
    if (!disclosure) throw new Error("Missing evidence disclosure");
    act(() => {
      disclosure.open = true;
      disclosure.dispatchEvent(new Event("toggle"));
    });
    expect(inspect).toHaveBeenCalledWith("web-selection");
    expect(host.textContent).toContain("Public domain");
    expect(host.textContent).toContain("No English/original-word alignment.");
  });

  it("keeps a related reference explicitly, retains it on failure, and converges after retry", async () => {
    const keep = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(undefined);
    act(() =>
      root.render(
        <ScriptureStudyResult
          findings={[finding]}
          outcome="findings"
          renderEvidence={() => null}
          onAnchor={vi.fn()}
          onKeep={keep}
        />,
      ),
    );
    expect(keep).not.toHaveBeenCalled();
    await act(async () => button("Keep for later").click());
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "Your reading has not moved",
    );
    expect(host.textContent).toContain("John 10:11");
    await act(async () => button("Retry").click());
    expect(keep).toHaveBeenNthCalledWith(2, "address-shift", "JHN.10.11");
    expect(host.textContent).toContain("Kept");
    expect(
      [...host.querySelectorAll("button")].some(
        (node) => node.textContent === "Keep for later",
      ),
    ).toBe(false);
  });

  it("renders source and model text as text, never executable markup", () => {
    act(() =>
      root.render(
        <>
          <ScriptureStudyEvidence
            evidence={{
              ...evidence,
              excerpt: '<img src=x onerror="alert(1)">',
            }}
          />
          <ScriptureStudyResult
            findings={[{ ...finding, observation: "<script>bad()</script>" }]}
            outcome="partial"
            renderEvidence={() => null}
            onAnchor={vi.fn()}
            onKeep={vi.fn()}
          />
        </>,
      ),
    );
    expect(host.querySelector("script, img")).toBeNull();
    expect(host.textContent).toContain('<img src=x onerror="alert(1)">');
    expect(host.textContent).toContain("<script>bad()</script>");
  });

  it("distinguishes insufficient evidence from no substantive finding", () => {
    const props = {
      findings: [],
      renderEvidence: () => null,
      onAnchor: vi.fn(),
      onKeep: vi.fn(),
    };
    act(() =>
      root.render(
        <ScriptureStudyResult {...props} outcome="insufficient_evidence" />,
      ),
    );
    expect(host.textContent).toContain("not enough verified evidence");
    act(() =>
      root.render(
        <ScriptureStudyResult {...props} outcome="no_meaningful_findings" />,
      ),
    );
    expect(host.textContent).toContain("No additional substantive finding");
    expect(host.textContent).toContain("not everything that has been written");
  });

  it("labels canonical same-chapter ranges without changing their identity", () => {
    expect(studyReferenceLabel("PSA.23.4-PSA.23.6")).toBe("Psalms 23:4–6");
    expect(studyReferenceLabel("JHN.1.18")).toBe("John 1:18");
    expect(studyReferenceLabel("constructor")).toBe("constructor");
  });
});
