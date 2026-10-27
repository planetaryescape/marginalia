import { describe, expect, it } from "vitest";
import { findings, selection } from "../../test/scriptureStudy";
import type { StudyEvidence, StudyResult } from "./scriptureStudy";
import { reviewStudyDraft } from "./scriptureStudyGeneration";

const finding = findings[0];
const draft: StudyResult = {
  findings: [
    { ...finding, lens: "literary", evidenceIds: ["notes-not-evidence"] },
  ],
};
const verses = [
  { id: "JHN.1.1", text: "Public WEB verse one" },
  { id: "JHN.1.2", text: "Public WEB verse two" },
];
const evidence: StudyEvidence = {
  evidenceId: "web-1",
  referenceKey: selection.referenceKey,
  locator: selection.referenceKey,
  excerpt: "JHN.1.1 Public WEB verse one\nJHN.1.2 Public WEB verse two",
  contentHash: "fixture",
  retrievedAt: 0,
  limitations: [],
  source: {
    id: "web",
    title: "World English Bible",
    revision: "fixture",
    rights: "Public domain",
    licenseUrl: "https://worldenglish.bible/",
    attribution: "WEB",
    url: "https://bible-api.com/data/web/JHN/1",
    capabilities: ["passage_text"],
  },
};
describe("mechanical citation correction is not a weaker validator", () => {
  it("does not rescue invented citations by attaching an otherwise valid WEB anchor", () => {
    const result = reviewStudyDraft(draft, [evidence], verses, selection);
    expect(result.draft.findings[0].evidenceIds).toEqual([
      "notes-not-evidence",
      "web-1",
    ]);
    expect(result.accepted.findings).toEqual([]);
    expect(result.feedback[0].code).toBe("unknown_evidence");
    expect(draft.findings[0].evidenceIds).toEqual(["notes-not-evidence"]);
  });
  it("does not guess between two matching selected-source evidence items", () => {
    const result = reviewStudyDraft(
      draft,
      [evidence, { ...evidence, evidenceId: "web-duplicate" }],
      verses,
      selection,
    );
    expect(result.correctedCitations).toBe(0);
    expect(result.accepted.findings).toEqual([]);
    expect(result.feedback[0].code).toBe("missing_web_anchor");
  });
  it("does not use a matching quotation in another passage as a selected anchor", () => {
    const result = reviewStudyDraft(
      { findings: [{ ...draft.findings[0], evidenceIds: ["web-1"] }] },
      [{ ...evidence, referenceKey: "ROM.8.1" }],
      verses,
      selection,
    );
    expect(result.correctedCitations).toBe(0);
    expect(result.accepted.findings).toEqual([]);
  });
  it("rejects duplicate finding identities while retaining the first verified finding", () => {
    const valid = { ...draft.findings[0], evidenceIds: ["web-1"] };
    const result = reviewStudyDraft(
      { findings: [valid, valid] },
      [evidence],
      verses,
      selection,
    );
    expect(result.accepted.findings).toHaveLength(1);
    expect(result.feedback).toEqual([
      expect.objectContaining({ code: "invalid_anchor" }),
    ]);
  });
});
