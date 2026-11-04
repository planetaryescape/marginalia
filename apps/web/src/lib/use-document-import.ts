"use client";
import { api } from "@marginalia/backend/convex/_generated/api";
import type { Id } from "@marginalia/backend/convex/_generated/dataModel";
import { useMutation } from "convex/react";
import { useCallback, useRef, useState } from "react";
import {
  type DocumentFormat,
  documentFormat,
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

export function useDocumentImportState(operations: DocumentImportOperations) {
  const [upload, setUpload] = useState<UploadState | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [problemFormat, setProblemFormat] = useState<DocumentFormat | null>(
    null,
  );
  const [importId, setImportId] = useState<Id<"documentImports"> | null>(null);
  const busy = useRef(false);

  const complete = useCallback(
    async (file: File) => {
      try {
        const result = await uploadDocument(file, operations, (state) => {
          setUpload(state);
        });
        if (!result.ok) setProblem(result.error);
        else {
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
        setProblem(
          "Another file is still uploading. Wait for it to finish, then choose this file again.",
        );
        return { accepted: false };
      }
      busy.current = true;
      setProblem(null);
      setProblemFormat(documentFormat(file));
      setImportId(null);
      return { accepted: true, completion: complete(file) };
    },
    [complete],
  );

  return {
    start,
    upload,
    importId,
    problem,
    problemFormat,
    clearProblem: () => setProblem(null),
    dismiss: (importId: Id<"documentImports">) =>
      operations.dismiss({ importId }).catch((error: unknown) => {
        setProblem(
          failureSentence(
            error,
            "Couldn't dismiss this import. Check your connection and try again.",
          ),
        );
      }),
  };
}
