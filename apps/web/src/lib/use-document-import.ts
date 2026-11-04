"use client";
import { api } from "@marginalia/backend/convex/_generated/api";
import type { Id } from "@marginalia/backend/convex/_generated/dataModel";
import { useMutation } from "convex/react";
import { useCallback, useRef, useState } from "react";
import {
  type DocumentFormat,
  documentFormat,
  problemWithFile,
  uploadWithProgress,
} from "./document-import";
import {
  type DocumentUploadOperations,
  type UploadState,
  uploadDocument,
} from "./document-upload";
import { failureSentence } from "./failure-copy";
import { invalidateTopicSearchCache } from "./topic-search-cache";

/**
 * Uploads a document to storage and starts its import. The server's steps then
 * arrive through `documentImports.latest`; this only holds the part before
 * that, and any problem with the file itself.
 */
export function useDocumentImport() {
  const generateUploadUrl = useMutation(api.documentImports.generateUploadUrl);
  const startImport = useMutation(api.documentImports.start);
  const dismiss = useMutation(api.documentImports.dismiss);
  return useDocumentImportState({
    generateUploadUrl,
    startImport,
    upload: uploadWithProgress,
    dismiss,
  });
}

type DocumentImportOperations = DocumentUploadOperations & {
  dismiss: (args: { importId: Id<"documentImports"> }) => Promise<unknown>;
};

type ImportAdmission =
  | { accepted: false }
  | { accepted: true; completion: Promise<void> };

type ImportProblem =
  | {
      origin: "file";
      message: string;
      format: DocumentFormat | null;
      identity?: UploadState;
    }
  | { origin: "busy" | "dismiss"; message: string };

export function useDocumentImportState(operations: DocumentImportOperations) {
  const [upload, setUpload] = useState<UploadState | null>(null);
  const [problem, setProblem] = useState<ImportProblem | null>(null);
  const [importId, setImportId] = useState<Id<"documentImports"> | null>(null);
  const [preview, setPreview] = useState<UploadState | null>(null);
  const busy = useRef(false);

  const complete = useCallback(
    async (file: File) => {
      let identity: UploadState | undefined;
      try {
        const result = await uploadDocument(file, operations, (state) => {
          identity = state;
          setUpload(state);
          setPreview(state);
        });
        if (!result.ok)
          setProblem({
            origin: "file",
            message: result.error,
            format: documentFormat(file),
            identity,
          });
        else {
          setProblem(null);
          setImportId(result.importId);
          invalidateTopicSearchCache();
        }
      } finally {
        busy.current = false;
        setUpload(null);
      }
    },
    [operations],
  );

  const start = useCallback(
    (file: File): ImportAdmission => {
      if (busy.current) {
        setProblem({
          origin: "busy",
          message:
            "Another file is still uploading. Wait for it to finish, then choose this file again.",
        });
        return { accepted: false };
      }
      const refusal = problemWithFile(file);
      if (refusal) {
        setProblem({
          origin: "file",
          message: refusal,
          format: documentFormat(file),
        });
        return { accepted: false };
      }
      busy.current = true;
      setProblem(null);
      setImportId(null);
      setPreview(null);
      return { accepted: true, completion: complete(file) };
    },
    [complete],
  );

  return {
    start,
    upload,
    importId,
    preview,
    problem: problem?.message ?? null,
    problemOrigin: problem?.origin,
    problemIdentity: problem?.origin === "file" ? problem.identity : undefined,
    problemFormat: problem?.origin === "file" ? problem.format : null,
    clearProblem: () => setProblem(null),
    dismiss: (importId: Id<"documentImports">) =>
      operations.dismiss({ importId }).catch((error: unknown) => {
        setProblem({
          origin: "dismiss",
          message: failureSentence(
            error,
            "Couldn't dismiss this import. Check your connection and try again.",
          ),
        });
      }),
  };
}
