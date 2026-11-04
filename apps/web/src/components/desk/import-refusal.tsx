"use client";
import type { EpubDiagnostic } from "@marginalia/backend/epub-diagnostics";
import type { DocumentFormat } from "@/lib/document-import";
import { importDiagnosticCopy } from "@/lib/import-diagnostic";
import { useShortcuts } from "@/lib/shortcuts";
import { DocumentPickerButton } from "./document-picker";
import { ImportIdentity, type ImportIdentityProps } from "./import-identity";

export function ImportRefusal({
  sentence,
  detail,
  identity,
  format,
  diagnostic,
  reference,
  onFile,
  onDismiss,
}: {
  sentence: string;
  detail?: string;
  identity?: ImportIdentityProps;
  format?: DocumentFormat;
  diagnostic?: EpubDiagnostic;
  reference?: string;
  onFile: (file: File) => void;
  onDismiss: () => void;
}) {
  useShortcuts({ Escape: onDismiss }, true, {
    help: { group: "Import", keys: [["Esc", "Dismiss"]] },
  });
  const specifics = diagnostic ? importDiagnosticCopy(diagnostic) : null;
  return (
    <div className="max-w-[620px] min-w-0" role="alert">
      <p className="text-[11.5px] font-medium uppercase tracking-[0.08em] text-[var(--ink-muted)]">
        Couldn't read this{" "}
        {(identity?.format ?? format)?.toUpperCase() ?? "file"}
      </p>
      {identity && <ImportIdentity {...identity} />}
      <p className="mt-3 text-[15px] text-[var(--ink-soft)]">
        {specifics ?? sentence}
      </p>
      {detail && diagnostic?.code !== "unexpected_failure" && (
        <p className="mt-2 text-[15px] text-[var(--danger)]">{detail}</p>
      )}
      {reference && (
        <details className="mt-3 text-[12px] text-[var(--ink-muted)]">
          <summary className="cursor-pointer">Diagnostic details</summary>
          <p className="mt-1 break-all">Import reference: {reference}</p>
          {diagnostic && (
            <p>
              Stage: {diagnostic.stage} · Code: {diagnostic.code}
            </p>
          )}
        </details>
      )}
      <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2">
        <DocumentPickerButton
          className="rounded-md bg-[var(--reader-chip)] px-[18px] py-[9px] text-[14.5px] text-[var(--ink-soft)] hover:text-[var(--ink)]"
          onFile={(file) => {
            onDismiss();
            onFile(file);
          }}
        >
          Choose another file
        </DocumentPickerButton>
        <button
          type="button"
          className="text-[14.5px] text-[var(--ink-soft)] underline decoration-[color-mix(in_srgb,var(--ink)_20%,transparent)] underline-offset-[3px] hover:text-[var(--ink)]"
          onClick={onDismiss}
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
