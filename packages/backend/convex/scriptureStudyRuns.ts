import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { internalMutation, internalQuery } from "./functions";
import type { StudyEvidence } from "./lib/scriptureStudy";
import {
  contextSummaryValidator,
  evidenceValidator,
  generationValidator,
  resultSchema,
  STUDY_LIMITS,
  STUDY_SOURCE_REGISTRY,
  studyCoverage,
  validateResult,
} from "./lib/scriptureStudy";
import { studyReaderContext } from "./lib/scriptureStudyContext";
import { currentRun } from "./lib/scriptureStudyState";
import { sha256Hex } from "./lib/tokens";

async function manifestIdentity(
  run: Doc<"scriptureStudyRuns">,
  evidence: StudyEvidence[],
) {
  const evidenceSetHash = await sha256Hex(JSON.stringify(evidence));
  const inputKey = await sha256Hex(
    JSON.stringify([
      run.sourceHash,
      run.modelPolicyHash,
      run.credentialHash,
      run.version,
      run.sourcePolicy,
      evidenceSetHash,
      run.contextHash ?? null,
      run.contextSummary ?? null,
    ]),
  );
  return { evidenceSetHash, inputKey };
}
export const claim = internalMutation({
  args: { runId: v.id("scriptureStudyRuns"), claimToken: v.string() },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run || run.status !== "queued") return null;
    const current = await currentRun(ctx, run);
    if (!current) return null;
    const notes = await ctx.db
      .query("userNotes")
      .withIndex("by_article_and_unitIndex", (q) =>
        q.eq("articleId", current.article._id).eq("unitIndex", undefined),
      )
      .order("desc")
      .paginate({ cursor: null, numItems: 32, maximumBytesRead: 1_000_000 });
    const readerContext = studyReaderContext(
      notes.page.filter((note) => note.userId === run.userId),
      current.article.bible.reference,
      current.article.content ?? "",
      current.study.selection,
      !notes.isDone,
    );
    await ctx.db.patch(run._id, {
      status: "running",
      claimToken: args.claimToken,
    });
    return {
      userId: run.userId,
      selection: current.study.selection,
      articleReference: current.article.bible.reference,
      savedContextContent: current.article.content ?? "",
      verses: current.verses,
      leaseUntil: run.leaseUntil,
      modelId: run.modelId,
      readerContext,
    };
  },
});
export const check = internalQuery({
  args: { runId: v.id("scriptureStudyRuns"), claimToken: v.string() },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    return (
      !!run &&
      run.claimToken === args.claimToken &&
      run.status === "running" &&
      !!(await currentRun(ctx, run))
    );
  },
});
export const manifest = internalMutation({
  args: {
    runId: v.id("scriptureStudyRuns"),
    claimToken: v.string(),
    evidence: v.array(evidenceValidator),
    contextSummary: v.optional(contextSummaryValidator),
    contextHash: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (
      !run ||
      run.status !== "running" ||
      run.claimToken !== args.claimToken ||
      run.evidenceSetHash ||
      !(await currentRun(ctx, run))
    )
      return null;
    if (
      args.evidence.length > STUDY_LIMITS.evidence ||
      new TextEncoder().encode(JSON.stringify(args.evidence)).length >
        STUDY_LIMITS.evidenceBytes ||
      args.evidence.reduce((n, e) => n + e.excerpt.length, 0) +
        (args.contextSummary?.readerContextChars ?? 0) >
        STUDY_LIMITS.sourceChars ||
      args.evidence.some((e) => e.excerpt.length > STUDY_LIMITS.excerptChars) ||
      new Set(args.evidence.map((e) => e.evidenceId)).size !==
        args.evidence.length
    )
      throw new Error("Evidence exceeds study limits.");
    if (
      args.contextSummary &&
      (!Number.isInteger(args.contextSummary.readerNoteCount) ||
        args.contextSummary.readerNoteCount < 0 ||
        args.contextSummary.readerNoteCount > STUDY_LIMITS.readerNotes ||
        !Number.isInteger(args.contextSummary.readerContextChars) ||
        args.contextSummary.readerContextChars < 0 ||
        args.contextSummary.readerContextChars >
          STUDY_LIMITS.readerContextChars ||
        args.contextSummary.chapterRanges.length > STUDY_LIMITS.evidence)
    )
      throw new Error("Invalid study context bounds.");
    for (const item of args.evidence) {
      const registered = STUDY_SOURCE_REGISTRY.find(
        (source) => source.id === item.source.id,
      );
      const aquifer = item.source.id === "aquifer-open-study-notes";
      const byztxtVariants =
        item.source.id === "byztxt-printed-edition-variants";
      const sourceUrlValid =
        item.source.id === "web"
          ? /^https:\/\/bible-api\.com\/data\/web\/[1-3]?[A-Z]{2,3}\/\d+$/.test(
              item.source.url,
            )
          : aquifer
            ? /^https:\/\/github\.com\/BibleAquifer\/AquiferOpenStudyNotes\/blob\/35183d839b73958deca66fe4060d4dc7d4dc23de\/eng\/json\/\d{2}\.content\.json$/.test(
                item.source.url,
              )
            : byztxtVariants
              ? /^https:\/\/github\.com\/byztxt\/byzantine-majority-text\/blob\/27a45ff1b7be6c17ccbfeac414f3f55732ae8e28\/csv-unicode\/ccat\/with-variants\/[A-Z0-9]+\.csv$/.test(
                  item.source.url,
                )
              : item.source.id === "byztxt"
                ? item.source.url.startsWith(
                    "https://raw.githubusercontent.com/byztxt/byzantine-majority-text/27a45ff1b7be6c17ccbfeac414f3f55732ae8e28/csv-unicode/strongs/with-parsing/",
                  )
                : item.source.id === "oshb"
                  ? item.source.url.startsWith(
                      "https://raw.githubusercontent.com/openscriptures/morphhb/3d15126fb1ef74867fc1434be1942e837932691f/wlc/",
                    )
                  : item.source.id === "strongs"
                    ? item.source.url ===
                      "https://raw.githubusercontent.com/openscriptures/strongs/0acd2f251c2d35ff8db2dece4e0593979d3ac223/strongs-dictionary.xhtml"
                    : false;
      if (
        !registered ||
        (aquifer
          ? !item.source.title.startsWith(`${registered.title}: `) ||
            !new RegExp(`^${registered.revision}:[^:\\s]+:[^:\\s]+$`).test(
              item.source.revision,
            )
          : registered.title !== item.source.title ||
            registered.revision !== item.source.revision) ||
        registered.rights !== item.source.rights ||
        registered.licenseUrl !== item.source.licenseUrl ||
        !item.source.attribution.trim() ||
        !sourceUrlValid ||
        JSON.stringify(registered.capabilities) !==
          JSON.stringify(item.source.capabilities) ||
        (aquifer &&
          (item.source.attribution !==
            "Adapted from Tyndale Open Study Notes © 2023 Tyndale House Publishers by Mission Mutual © 2026; CC BY-SA 4.0." ||
            !/^https:\/\/github\.com\/BibleAquifer\/AquiferOpenStudyNotes\/blob\/35183d839b73958deca66fe4060d4dc7d4dc23de\/eng\/json\/\d{2}\.content\.json$/.test(
              item.source.url,
            ))) ||
        (byztxtVariants &&
          (item.source.attribution !==
            "ByzTxt / Robinson-Pierpont; source revision pinned in this record." ||
            !item.source.url.startsWith(
              "https://github.com/byztxt/byzantine-majority-text/blob/27a45ff1b7be6c17ccbfeac414f3f55732ae8e28/csv-unicode/ccat/with-variants/",
            ))) ||
        item.contentHash !== (await sha256Hex(item.excerpt))
      ) {
        throw new Error("Unregistered or changed evidence source.");
      }
    }
    if (
      !!args.contextSummary !== !!args.contextHash ||
      (args.contextHash && !/^[a-f0-9]{64}$/.test(args.contextHash))
    )
      throw new Error("Invalid study context identity.");
    const { evidenceSetHash, inputKey } = await manifestIdentity(
      {
        ...run,
        contextSummary: args.contextSummary,
        contextHash: args.contextHash,
      },
      args.evidence,
    );
    await ctx.db.patch(run._id, {
      evidence: args.evidence,
      evidenceSetHash,
      inputKey,
      contextSummary: args.contextSummary,
      contextHash: args.contextHash,
    });
    return inputKey;
  },
});
export const publish = internalMutation({
  args: {
    runId: v.id("scriptureStudyRuns"),
    claimToken: v.string(),
    inputKey: v.string(),
    resultJson: v.string(),
    modelId: v.string(),
    generation: v.optional(generationValidator),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (
      !run ||
      run.status !== "running" ||
      run.claimToken !== args.claimToken ||
      run.inputKey !== args.inputKey ||
      run.modelId !== args.modelId ||
      !run.evidence
    )
      return false;
    const manifest = await manifestIdentity(run, run.evidence);
    if (
      manifest.evidenceSetHash !== run.evidenceSetHash ||
      manifest.inputKey !== run.inputKey
    )
      return false;
    const current = await currentRun(ctx, run);
    if (!current) return false;
    const result = validateResult(
      resultSchema.parse(JSON.parse(args.resultJson)),
      run.evidence,
      current.verses,
      current.study.selection,
    );
    if (
      args.generation &&
      (!Number.isInteger(args.generation.modelAttempts) ||
        args.generation.modelAttempts < 1 ||
        args.generation.modelAttempts > STUDY_LIMITS.modelAttempts ||
        args.generation.repairAttempted !== args.generation.modelAttempts > 1 ||
        !Number.isInteger(args.generation.omittedFindings) ||
        args.generation.omittedFindings < 0 ||
        args.generation.omittedFindings > STUDY_LIMITS.findings ||
        !Number.isInteger(args.generation.correctedCitations) ||
        args.generation.correctedCitations < 0 ||
        args.generation.correctedCitations > STUDY_LIMITS.findings)
    )
      throw new Error("Invalid study generation bounds.");
    for (const [order, finding] of result.findings.entries())
      await ctx.db.insert("scriptureStudyFindings", {
        userId: run.userId,
        articleId: run.articleId,
        runId: run._id,
        order,
        finding,
      });
    const old =
      current.study.publishedRunId &&
      (await ctx.db.get(current.study.publishedRunId));
    if (old)
      await ctx.db.patch(old._id, {
        purgeAt: Date.now() + STUDY_LIMITS.temporaryRetentionMs,
      });
    await ctx.db.patch(run._id, {
      status: "complete",
      finishedAt: Date.now(),
      outcome: result.findings.length ? "partial" : "no_meaningful_findings",
      coverage: studyCoverage(result.findings, run.evidence),
      generation: args.generation,
      purgeAt: undefined,
    });
    await ctx.db.patch(current.study._id, {
      activeRunId: undefined,
      publishedRunId: run._id,
      updatedAt: Date.now(),
    });
    return true;
  },
});
export const fail = internalMutation({
  args: {
    runId: v.id("scriptureStudyRuns"),
    claimToken: v.string(),
    errorCode: v.string(),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run || run.status !== "running" || run.claimToken !== args.claimToken)
      return;
    await ctx.db.patch(run._id, {
      status: "failed",
      errorCode: args.errorCode,
      finishedAt: Date.now(),
      purgeAt: Date.now() + STUDY_LIMITS.temporaryRetentionMs,
    });
    const study = await ctx.db.get(run.studyId);
    if (study?.activeRunId === run._id)
      await ctx.db.patch(study._id, { updatedAt: Date.now() });
  },
});

export const expire = internalMutation({
  args: { runId: v.id("scriptureStudyRuns") },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (
      !run ||
      (run.status !== "queued" && run.status !== "running") ||
      run.leaseUntil > Date.now()
    )
      return;
    await ctx.db.patch(run._id, {
      status: "failed",
      errorCode: "lease_expired",
      finishedAt: Date.now(),
      purgeAt: Date.now() + STUDY_LIMITS.temporaryRetentionMs,
    });
    const study = await ctx.db.get(run.studyId);
    if (study?.activeRunId === run._id)
      await ctx.db.patch(study._id, { updatedAt: Date.now() });
  },
});
