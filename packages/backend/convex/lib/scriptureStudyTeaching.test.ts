import { expect, it } from "vitest";
import { findings, selection, teaching } from "../../test/scriptureStudy";
import {
  resultSchema,
  type StudyEvidence,
  studyCoverage,
  validateResult,
} from "./scriptureStudy";
import { reviewStudyDraft } from "./scriptureStudyGeneration";

it("does not describe a published application or same-chapter connection as unassessed", () => {
  const draft = valid();
  const coverage = studyCoverage(draft.findings, [evidence], draft.teaching);
  expect(coverage.find((row) => row.lens === "hermeneutics")).toMatchObject({
    status: "findings",
  });
  const withinChapter = studyCoverage(
    [{ ...draft.findings[0], lens: "intertextual_canonical" }],
    [evidence],
  );
  expect(
    withinChapter.find((row) => row.lens === "intertextual_canonical"),
  ).toMatchObject({ status: "findings" });
  expect(
    withinChapter.find((row) => row.lens === "intertextual_canonical")?.reason,
  ).not.toContain("not assessed");
});

const evidence: StudyEvidence = {
  evidenceId: "web-1",
  referenceKey: selection.referenceKey,
  locator: selection.referenceKey,
  excerpt: "Public WEB verse one",
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
const verses = [{ id: "JHN.1.1", text: "Public WEB verse one" }];
const valid = () => resultSchema.parse({ findings, teaching });
it("validates the connected teaching as well as the individual anchored findings", () => {
  expect(
    validateResult(valid(), [evidence], verses, selection).teaching,
  ).toEqual(teaching);
  const draft = valid();
  if (!draft.teaching) throw new Error("Missing fixture teaching");
  draft.teaching.application.principle.evidenceIds = ["reader-note-1"];
  expect(() => validateResult(draft, [evidence], verses, selection)).toThrow(
    "Unknown evidence",
  );
  const review = reviewStudyDraft(draft, [evidence], verses, selection);
  expect(review.feedback).toMatchObject([{ code: "unknown_evidence" }]);
  expect(review.accepted).not.toHaveProperty("teaching");
});
it("requires WEB grounding even if a teaching paragraph cites a real dictionary", () => {
  const draft = valid();
  if (!draft.teaching) throw new Error("Missing fixture teaching");
  draft.teaching.centralReading.evidenceIds = ["lexicon"];
  expect(() =>
    validateResult(
      draft,
      [
        evidence,
        {
          ...evidence,
          evidenceId: "lexicon",
          source: { ...evidence.source, id: "strongs" },
        },
      ],
      verses,
      selection,
    ),
  ).toThrow("cite supplied WEB");
});
it("never retains a teaching alongside an omitted supporting step", () => {
  const draft = valid();
  draft.findings.push({
    ...draft.findings[0],
    findingId: "unsupported",
    evidenceIds: ["invented"],
  });
  const result = reviewStudyDraft(draft, [evidence], verses, selection);
  expect(result.accepted.findings).toHaveLength(1);
  expect(result.accepted.teaching).toBeUndefined();
  expect(result.feedback).toMatchObject([
    { findingId: "unsupported", code: "unknown_evidence" },
  ]);
});
it("allows no modern illustration and rejects application derived from a nonexistent step", () => {
  const draft = valid();
  if (!draft.teaching) throw new Error("Missing fixture teaching");
  draft.teaching.application.today = null;
  expect(
    validateResult(draft, [evidence], verses, selection).teaching?.application
      .today,
  ).toBeNull();
  draft.teaching.application.derivedFromFindingIds = ["invented-step"];
  expect(() => validateResult(draft, [evidence], verses, selection)).toThrow(
    "derive from verified",
  );
});
