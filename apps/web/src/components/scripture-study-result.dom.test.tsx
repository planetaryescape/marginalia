// @vitest-environment happy-dom
import type {
  StudyEvidence,
  StudyFinding,
  StudyTeaching,
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
  it("reads as one study with visible interpretation and application, and one named Sources disclosure", () => {
    const p = (text: string) => ({ text, evidenceIds: ["web-selection"] });
    const teaching: StudyTeaching = {
      title: "Presence amid danger",
      centralReading: p(
        "The psalm finds confidence in presence, not an absence of danger.",
      ),
      context: p(
        "The speaker's description becomes a direct address to the shepherd.",
      ),
      application: {
        principle: p(
          "The address grounds confidence in the shepherd's presence.",
        ),
        today:
          "A reader might pray honestly about fear rather than pretend it is absent.",
        boundary: p(
          "The valley is still present; this does not promise a life without danger.",
        ),
        derivedFromFindingIds: ["address-shift"],
      },
    };
    const inspect = vi.fn(() => <ScriptureStudyEvidence evidence={evidence} />);
    act(() =>
      root.render(
        <ScriptureStudyResult
          findings={[
            {
              ...finding,
              heading: "From description to prayer",
              interpretations: [
                {
                  position:
                    "A supplied source understands this as direct address.",
                  evidenceIds: ["commentary-note"],
                  limitations: ["Only one commentary position was supplied."],
                },
              ],
            },
          ]}
          teaching={teaching}
          sources={[
            {
              evidenceId: "web-selection",
              title: "World English Bible",
              referenceKey: "PSA.23.4-PSA.23.6",
            },
            {
              evidenceId: "commentary-note",
              title: "Aquifer Open Study Notes",
              referenceKey: "PSA.23.4",
            },
          ]}
          outcome="findings"
          renderEvidence={inspect}
          onAnchor={vi.fn()}
          onKeep={vi.fn()}
        />,
      ),
    );
    expect(host.querySelectorAll("details")).toHaveLength(1);
    expect(host.querySelector("summary")?.textContent).toBe("Sources");
    expect(host.querySelector("details")?.open).toBe(false);
    expect(host.querySelector("h2")?.textContent).toBe("Presence amid danger");
    expect(
      host.querySelector('[aria-label="Reading this passage today"]')
        ?.textContent,
    ).toContain("this does not promise a life without danger");
    expect(
      host
        .querySelector('[aria-label="Literary shape"]')
        ?.querySelector("details"),
    ).toBeNull();
    expect(host.textContent).toContain(
      "Only one commentary position was supplied",
    );
    expect(host.textContent).not.toContain("commentary-note");
    expect(inspect).not.toHaveBeenCalled();
    const citation = host.querySelector<HTMLButtonElement>(
      'button[aria-label="Source 2: Aquifer Open Study Notes · Psalms 23:4"]',
    );
    expect(citation).not.toBeNull();
    act(() => citation?.click());
    expect(host.querySelector("details")?.open).toBe(true);
    expect(inspect).toHaveBeenCalledWith("commentary-note");
  });
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
  it("does not render an empty Sources drawer or source zero when a saved source is unavailable", () => {
    act(() =>
      root.render(
        <ScriptureStudyResult
          findings={[]}
          outcome="insufficient_evidence"
          onAnchor={vi.fn()}
          onKeep={vi.fn()}
          renderEvidence={() => null}
          renderFollowUps={(citations) => (
            <div>{citations(["missing-source"])}</div>
          )}
        />,
      ),
    );
    expect(host.querySelector("details")).toBeNull();
    expect(host.textContent).not.toContain("[0]");
    expect(host.textContent).toContain("Saved source unavailable");
  });
});
