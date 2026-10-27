"use node";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalAction } from "../functions";
import { generateObjectWithFallback } from "../lib/aiModels";
import { parseBibleReference } from "../lib/bible";
import { fetchBiblePassage } from "../lib/bibleProvider";
import { sharedBibleCache } from "../lib/bibleResourceCache";
import { interruptible, requestAttempt } from "../lib/requestControl";
import { loadReaderAI } from "../lib/router";
import {
  resultSchema,
  STUDY_LIMITS,
  STUDY_SYSTEM_PROMPT,
  type StudyEvidence,
  selectedReference,
  selectedVerses,
} from "../lib/scriptureStudy";
import { sha256Hex } from "../lib/tokens";
import { wordStudy } from "../lib/wordStudy";

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
      if (++requests > STUDY_LIMITS.externalRequests)
        throw new Error("Study retrieval budget exhausted.");
    };
    const cache = sharedBibleCache(ctx);
    const evidence: StudyEvidence[] = [];
    const files = new Map<string, Promise<string>>();
    let failureCode = "retrieval_or_generation_failed";
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
      const permitted = await interruptible(
        fetchBiblePassage(ref, "web", cache, {
          signal: attempt.signal,
          beforeRequest,
        }),
        attempt.signal,
      );
      await check();
      const verified = selectedVerses(
        permitted.content,
        claim.selection,
        claim.articleReference,
      );
      if (JSON.stringify(verified) !== JSON.stringify(claim.verses))
        throw new Error("Saved source does not match verified WEB text.");
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
      // Three evenly spaced verse samples bound book/dictionary retrieval and input.
      const samples = Array.from(
        new Set([
          0,
          Math.floor((verified.length - 1) / 2),
          verified.length - 1,
        ]),
      );
      for (const index of samples) {
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
            (error.message.includes("does not contain the requested verse") ||
              error.message.includes("partial Hebrew/English alignment"))
          ) {
            evidence[0].limitations.push(
              `Original-language evidence unavailable for ${verified[index].id}; verse mapping was not safely verified.`,
            );
            continue;
          }
          throw error;
        }
      }
      const inputKey = await ctx.runMutation(
        internal.scriptureStudyRuns.manifest,
        { runId, claimToken, evidence },
      );
      if (!inputKey) throw new Error("Study stopped before generation.");
      await check();
      await check();
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
          evidence,
        }),
      });
      await check();
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
    } catch {
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
