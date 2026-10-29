import { convexToJson } from "convex/values";
import { expect, it } from "vitest";
import type { StudyEvidence } from "./scriptureStudy";
import {
  evidenceVerses,
  followUpEvidenceIdentity,
  followUpReference,
} from "./scriptureStudyFollowUpEvidence";
import { validateFollowUpAnswer } from "./scriptureStudyFollowUpValidation";
import { sha256Hex } from "./tokens";

async function evidence(
  excerpt = "GAL.5.13 Through love be servants to one another.",
  referenceKey = "GAL.5.13",
): Promise<StudyEvidence> {
  const item = {
    referenceKey,
    locator: referenceKey,
    excerpt,
    source: {
      id: "web",
      title: "World English Bible",
      revision: "bible-api WEB response",
      rights: "Public domain",
      licenseUrl: "https://worldenglish.bible/",
      attribution:
        "World English Bible (WEB). Public domain. Text from bible-api.com.",
      url: "https://bible-api.com/data/web/GAL/5",
      capabilities: ["passage_text"],
    },
    limitations: ["WEB wording only."],
    retrievedAt: Date.now() - 1000,
  };
  return {
    ...item,
    evidenceId: await followUpEvidenceIdentity(item),
    contentHash: await sha256Hex(item.excerpt),
  };
}
it("retains citation identity across Convex key ordering and repeated retrieval timestamps", async () => {
  const original = await evidence();
  // Convex sorts keys on the wire; IDs must use a deliberate provenance order.
  const reordered = {
    ...original,
    source: {
      capabilities: original.source.capabilities,
      url: original.source.url,
      attribution: original.source.attribution,
      licenseUrl: original.source.licenseUrl,
      rights: original.source.rights,
      revision: original.source.revision,
      title: original.source.title,
      id: original.source.id,
    },
    retrievedAt: Date.now(),
  };
  expect(await followUpEvidenceIdentity(reordered)).toBe(original.evidenceId);
  const result = await validateFollowUpAnswer({
    answer: {
      answer: "This verse directs freedom toward loving service.",
      evidenceCoverage: "in_saved_sources",
      evidenceIds: [original.evidenceId],
    },
    baseEvidence: [],
    carriedEvidence: [original],
    additionalEvidence: [reordered],
    sourceOutcomes: [
      {
        requestedReference: "Galatians 5:13",
        referenceKey: "GAL.5.13",
        status: "retrieved",
        evidenceIds: [original.evidenceId],
      },
    ],
  });
  expect(result.evidenceSetHash).toBe(
    await sha256Hex(JSON.stringify(convexToJson([original]))),
  );
});
it("rejects changed content, forged IDs, wrong reference coverage and unqualified retrieval failures", async () => {
  const item = await evidence();
  const args = {
    answer: {
      answer: "A qualified reading.",
      evidenceCoverage: "in_saved_sources",
      evidenceIds: [item.evidenceId],
    },
    baseEvidence: [],
    carriedEvidence: [],
    additionalEvidence: [item],
    sourceOutcomes: [
      {
        requestedReference: "Galatians 5:13",
        referenceKey: "GAL.5.13",
        status: "retrieved" as const,
        evidenceIds: [item.evidenceId],
      },
    ],
  };
  await expect(
    validateFollowUpAnswer({
      ...args,
      additionalEvidence: [{ ...item, excerpt: "GAL.5.13 Invented wording." }],
    }),
  ).rejects.toThrow("Invalid additional");
  await expect(
    validateFollowUpAnswer({
      ...args,
      additionalEvidence: [{ ...item, evidenceId: "invented" }],
    }),
  ).rejects.toThrow("Invalid additional");
  await expect(
    validateFollowUpAnswer({
      ...args,
      sourceOutcomes: [
        {
          ...args.sourceOutcomes[0],
          requestedReference: "Galatians 5:14",
          referenceKey: "GAL.5.14",
        },
      ],
    }),
  ).rejects.toThrow("does not cover");
  await expect(
    validateFollowUpAnswer({
      ...args,
      additionalEvidence: [],
      baseEvidence: [item],
      sourceOutcomes: [
        {
          requestedReference: "Galatians 5:14",
          referenceKey: "GAL.5.14",
          status: "unavailable",
          evidenceIds: [],
        },
      ],
    }),
  ).rejects.toThrow("qualified coverage");
});

it("validates multiline verse bodies without losing their text during source reuse", async () => {
  const text = "Through love\n\nbe servants to one another.";
  const item = await evidence(`GAL.5.13 ${text}`);
  const ref = followUpReference("Galatians 5:13");
  if (!ref) throw new Error("Invalid fixture reference");
  expect(evidenceVerses([item], ref)).toEqual([
    { id: "GAL.5.13", verse: 13, text, evidenceId: item.evidenceId },
  ]);
  await expect(
    validateFollowUpAnswer({
      answer: {
        answer: "The verse directs freedom toward loving service.",
        evidenceCoverage: "in_saved_sources",
        evidenceIds: [item.evidenceId],
      },
      baseEvidence: [],
      carriedEvidence: [],
      additionalEvidence: [item],
      sourceOutcomes: [
        {
          requestedReference: "Galatians 5:13",
          referenceKey: "GAL.5.13",
          status: "retrieved",
          evidenceIds: [item.evidenceId],
        },
      ],
    }),
  ).resolves.toMatchObject({ answer: { evidenceIds: [item.evidenceId] } });
});
it.each([
  [
    "extra verse",
    "GAL.5.13 Supplied text.\nGAL.5.14 Smuggled verse.",
    "GAL.5.13",
  ],
  [
    "different book",
    "GAL.5.13 Supplied text.\nROM.8.1 Smuggled verse.",
    "GAL.5.13",
  ],
  [
    "different chapter",
    "GAL.5.13 Supplied text.\nGAL.6.13 Smuggled verse.",
    "GAL.5.13",
  ],
  [
    "duplicate marker",
    "GAL.5.13 Supplied text.\nGAL.5.13 Duplicate verse.",
    "GAL.5.13",
  ],
  [
    "reordered verses",
    "GAL.5.14 Second verse.\nGAL.5.13 First verse.",
    "GAL.5.13-GAL.5.14",
  ],
  [
    "missing verse",
    "GAL.5.13 First verse.\nGAL.5.15 Third verse.",
    "GAL.5.13-GAL.5.15",
  ],
  ["noncanonical ID", "GAL.05.13 Supplied text.", "GAL.5.13"],
  ["bare marker", "GAL.5.13 Supplied text.\nROM.8.1", "GAL.5.13"],
  [
    "indented marker",
    "GAL.5.13 Supplied text.\n  ROM.8.1 Smuggled verse.",
    "GAL.5.13",
  ],
  ["unmarked preamble", "Unmarked text.\nGAL.5.13 Supplied text.", "GAL.5.13"],
])("rejects %s even with matching source hashes", async (_case, excerpt, referenceKey) => {
  const item = await evidence(excerpt, referenceKey);
  await expect(
    validateFollowUpAnswer({
      answer: {
        answer: "A cited answer.",
        evidenceCoverage: "in_saved_sources",
        evidenceIds: [item.evidenceId],
      },
      baseEvidence: [],
      carriedEvidence: [],
      additionalEvidence: [item],
      sourceOutcomes: [
        {
          requestedReference: referenceKey,
          referenceKey,
          status: "retrieved",
          evidenceIds: [item.evidenceId],
        },
      ],
    }),
  ).rejects.toThrow("Invalid additional answer source.");
});
