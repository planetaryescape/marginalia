import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseBibleReference } from "../../packages/backend/convex/lib/bible";
import { fetchBiblePassage } from "../../packages/backend/convex/lib/bibleProvider";
import {
  SOURCE_POLICY,
  STUDY_LIMITS,
  STUDY_SYSTEM_PROMPT,
  STUDY_VERSION,
  type StudyEvidence,
} from "../../packages/backend/convex/lib/scriptureStudy";
import {
  chapterVerses,
  studyChapterContext,
} from "../../packages/backend/convex/lib/scriptureStudyContext";
import {
  type StudyEvaluationCase,
  type StudyEvaluationCaseCatalog,
  type StudyEvaluationSnapshot,
  scriptureStudyEvaluationSchemaJson,
  validateStudyEvaluationCaseCatalog,
  validateStudyEvaluationSnapshot,
} from "../../packages/backend/convex/lib/scriptureStudyEvaluationSchema";
import { STUDY_TEACHING_PROMPT } from "../../packages/backend/convex/lib/scriptureStudyPrompt";
import { loadAdditionalStudyEvidence } from "../../packages/backend/convex/lib/scriptureStudySources";

export const HERE = dirname(fileURLToPath(import.meta.url));
export const CASES_PATH = resolve(HERE, "cases.json");
export const SNAPSHOT_DIR = resolve(HERE, "snapshots");
export const BASE_SYSTEM = `${STUDY_SYSTEM_PROMPT}\n${STUDY_TEACHING_PROMPT}`;
export const BASE_PROMPT_VERSION = STUDY_VERSION;
export const SOURCE_POLICY_VERSION = SOURCE_POLICY;

export type CaseDefinition = StudyEvaluationCase;
export type CaseCatalog = StudyEvaluationCaseCatalog;
export type Snapshot = StudyEvaluationSnapshot;

export function hash(value: unknown): string {
  return createHash("sha256")
    .update(typeof value === "string" ? value : JSON.stringify(value))
    .digest("hex");
}
export async function catalog(): Promise<CaseCatalog> {
  const raw: unknown = JSON.parse(await readFile(CASES_PATH, "utf8"));
  return validateStudyEvaluationCaseCatalog(raw);
}
export function definedCase(cases: CaseCatalog, id: string): CaseDefinition {
  const found = cases.cases.find((item) => item.id === id);
  if (!found) throw new Error(`Unknown fixture: ${id}`);
  return found;
}

export async function prepare(id?: string) {
  const cases = await catalog();
  const selected = id ? [definedCase(cases, id)] : cases.cases;
  const sourceSha = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  const schemaJson = scriptureStudyEvaluationSchemaJson();
  const schemaHash = hash(schemaJson);
  for (const item of selected) {
    const ref = parseBibleReference(item.reference);
    if (!ref) throw new Error(`Invalid fixture reference: ${item.reference}`);
    const full = await fetchBiblePassage(
      parseBibleReference(`${ref.book} ${ref.chapter}`)!,
      "web",
    );
    const allVerses = chapterVerses(full.content, `${ref.book} ${ref.chapter}`);
    const first = ref.verse ?? allVerses[0]?.verse;
    const last = ref.endVerse ?? allVerses.at(-1)?.verse;
    if (first === undefined || last === undefined)
      throw new Error(`No verses for ${item.reference}`);
    const verses = allVerses.filter(
      (verse) => verse.verse >= first && verse.verse <= last,
    );
    if (verses.length !== last - first + 1)
      throw new Error(`Incomplete WEB passage for ${item.reference}`);
    const selection = {
      referenceKey: `${ref.bookId}.${ref.chapter}.${first}${last === first ? "" : `-${ref.bookId}.${ref.chapter}.${last}`}`,
      startVerseId: `${ref.bookId}.${ref.chapter}.${first}`,
      endVerseId: `${ref.bookId}.${ref.chapter}.${last}`,
      versificationId: "web" as const,
    };
    const chapterContext = studyChapterContext(
      allVerses,
      selection,
      STUDY_LIMITS.chapterContextChars,
    );
    const evidence: StudyEvidence[] = [];
    const web = {
      id: "web",
      title: "World English Bible",
      revision: "bible-api WEB response",
      rights: "Public domain",
      licenseUrl: "https://worldenglish.bible/",
      attribution: full.copyright,
      url: full.url,
      capabilities: ["passage_text"],
    };
    const selectedRef = `${ref.bookId}.${ref.chapter}.${first}${last === first ? "" : `-${ref.bookId}.${ref.chapter}.${last}`}`;
    evidence.push({
      evidenceId: "web-selected",
      source: web,
      locator: selectedRef,
      referenceKey: selectedRef,
      excerpt: verses.map((verse) => `${verse.id} ${verse.text}`).join("\n"),
      contentHash: hash(verses),
      retrievedAt: Date.now(),
      limitations: ["Frozen public WEB text snapshot; public-domain source."],
    });
    const before = allVerses.filter(
      (verse) => verse.verse >= first - 2 && verse.verse < first,
    );
    const after = allVerses.filter(
      (verse) => verse.verse > last && verse.verse <= last + 2,
    );
    const immediateContextRanges: string[] = [];
    for (const [label, group] of [
      ["before", before],
      ["after", after],
    ] as const) {
      if (!group.length) continue;
      const key = `${group[0]!.id}${group.length > 1 ? `-${group.at(-1)!.id}` : ""}`;
      immediateContextRanges.push(key);
      evidence.push({
        evidenceId: `web-context-${label}`,
        source: web,
        locator: key,
        referenceKey: key,
        excerpt: group.map((verse) => `${verse.id} ${verse.text}`).join("\n"),
        contentHash: hash(group),
        retrievedAt: Date.now(),
        limitations: ["Verified immediate WEB chapter context."],
      });
    }
    for (const [index, block] of chapterContext.evidenceBlocks.entries()) {
      evidence.push({
        evidenceId: `web-chapter-${index + 1}`,
        source: web,
        locator: block.referenceKey,
        referenceKey: block.referenceKey,
        excerpt: block.excerpt,
        contentHash: hash(block.excerpt),
        retrievedAt: Date.now(),
        limitations: ["Verified wider WEB chapter context."],
      });
    }
    const sourceRef =
      ref.verse === undefined
        ? parseBibleReference(`${ref.book} ${ref.chapter}:${first}-${last}`)!
        : ref;
    const extra = await loadAdditionalStudyEvidence(sourceRef);
    const note = extra.records.find(
      (record) => record.sourceId === "aquifer-open-study-notes",
    );
    const comparison = extra.records.find(
      (record) => record.sourceId === "byztxt-printed-edition-variants",
    );
    const prioritized = [
      ...new Set([
        ...(note ? [note] : []),
        ...(comparison ? [comparison] : []),
        ...extra.records,
      ]),
    ];
    const sourceRecords = prioritized.slice(
      0,
      Math.max(0, 10 - evidence.length),
    );
    for (const record of sourceRecords) {
      evidence.push({
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
        contentHash: record.contentHash,
        retrievedAt: Date.now(),
        limitations: record.limitations,
      });
    }
    const input = {
      selection,
      selectedVerseIds: verses.map((verse) => verse.id),
      immediateContextRanges,
      evidence,
      chapterContext: {
        coverage: chapterContext.coverage,
        referenceKey: chapterContext.referenceKey,
        ranges: chapterContext.ranges,
      },
      readerContext: {
        role: "untrusted_personal_context_not_evidence" as const,
        notes: [] as [],
        limited: false as const,
      },
    };
    const snapshot: Snapshot = {
      format: "marginalia-deep-study-fixture-v1",
      case: item,
      createdAt: new Date().toISOString(),
      sourceSha,
      promptVersion: BASE_PROMPT_VERSION,
      promptHash: hash(BASE_SYSTEM),
      schemaHash,
      baselineSystemPrompt: BASE_SYSTEM,
      sourcePolicyVersion: SOURCE_POLICY_VERSION,
      input,
      verses,
      inputHash: hash(input),
      evidenceHash: hash(evidence),
      versions: {
        bun: process.versions.bun ?? "unknown",
        node: process.version,
      },
    };
    const path = resolve(SNAPSHOT_DIR, `${item.id}.json`);
    await mkdir(SNAPSHOT_DIR, { recursive: true });
    await writeFile(path, `${JSON.stringify(snapshot, null, 2)}\n`, {
      flag: "wx",
    });
    console.log(`prepared ${item.id}: ${hash(snapshot)} (${path})`);
  }
}

export async function loadSnapshot(id: string): Promise<Snapshot> {
  let raw: unknown;
  try {
    raw = JSON.parse(
      await readFile(resolve(SNAPSHOT_DIR, `${id}.json`), "utf8"),
    );
  } catch {
    throw new Error(`Fixture ${id} is missing or contains invalid JSON`);
  }
  return validateSnapshotArtifact(id, raw);
}

export function validateSnapshotArtifact(id: string, raw: unknown): Snapshot {
  const snapshot = validateStudyEvaluationSnapshot(raw);
  if (
    snapshot.inputHash !== hash(snapshot.input) ||
    snapshot.evidenceHash !== hash(snapshot.input.evidence)
  )
    throw new Error(
      `Fixture ${id} failed its input or evidence integrity hash check`,
    );
  if (snapshot.promptHash !== hash(snapshot.baselineSystemPrompt))
    throw new Error(`Fixture ${id} failed its frozen prompt hash check`);
  if (snapshot.schemaHash !== hash(scriptureStudyEvaluationSchemaJson()))
    throw new Error(`Fixture ${id} uses a different structured output schema`);
  return snapshot;
}

export async function inspect(ids: string[]) {
  const cases = await catalog();
  for (const id of ids.length ? ids : cases.cases.map((item) => item.id)) {
    const snapshot = await loadSnapshot(definedCase(cases, id).id);
    console.log(
      JSON.stringify({
        fixtureId: id,
        split: snapshot.case.split,
        reference: snapshot.case.reference,
        fixtureHash: hash(snapshot),
        inputHash: snapshot.inputHash,
        evidenceHash: snapshot.evidenceHash,
        promptVersion: snapshot.promptVersion,
        promptHash: snapshot.promptHash,
        schemaHash: snapshot.schemaHash,
        sourcePolicyVersion: snapshot.sourcePolicyVersion,
        sourceSha: snapshot.sourceSha,
        evidenceCount: snapshot.input.evidence.length,
        evidence: snapshot.input.evidence.map((item) => ({
          id: item.source.id,
          revision: item.source.revision,
          license: item.source.rights,
          licenseUrl: item.source.licenseUrl,
          locator: item.locator,
          contentHash: item.contentHash,
        })),
      }),
    );
  }
}
