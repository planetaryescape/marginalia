"use node";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalAction } from "../functions";
import { generateObjectWithFallback, underlyingAIError } from "../lib/aiModels";
import { parseBibleReference } from "../lib/bible";
import { fetchBiblePassage } from "../lib/bibleProvider";
import { sharedBibleCache } from "../lib/bibleResourceCache";
import { interruptible, requestAttempt } from "../lib/requestControl";
import { loadReaderAI } from "../lib/router";
import {
  resultSchema,
  STUDY_LIMITS,
  STUDY_SOURCE_REGISTRY,
  STUDY_SYSTEM_PROMPT,
  type StudyEvidence,
  selectedReference,
  selectedVerses,
} from "../lib/scriptureStudy";
import { studyFailureDiagnostic } from "../lib/scriptureStudyDiagnostics";
import { SCRIPTURE_STUDY_SOURCE_NOTICES } from "../lib/scriptureStudySourceShared";
import {
  loadAdditionalStudyEvidence,
  SCRIPTURE_STUDY_SOURCE_POLICY_REVISION,
  type ScriptureStudySourceRecord,
} from "../lib/scriptureStudySources";
import { sha256Hex } from "../lib/tokens";
import { wordStudy } from "../lib/wordStudy";

function chapterVerses(content: string, reference: string) {
  const chapter = parseBibleReference(reference);
  if (!chapter) throw new Error("Could not parse selected WEB chapter.");
  return content.split(/\n\s*\n/).flatMap((line) => {
    const match = /^(\d+):(\d+)\s+([\s\S]+)$/.exec(line);
    if (!match || Number(match[1]) !== chapter.chapter) return [];
    return [
      {
        id: `${chapter.bookId}.${chapter.chapter}.${Number(match[2])}`,
        verse: Number(match[2]),
        text: match[3].trim(),
      },
    ];
  });
}

function canonicalReference(key: string) {
  const match =
    /^([1-3]?[A-Z]{2,3})\.(\d+)\.(\d+)(?:-([1-3]?[A-Z]{2,3})\.(\d+)\.(\d+))?$/.exec(
      key,
    );
  if (!match || (match[4] && (match[1] !== match[4] || match[2] !== match[5])))
    return null;
  const book = parseBibleReference(
    `${match[1]} ${match[2]}:${match[3]}${match[6] ? `-${match[6]}` : ""}`,
  );
  return book?.passageId === key ? book : null;
}

function sourceRecordIdentity(record: ScriptureStudySourceRecord) {
  const registered = STUDY_SOURCE_REGISTRY.find(
    (source) => source.id === record.sourceId,
  );
  if (
    !registered ||
    registered.rights !== record.license ||
    registered.licenseUrl !== record.licenseUrl ||
    (record.sourceId === "aquifer-open-study-notes" &&
      record.attribution !==
        SCRIPTURE_STUDY_SOURCE_NOTICES.aquifer.attribution) ||
    (record.sourceId === "byztxt-printed-edition-variants" &&
      record.attribution !==
        SCRIPTURE_STUDY_SOURCE_NOTICES.byzTxt.attribution) ||
    JSON.stringify(registered.capabilities) !==
      JSON.stringify(record.capabilities)
  )
    throw new Error("Unregistered or changed study evidence source.");
  if (record.sourceId === "aquifer-open-study-notes") {
    if (
      !record.title.startsWith(`${registered.title}: `) ||
      !record.revision.startsWith(`${registered.revision}:`) ||
      !/^https:\/\/github\.com\/BibleAquifer\/AquiferOpenStudyNotes\/blob\/35183d839b73958deca66fe4060d4dc7d4dc23de\/eng\/json\/\d{2}\.content\.json$/.test(
        record.sourceUrl,
      )
    )
      throw new Error(
        "Aquifer evidence identity did not match the pinned source.",
      );
  } else if (
    record.title !== registered.title ||
    record.revision !== registered.revision ||
    !record.sourceUrl.startsWith(
      "https://github.com/byztxt/byzantine-majority-text/blob/27a45ff1b7be6c17ccbfeac414f3f55732ae8e28/csv-unicode/ccat/with-variants/",
    )
  ) {
    throw new Error(
      "ByzTxt evidence identity did not match the pinned source.",
    );
  }
  return registered;
}

export const generate = internalAction({
  args: { runId: v.id("scriptureStudyRuns") },
  handler: async (ctx, { runId }): Promise<void> => {
    const claimToken = crypto.randomUUID();
    const claim = await ctx.runMutation(internal.scriptureStudyRuns.claim, {
      runId,
      claimToken,
    });
    if (!claim) return;
    const attempt = requestAttempt(
      undefined,
      Math.max(1, claim.leaseUntil - Date.now()),
    );
    let polling = false;
    const check = async () => {
      attempt.signal.throwIfAborted();
      if (
        !(await ctx.runQuery(internal.scriptureStudyRuns.check, {
          runId,
          claimToken,
        }))
      ) {
        attempt.abort(new Error("Study stopped or its inputs changed."));
        attempt.signal.throwIfAborted();
      }
    };
    // Cancellation also reaches the SDK while a request is awaiting its provider.
    const timer = setInterval(() => {
      if (polling) return;
      polling = true;
      void check()
        .catch((error) => attempt.abort(error))
        .finally(() => {
          polling = false;
        });
    }, 500);
    let requests = 0;
    const beforeRequest = async () => {
      await check();
      if (requests >= STUDY_LIMITS.externalRequests)
        throw new Error("Study retrieval budget exhausted.");
      requests++;
    };
    const cache = sharedBibleCache(ctx);
    const evidence: StudyEvidence[] = [];
    const files = new Map<string, Promise<string>>();
    let failureCode = "retrieval_or_generation_failed";
    let phase: "setup" | "retrieval" | "generation" | "publication" = "setup";
    const add = async (
      item: Omit<StudyEvidence, "contentHash" | "retrievedAt">,
    ) => {
      if (
        item.excerpt.length > STUDY_LIMITS.excerptChars ||
        evidence.length >= STUDY_LIMITS.evidence
      )
        throw new Error("Study evidence exceeds limits.");
      if (
        evidence.reduce((n, e) => n + e.excerpt.length, 0) +
          item.excerpt.length >
        STUDY_LIMITS.sourceChars
      ) {
        if (item.source.id === "web")
          throw new Error("Study source exceeds limits.");
        evidence[0].limitations.push(
          `Original-language evidence for ${item.referenceKey} omitted to fit the input limit.`,
        );
        return;
      }
      evidence.push({
        ...item,
        contentHash: await sha256Hex(item.excerpt),
        retrievedAt: Date.now(),
      });
    };
    try {
      const ai = await loadReaderAI(ctx, claim.userId, {
        signal: attempt.signal,
      });
      const target = ai.chain("deep")[0];
      if (!target || target.id !== claim.modelId)
        throw new Error("Study model changed.");
      if (target.provider === "chatgpt") {
        failureCode = "model_output_limit_unavailable";
        throw new Error(
          "Configured model cannot enforce the Study output token limit.",
        );
      }
      const ref = selectedReference(claim.selection, claim.articleReference);
      phase = "retrieval";
      const contextRef = parseBibleReference(`${ref.book} ${ref.chapter}`);
      if (!contextRef) throw new Error("Could not fetch selected WEB context.");
      const permitted = await interruptible(
        fetchBiblePassage(contextRef, "web", cache, {
          signal: attempt.signal,
          beforeRequest,
        }),
        attempt.signal,
      );
      await check();
      const chapter = chapterVerses(permitted.content, contextRef.reference);
      const savedChapter = chapterVerses(
        claim.savedContextContent,
        contextRef.reference,
      );
      const verified = selectedVerses(
        permitted.content,
        claim.selection,
        claim.articleReference,
      );
      if (JSON.stringify(verified) !== JSON.stringify(claim.verses))
        throw new Error("Saved source does not match verified WEB text.");
      const selectedStart = ref.verse;
      const selectedEnd = ref.endVerse ?? ref.verse;
      const coverageWarnings: string[] = [];
      const selectedChapterVerses = chapter.filter(
        (verse) => verse.verse >= selectedStart && verse.verse <= selectedEnd,
      );
      if (selectedChapterVerses.length !== verified.length)
        throw new Error("Verified WEB chapter did not contain the selection.");
      const contextBefore = chapter.filter(
        (verse) =>
          verse.verse >= Math.max(1, selectedStart - 2) &&
          verse.verse < selectedStart,
      );
      const contextAfter = chapter.filter(
        (verse) => verse.verse > selectedEnd && verse.verse <= selectedEnd + 2,
      );
      const expectedContext = [
        ...Array.from(
          { length: Math.min(2, selectedStart - 1) },
          (_, index) => selectedStart - Math.min(2, selectedStart - 1) + index,
        ),
        ...Array.from(
          {
            length: Math.max(
              0,
              Math.min(2, (chapter.at(-1)?.verse ?? selectedEnd) - selectedEnd),
            ),
          },
          (_, index) => selectedEnd + index + 1,
        ),
      ];
      const availableContextVerses = new Set(
        chapter.map((verse) => verse.verse),
      );
      const missingContext = expectedContext.filter(
        (verse) => !availableContextVerses.has(verse),
      );
      if (missingContext.length)
        coverageWarnings.push(
          `Verified WEB context was unavailable for adjacent verses ${missingContext.join(", ")}.`,
        );
      for (const context of [contextBefore, contextAfter])
        if (
          context.some(
            (verse, index) =>
              index > 0 && verse.verse !== context[index - 1].verse + 1,
          )
        )
          throw new Error("Saved WEB context is not a contiguous verse range.");
      for (const saved of savedChapter.filter(
        (verse) =>
          verse.verse >= Math.max(1, selectedStart - 2) &&
          verse.verse <= selectedEnd + 2,
      )) {
        const permittedVerse = chapter.find((verse) => verse.id === saved.id);
        if (!permittedVerse || permittedVerse.text !== saved.text)
          throw new Error(
            "Saved WEB context does not match verified WEB text.",
          );
      }
      let group = "";
      for (const verse of verified) {
        const line = `${verse.id} ${verse.text}\n`;
        if (group.length + line.length > STUDY_LIMITS.excerptChars) {
          await add({
            evidenceId: `web-${evidence.length + 1}`,
            source: {
              id: "web",
              title: "World English Bible",
              revision: "bible-api WEB response",
              rights: "Public domain",
              licenseUrl: "https://worldenglish.bible/",
              attribution: permitted.copyright,
              url: permitted.url,
              capabilities: ["passage_text"],
            },
            locator: claim.selection.referenceKey,
            referenceKey: claim.selection.referenceKey,
            excerpt: group,
            limitations: [
              "WEB wording; no alignment to the displayed licensed edition.",
            ],
          });
          group = "";
        }
        group += line;
      }
      if (group)
        await add({
          evidenceId: `web-${evidence.length + 1}`,
          source: {
            id: "web",
            title: "World English Bible",
            revision: "bible-api WEB response",
            rights: "Public domain",
            licenseUrl: "https://worldenglish.bible/",
            attribution: permitted.copyright,
            url: permitted.url,
            capabilities: ["passage_text"],
          },
          locator: claim.selection.referenceKey,
          referenceKey: claim.selection.referenceKey,
          excerpt: group,
          limitations: [
            "WEB wording; no alignment to the displayed licensed edition.",
          ],
        });
      for (const [label, context] of [
        ["before", contextBefore],
        ["after", contextAfter],
      ] as const) {
        if (!context.length) continue;
        const referenceKey = `${context[0].id}${context.length > 1 ? `-${context.at(-1)?.id}` : ""}`;
        await add({
          evidenceId: `web-context-${label}`,
          source: evidence[0].source,
          locator: referenceKey,
          referenceKey,
          excerpt: context
            .map((verse) => `${verse.id} ${verse.text}`)
            .join("\n"),
          limitations: [
            `Immediate WEB context is bounded to ${referenceKey}; retrieved from the permitted WEB chapter. Available saved verses were checked against that source.`,
          ],
        });
      }

      const fetchWithBudget: typeof globalThis.fetch = async (input, init) => {
        await beforeRequest();
        return fetch(input, init);
      };
      const sourceLoad = await interruptible(
        loadAdditionalStudyEvidence(ref, {
          signal: attempt.signal,
          fetch: fetchWithBudget,
        }),
        attempt.signal,
      );
      await check();
      if (sourceLoad.policyRevision !== SCRIPTURE_STUDY_SOURCE_POLICY_REVISION)
        throw new Error(
          "Study evidence policy revision changed during retrieval.",
        );
      coverageWarnings.push(...sourceLoad.coverageWarnings);
      const availableForSources = Math.max(0, 10 - evidence.length);
      const note = sourceLoad.records.find(
        (record) => record.sourceId === "aquifer-open-study-notes",
      );
      const comparison = sourceLoad.records.find(
        (record) => record.sourceId === "byztxt-printed-edition-variants",
      );
      const prioritizedSources = [
        ...new Set([
          ...(note ? [note] : []),
          ...(comparison ? [comparison] : []),
          ...sourceLoad.records,
        ]),
      ];
      const sourceRecords = prioritizedSources.slice(0, availableForSources);
      if (sourceRecords.length < sourceLoad.records.length)
        coverageWarnings.push(
          "Some verified commentary or edition comparisons were omitted to reserve evidence capacity for related passages.",
        );
      for (const record of sourceRecords) {
        const registered = sourceRecordIdentity(record);
        await add({
          evidenceId: `source-${evidence.length + 1}`,
          source: {
            id: record.sourceId,
            title: record.title,
            revision: record.revision,
            rights: record.license,
            licenseUrl: record.licenseUrl,
            attribution: record.attribution,
            url: record.sourceUrl,
            capabilities: record.capabilities,
          },
          locator: record.locator,
          referenceKey: record.referenceKey,
          excerpt: record.excerpt,
          limitations:
            record.sourceId === "aquifer-open-study-notes"
              ? [
                  ...record.limitations,
                  `Changes: ${SCRIPTURE_STUDY_SOURCE_NOTICES.aquifer.changesNotice}`,
                ]
              : record.limitations,
        });
      }

      const relatedCandidates = [
        ...new Set(
          sourceRecords.flatMap((record) => record.relatedReferences ?? []),
        ),
      ]
        .map((referenceKey) => ({
          referenceKey,
          ref: canonicalReference(referenceKey),
        }))
        .filter((candidate) => {
          if (!candidate.ref) {
            coverageWarnings.push(
              "A structured related reference did not match canonical WEB syntax and was not used.",
            );
            return false;
          }
          if (candidate.ref.bookId === ref.bookId) return false;
          return true;
        })
        .slice(0, 2);
      if (!relatedCandidates.length)
        coverageWarnings.push(
          "No cross-book related WEB reference was verified from supplied study notes.",
        );
      for (const [index, candidate] of relatedCandidates.entries()) {
        if (!candidate.ref) continue;
        try {
          const related = await interruptible(
            fetchBiblePassage(candidate.ref, "web", cache, {
              signal: attempt.signal,
              beforeRequest,
            }),
            attempt.signal,
          );
          await check();
          const relatedVerses = selectedVerses(
            related.content,
            {
              referenceKey: candidate.referenceKey,
              startVerseId: candidate.ref.passageId.split("-")[0],
              endVerseId: candidate.ref.passageId.split("-").at(-1)!,
              versificationId: "web",
            },
            candidate.ref.reference,
          );
          await add({
            evidenceId: `related-${index + 1}`,
            source: {
              id: "web",
              title: "World English Bible",
              revision: "bible-api WEB response",
              rights: "Public domain",
              licenseUrl: "https://worldenglish.bible/",
              attribution: related.copyright,
              url: related.url,
              capabilities: ["passage_text"],
            },
            locator: candidate.referenceKey,
            referenceKey: candidate.referenceKey,
            excerpt: relatedVerses
              .map((verse) => `${verse.id} ${verse.text}`)
              .join("\n"),
            limitations: [
              `Verified cross-book WEB passage from a structured Aquifer reference candidate (${candidate.referenceKey}).`,
            ],
          });
        } catch (error) {
          attempt.signal.throwIfAborted();
          coverageWarnings.push(
            `Related passage ${candidate.referenceKey} unavailable: ${error instanceof Error ? error.message : "retrieval failed"}`,
          );
        }
      }

      // Optional sampled originals follow context, licensed notes, variants and related passages.
      const samples = Array.from(
        new Set([
          0,
          Math.floor((verified.length - 1) / 2),
          verified.length - 1,
        ]),
      );
      for (const index of samples) {
        if (
          requests >= STUDY_LIMITS.externalRequests ||
          evidence.length >= 16
        ) {
          coverageWarnings.push(
            "Additional original-language samples were skipped after reserving the retrieval budget for core and related evidence.",
          );
          break;
        }
        await check();
        const verseRef = parseBibleReference(
          `${ref.book} ${ref.chapter}:${ref.verse + index}`,
        );
        if (!verseRef) continue;
        try {
          const original = await interruptible(
            wordStudy(verseRef, {
              signal: attempt.signal,
              cache,
              beforeRequest,
              files,
            }),
            attempt.signal,
          );
          await check();
          const textSource = original.sources[0];
          const dictionarySource = original.sources[1];
          const key = verified[index].id;
          await add({
            evidenceId: `original-${key}`,
            source: {
              id: original.language === "Greek" ? "byztxt" : "oshb",
              title: original.edition,
              revision: textSource.revision,
              rights: textSource.license,
              licenseUrl: textSource.licenseUrl,
              attribution: textSource.attribution,
              url: textSource.sourceUrl,
              capabilities: ["morphology", "lemma"],
            },
            referenceKey: key,
            locator: original.originalId,
            excerpt: JSON.stringify(original.words.slice(0, 25)),
            limitations: [
              ...original.notices,
              "At most 25 supplied tokens in this sampled verse; no apparatus or word alignment.",
            ],
          });
          const entries = original.entries
            .slice(0, 3)
            .map((e) => ({ ...e, definition: e.definition.slice(0, 900) }));
          if (entries.length)
            await add({
              evidenceId: `lexicon-${key}`,
              source: {
                id: "strongs",
                title: dictionarySource.title,
                revision: dictionarySource.revision,
                rights: dictionarySource.license,
                licenseUrl: dictionarySource.licenseUrl,
                attribution: dictionarySource.attribution,
                url: dictionarySource.sourceUrl,
                capabilities: ["historical_lexicon"],
              },
              referenceKey: key,
              locator: entries.map((e) => e.id).join(","),
              excerpt: JSON.stringify(entries),
              limitations: [
                ...original.notices,
                "At most three dictionary entries; definitions shortened to 900 characters.",
              ],
            });
        } catch (error) {
          attempt.signal.throwIfAborted();
          if (
            error instanceof Error &&
            error.message.includes("retrieval budget")
          ) {
            coverageWarnings.push(
              "Original-language sample retrieval stopped at the external request limit.",
            );
            break;
          }
          if (
            error instanceof Error &&
            (error.message.includes("does not contain the requested verse") ||
              error.message.includes("partial Hebrew/English alignment"))
          ) {
            evidence[0].limitations.push(
              `Original-language evidence unavailable for ${verified[index].id}; verse mapping was not safely verified.`,
            );
            continue;
          }
          coverageWarnings.push(
            `Original-language evidence unavailable for ${verified[index].id}: ${error instanceof Error ? error.message : "retrieval failed"}`,
          );
        }
      }
      if (coverageWarnings.length && evidence[0])
        evidence[0].limitations.push(...[...new Set(coverageWarnings)]);
      const inputKey = await ctx.runMutation(
        internal.scriptureStudyRuns.manifest,
        { runId, claimToken, evidence },
      );
      if (!inputKey) throw new Error("Study stopped before generation.");
      await check();
      await check();
      phase = "generation";
      const result = await generateObjectWithFallback({
        schema: resultSchema,
        targets: [target],
        maxOutputTokens: STUDY_LIMITS.outputTokens,
        deadlineMs: Math.max(1, claim.leaseUntil - Date.now()),
        signal: attempt.signal,
        onFailure: ai.noteFailure,
        system: STUDY_SYSTEM_PROMPT,
        prompt: JSON.stringify({
          selection: claim.selection,
          verses: verified,
          immediateContextRanges: evidence
            .filter((item) => item.evidenceId.startsWith("web-context-"))
            .map((item) => item.referenceKey),
          evidence,
        }),
      });
      await check();
      phase = "publication";
      const didPublish = await ctx.runMutation(
        internal.scriptureStudyRuns.publish,
        {
          runId,
          claimToken,
          inputKey,
          modelId: result.modelId,
          resultJson: JSON.stringify(result.object),
        },
      );
      if (!didPublish) throw new Error("Study publication was fenced.");
    } catch (error) {
      if (!attempt.signal.aborted) {
        console.error(
          JSON.stringify({
            event: "scripture_study_failed",
            runId,
            phase,
            modelId: claim.modelId,
            ...studyFailureDiagnostic(underlyingAIError(error)),
          }),
        );
      }
      await ctx.runMutation(internal.scriptureStudyRuns.fail, {
        runId,
        claimToken,
        errorCode: attempt.signal.aborted
          ? "cancelled_expired_or_changed"
          : failureCode,
      });
    } finally {
      clearInterval(timer);
      attempt.abort();
      attempt.dispose();
    }
  },
});
