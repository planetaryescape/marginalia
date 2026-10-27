import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { requireBible } from "./bibleSettings";
import { sourceHash } from "./preparedRepresentation";
import { modelChain } from "./providers";
import {
  readerProviders,
  savedCredentials,
  savedModelChoices,
} from "./readerAI";
import {
  SOURCE_POLICY,
  STUDY_LIMITS,
  STUDY_SOURCE_REGISTRY,
  STUDY_SYSTEM_PROMPT,
  STUDY_VERSION,
  selectedVerses,
} from "./scriptureStudy";
import { metadataLibraryActive } from "./shelfCounts";
import { sha256Hex } from "./tokens";

type Db = Pick<QueryCtx, "db">;
export async function studyPolicy(ctx: Db, userId: string) {
  const [credentials, choices, providers] = await Promise.all([
    savedCredentials(ctx, userId),
    savedModelChoices(ctx, userId),
    readerProviders(ctx, userId),
  ]);
  const chain = modelChain(
    choices.deep,
    "deep",
    providers.providers,
    providers.chatgptModels,
  );
  if (!chain.length)
    throw new Error("Connect an AI provider in Your account for Study.");
  return {
    modelId: chain[0].id,
    credentialHash: await sha256Hex(
      JSON.stringify(credentials.map((c) => [c._id, c.ciphertext, c.iv])),
    ),
    hash: await sha256Hex(
      JSON.stringify([
        STUDY_VERSION,
        STUDY_SYSTEM_PROMPT,
        STUDY_LIMITS,
        SOURCE_POLICY,
        STUDY_SOURCE_REGISTRY,
        STUDY_SYSTEM_PROMPT,
        STUDY_LIMITS,
        choices.deep ?? null,
        chain.map((m) => m.id),
      ]),
    ),
  };
}
export async function ownedArticle(
  ctx: Db,
  userId: string,
  articleId: Id<"articles">,
) {
  if (!(await metadataLibraryActive(ctx, userId)))
    throw new Error("Reader is no longer active.");
  await requireBible(ctx, userId);
  const article = await ctx.db.get(articleId);
  if (
    !article ||
    article.userId !== userId ||
    article.bible?.translation !== "web"
  )
    throw new Error("Owned WEB Scripture passage not found.");
  return { ...article, bible: article.bible };
}
export async function ownedStudy(
  ctx: Db,
  userId: string,
  studyId: Id<"scriptureStudies">,
) {
  const study = await ctx.db.get(studyId);
  if (!study || study.userId !== userId) throw new Error("Study not found.");
  await ownedArticle(ctx, userId, study.articleId);
  return study;
}
export async function currentRun(ctx: Db, run: Doc<"scriptureStudyRuns">) {
  try {
    const study = await ctx.db.get(run.studyId);
    if (
      !study ||
      study.userId !== run.userId ||
      study.activeRunId !== run._id ||
      (run.status !== "running" && run.status !== "queued") ||
      run.leaseUntil <= Date.now() ||
      run.version !== STUDY_VERSION ||
      run.sourcePolicy !== SOURCE_POLICY
    )
      return null;
    const article = await ownedArticle(ctx, run.userId, study.articleId);
    const policy = await studyPolicy(ctx, run.userId);
    if (
      (await sourceHash(article.content, article.contentHtml)) !==
        run.sourceHash ||
      policy.hash !== run.modelPolicyHash ||
      policy.credentialHash !== run.credentialHash
    )
      return null;
    return {
      study,
      article,
      verses: selectedVerses(
        article.content ?? "",
        study.selection,
        article.bible.reference,
      ),
    };
  } catch {
    return null;
  }
}
