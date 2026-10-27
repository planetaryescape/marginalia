"use client";

import { referenceFromKey } from "@marginalia/backend/scripture-references";
import type {
  StudyEvidence,
  StudyFinding,
} from "@marginalia/backend/scripture-study";
import type { ReactNode } from "react";
import { useRef, useState } from "react";
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
  outcome,
  renderEvidence,
  onAnchor,
  onKeep,
}: {
  findings: StudyFinding[];
  outcome: string | null;
  renderEvidence: (evidenceId: string) => ReactNode;
  onAnchor: (verseId: string) => void;
  onKeep: (findingId: string, referenceKey: string) => Promise<void>;
}) {
  if (!findings.length) {
    return (
      <p className="leading-[var(--reader-leading)]">
        {outcome === "insufficient_evidence"
          ? "There is not enough verified evidence here for a responsible deeper assessment."
          : "No additional substantive finding emerged from the material reviewed for these verses."}{" "}
        The coverage below describes what was reviewed, not everything that has
        been written about this passage.
      </p>
    );
  }
  return (
    <div className="space-y-10">
      {findings.map((finding) => (
        <section
          key={finding.findingId}
          aria-label={METHODS[finding.lens]}
          className="border-b border-[var(--reader-border)] pb-8 last:border-0"
        >
          <p className="mb-3 font-sans text-[13px] text-[var(--ink-muted)]">
            {METHODS[finding.lens]}
          </p>
          <button
            type="button"
            onClick={() => onAnchor(finding.anchor.verseId)}
            className="mb-4 block text-left text-[var(--pencil)] underline decoration-[var(--pencil-rule)] underline-offset-4"
          >
            <span className="font-sans text-[13px]">
              {studyReferenceLabel(finding.anchor.verseId)}
            </span>
            <span className="mt-1 block">
              “{finding.anchor.quote}”{" "}
              <span className="font-sans text-[12px]">WEB</span>
            </span>
          </button>
          <p className="whitespace-pre-wrap">{finding.observation}</p>
          <p className="mt-4 whitespace-pre-wrap">{finding.consequence}</p>
          {finding.interpretations.length > 0 && (
            <details className="mt-5">
              <summary className="cursor-pointer font-sans text-[14px] text-[var(--pencil)]">
                Interpretations in the reviewed sources
              </summary>
              <div className="mt-4 space-y-5">
                {finding.interpretations.map((interpretation) => (
                  <div key={interpretation.position}>
                    <p className="whitespace-pre-wrap">
                      {interpretation.position}
                    </p>
                    {interpretation.evidenceIds.map((id) => (
                      <EvidenceDisclosure
                        key={id}
                        evidenceId={id}
                        renderEvidence={renderEvidence}
                      />
                    ))}
                    <Limits items={interpretation.limitations} />
                  </div>
                ))}
              </div>
            </details>
          )}
          <div className="mt-5">
            {finding.evidenceIds.map((id) => (
              <EvidenceDisclosure
                key={id}
                evidenceId={id}
                renderEvidence={renderEvidence}
              />
            ))}
          </div>
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
              <p className="mt-2 whitespace-pre-wrap">{related.explanation}</p>
              <EvidenceDisclosure
                evidenceId={related.evidenceId}
                renderEvidence={renderEvidence}
              />
              <ScriptureReferenceKeep
                onKeep={() => onKeep(finding.findingId, related.referenceKey)}
              />
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}

function EvidenceDisclosure({
  evidenceId,
  renderEvidence,
}: {
  evidenceId: string;
  renderEvidence: (id: string) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <details
      className="mt-3"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="cursor-pointer font-sans text-[14px] text-[var(--pencil)]">
        Evidence · {evidenceId}
      </summary>
      {open ? renderEvidence(evidenceId) : null}
    </details>
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
      <blockquote className="my-3 whitespace-pre-wrap">
        {evidence.excerpt}
      </blockquote>
      <Limits items={evidence.limitations} />
      <p className="mt-3 break-words font-sans text-[12px] leading-relaxed text-[var(--ink-muted)]">
        {evidence.source.attribution} · {evidence.source.rights}
      </p>
      <details className="mt-2 font-sans text-[12px] text-[var(--ink-muted)]">
        <summary className="cursor-pointer">Source record</summary>
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
      </details>
    </div>
  );
}
