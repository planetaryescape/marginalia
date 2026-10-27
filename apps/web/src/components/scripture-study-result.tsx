"use client";

import { referenceFromKey } from "@marginalia/backend/scripture-references";
import type {
  StudyEvidence,
  StudyFinding,
  StudyTeaching,
} from "@marginalia/backend/scripture-study";
import type { ReactNode } from "react";
import { useId, useRef, useState } from "react";
import { InlineError, SavedMark } from "./in-place";

const METHODS = {
  exegesis: "Words in context",
  hermeneutics: "Reading and application",
  textual_criticism: "Text and editions",
  literary: "Literary shape",
  intertextual_canonical: "Connections in Scripture",
  reception: "History of interpretation",
};

/** A label only. Admission and citation identities are verified on the server. */
export function studyReferenceLabel(key: string) {
  return referenceFromKey(key)?.reference.replaceAll("-", "–") ?? key;
}

export function ScriptureStudyResult({
  findings,
  teaching,
  sources = [],
  renderFollowUps,
  outcome,
  renderEvidence,
  onAnchor,
  onKeep,
}: {
  findings: StudyFinding[];
  teaching?: StudyTeaching | null;
  sources?: { evidenceId: string; title: string; referenceKey: string }[];
  renderFollowUps?: (citations: (ids: string[]) => ReactNode) => ReactNode;
  outcome: string | null;
  renderEvidence: (evidenceId: string) => ReactNode;
  onAnchor: (verseId: string) => void;
  onKeep: (findingId: string, referenceKey: string) => Promise<void>;
}) {
  const prefix = useId();
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [selectedSource, setSelectedSource] = useState<string | null>(null);
  const sourceList = useRef<HTMLDetailsElement>(null);
  const citedIds = [
    ...new Set([
      ...sources.map((source) => source.evidenceId),
      ...(teaching
        ? [
            teaching.centralReading,
            teaching.context,
            teaching.application.principle,
            teaching.application.boundary,
          ].flatMap((p) => p.evidenceIds)
        : []),
      ...findings.flatMap((f) => [
        ...f.evidenceIds,
        ...f.interpretations.flatMap((i) => i.evidenceIds),
        ...f.relatedPassages.map((p) => p.evidenceId),
      ]),
    ]),
  ];
  const label = (id: string) => {
    const source = sources.find((item) => item.evidenceId === id);
    return source
      ? `${source.title} · ${studyReferenceLabel(source.referenceKey)}`
      : "Saved source";
  };
  const citations = (ids: string[]) => (
    <span className="ml-1 inline-flex flex-wrap gap-1 align-super font-sans text-[12px] leading-normal">
      {[...new Set(ids)]
        .filter((id) => citedIds.includes(id))
        .map((id) => (
          <button
            key={id}
            type="button"
            aria-label={`Source ${citedIds.indexOf(id) + 1}: ${label(id)}`}
            aria-controls={`${prefix}-sources`}
            onClick={() => {
              setSelectedSource(id);
              setSourcesOpen(true);
              sourceList.current?.scrollIntoView?.({ block: "nearest" });
              sourceList.current?.focus();
            }}
            className="text-[var(--pencil)] underline underline-offset-2"
          >
            [{citedIds.indexOf(id) + 1}]
          </button>
        ))}
      {ids.some((id) => !citedIds.includes(id)) && (
        <span>Saved source unavailable</span>
      )}
    </span>
  );
  const paragraph = (value: StudyTeaching["centralReading"]) => (
    <p className="whitespace-pre-wrap">
      {value.text}
      {citations(value.evidenceIds)}
    </p>
  );
  const empty = !findings.length ? (
    <p className="leading-[var(--reader-leading)]">
      {outcome === "insufficient_evidence"
        ? "There is not enough verified evidence here for a responsible deeper assessment."
        : "No additional substantive finding emerged from the material reviewed for these verses."}{" "}
      The coverage below describes what was reviewed, not everything that has
      been written about this passage.
    </p>
  ) : null;
  return (
    <div className="space-y-8">
      {empty}
      {teaching && (
        <>
          <h2 className="text-[1.3em] leading-snug">{teaching.title}</h2>
          {paragraph(teaching.centralReading)}
          <section aria-label="The passage in context" className="space-y-3">
            <h3 className="font-sans text-[15px] font-medium">
              The passage in context
            </h3>
            {paragraph(teaching.context)}
          </section>
        </>
      )}
      {findings.map((finding) => (
        <section
          key={finding.findingId}
          aria-label={METHODS[finding.lens]}
          className="space-y-4"
        >
          {finding.heading && (
            <h3 className="text-[1.1em] leading-snug">{finding.heading}</h3>
          )}
          <button
            type="button"
            onClick={() => onAnchor(finding.anchor.verseId)}
            className="block text-left text-[var(--pencil)] underline decoration-[var(--pencil-rule)] underline-offset-4"
          >
            <span className="font-sans text-[13px]">
              {studyReferenceLabel(finding.anchor.verseId)}
            </span>
            <span className="mt-1 block text-[0.9em]">
              “{finding.anchor.quote}”{" "}
              <span className="font-sans text-[12px]">WEB</span>
            </span>
          </button>
          <p className="whitespace-pre-wrap">
            {finding.observation}
            {citations(finding.evidenceIds)}
          </p>
          <p className="mt-4 whitespace-pre-wrap">{finding.consequence}</p>
          {finding.interpretations.length > 0 && (
            <div className="mt-5">
              <h4 className="font-sans text-[14px] font-medium">
                {finding.interpretations.length > 1
                  ? "Different readings"
                  : "Reading in the sources"}
              </h4>
              <div className="mt-4 space-y-5">
                {finding.interpretations.map((interpretation) => (
                  <div key={interpretation.position}>
                    <p className="whitespace-pre-wrap">
                      {interpretation.position}
                      {citations(interpretation.evidenceIds)}
                    </p>
                    <Limits items={interpretation.limitations} />
                  </div>
                ))}
              </div>
            </div>
          )}
          <Limits items={finding.limitations} />
          {finding.relatedPassages.map((related) => (
            <div
              key={`${related.referenceKey}:${related.evidenceId}`}
              className="mt-6 border-l-2 border-[var(--pencil-rule)] pl-4"
            >
              <p className="font-sans text-[14px]">
                {studyReferenceLabel(related.referenceKey)}{" "}
                <span className="text-[var(--ink-muted)]">
                  · {related.relation.replaceAll("_", " ")}
                </span>
              </p>
              <p className="mt-2 whitespace-pre-wrap">
                {related.explanation}
                {citations([related.evidenceId])}
              </p>
              <ScriptureReferenceKeep
                onKeep={() => onKeep(finding.findingId, related.referenceKey)}
              />
            </div>
          ))}
        </section>
      ))}
      {teaching && (
        <section
          aria-label="Reading this passage today"
          className="space-y-4 border-t border-[var(--reader-border)] pt-6"
        >
          <h3 className="text-[1.1em]">Reading this passage today</h3>
          {paragraph(teaching.application.principle)}
          {teaching.application.today && (
            <p className="whitespace-pre-wrap">{teaching.application.today}</p>
          )}
          <h4 className="font-sans text-[14px] font-medium">
            What this does not mean
          </h4>
          {paragraph(teaching.application.boundary)}
        </section>
      )}
      {renderFollowUps?.(citations)}
      {citedIds.length > 0 && (
        <details
          id={`${prefix}-sources`}
          ref={sourceList}
          tabIndex={-1}
          open={sourcesOpen}
          onToggle={(event) => {
            const open = event.currentTarget.open;
            setSourcesOpen(open);
            if (open && !selectedSource) setSelectedSource(citedIds[0] ?? null);
          }}
          className="border-t border-[var(--reader-border)] pt-5"
        >
          <summary className="cursor-pointer font-sans text-[14px] text-[var(--pencil)]">
            Sources
          </summary>
          {sourcesOpen && (
            <ol className="mt-4 space-y-4">
              {citedIds.map((id, index) => (
                <li key={id}>
                  <button
                    type="button"
                    onClick={() => setSelectedSource(id)}
                    aria-expanded={selectedSource === id}
                    className="text-left font-sans text-[13px] text-[var(--pencil)] underline underline-offset-4"
                  >
                    [{index + 1}] {label(id)}
                  </button>
                  {selectedSource === id && renderEvidence(id)}
                </li>
              ))}
            </ol>
          )}
        </details>
      )}
    </div>
  );
}

function Limits({ items }: { items: string[] }) {
  return items.length ? (
    <ul className="mt-4 space-y-2 font-sans text-[14px] leading-relaxed text-[var(--ink-muted)]">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  ) : null;
}

export function ScriptureReferenceKeep({
  onKeep,
}: {
  onKeep: () => Promise<void>;
}) {
  const [state, setState] = useState<"idle" | "saving" | "kept" | "error">(
    "idle",
  );
  const inFlight = useRef(false);
  const save = async () => {
    if (inFlight.current || state === "kept") return;
    inFlight.current = true;
    setState("saving");
    try {
      await onKeep();
      setState("kept");
    } catch {
      setState("error");
    } finally {
      inFlight.current = false;
    }
  };
  return (
    <div className="mt-3 font-sans text-[14px]">
      {state !== "kept" && (
        <button
          type="button"
          disabled={state === "saving"}
          onClick={() => void save()}
          className="text-[var(--pencil)] underline underline-offset-4"
        >
          {state === "saving" ? "Keeping…" : "Keep for later"}
        </button>
      )}
      <SavedMark visible={state === "kept"} hold>
        Kept
      </SavedMark>
      {state === "error" && (
        <InlineError
          message="The passage was not kept. Your reading has not moved."
          onRetry={() => void save()}
        />
      )}
    </div>
  );
}

export function ScriptureStudyEvidence({
  evidence,
}: {
  evidence: StudyEvidence | null | undefined;
}) {
  if (evidence === undefined)
    return (
      <p role="status" className="mt-3 font-sans text-[14px]">
        Loading saved evidence…
      </p>
    );
  if (!evidence)
    return (
      <p role="status" className="mt-3 font-sans text-[14px]">
        This saved evidence is unavailable. Reopen the latest study result.
      </p>
    );
  return (
    <div className="mt-4 border-l border-[var(--pencil-rule)] pl-4">
      <p className="font-sans text-[14px]">
        {evidence.source.title} · {evidence.locator}
      </p>
      <blockquote className="my-3 whitespace-pre-wrap break-words">
        {evidence.excerpt}
      </blockquote>
      <Limits items={evidence.limitations} />
      <p className="mt-3 break-words font-sans text-[12px] leading-relaxed text-[var(--ink-muted)]">
        {evidence.source.attribution} · {evidence.source.rights}
      </p>
      <div className="mt-2 font-sans text-[12px] text-[var(--ink-muted)]">
        <dl className="mt-2 space-y-1 break-words">
          <div>
            <dt className="inline">Revision: </dt>
            <dd className="inline">{evidence.source.revision}</dd>
          </div>
          <div>
            <dt className="inline">Locator URL: </dt>
            <dd className="inline">{evidence.source.url}</dd>
          </div>
          <div>
            <dt className="inline">License: </dt>
            <dd className="inline">{evidence.source.licenseUrl}</dd>
          </div>
          <div>
            <dt className="inline">SHA-256: </dt>
            <dd className="inline">{evidence.contentHash}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
