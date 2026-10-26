"use client";
import { api } from "@marginalia/backend/convex/_generated/api";
import type { Id } from "@marginalia/backend/convex/_generated/dataModel";
import { useMutation } from "convex/react";
import { useCallback, useRef, useState } from "react";
import { problemWithFile, uploadWithProgress } from "./pdf-import";
import { invalidateTopicSearchCache } from "./topic-search-cache";

export interface UploadState {
  fileName: string;
  /** 0 to 100 while the file goes up; the server then takes over */
  percent: number;
}

/**
 * Uploads a PDF to storage and starts its import. The server's steps then
 * arrive through `documentImports.latest`; this only holds the part before
 * that, and any problem with the file itself.
 */
export function usePdfImport() {
  const generateUploadUrl = useMutation(api.documentImports.generateUploadUrl);
  const startImport = useMutation(api.documentImports.start);
  const dismiss = useMutation(api.documentImports.dismiss);
  const [upload, setUpload] = useState<UploadState | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const busy = useRef(false);

  const start = useCallback(
    async (file: File) => {
      if (busy.current) return;
      const found = problemWithFile(file);
      if (found) return setProblem(found);
      busy.current = true;
      setProblem(null);
      setUpload({ fileName: file.name, percent: 0 });
      try {
        const url = await generateUploadUrl({});
        const storageId = await uploadWithProgress(url, file, (percent) =>
          setUpload({ fileName: file.name, percent }),
        );
        const result = await startImport({
          // SAFETY: the storage upload response returns the ID of the file just stored.
          storageId: storageId as Id<"_storage">,
          fileName: file.name,
        });
        if (!result.ok) setProblem(result.error);
        else invalidateTopicSearchCache();
      } catch (error) {
        setProblem(
          error instanceof Error && error.message
            ? error.message
            : "The upload didn't finish. Try again.",
        );
      } finally {
        busy.current = false;
        setUpload(null);
      }
    },
    [generateUploadUrl, startImport],
  );

  return {
    start,
    upload,
    problem,
    clearProblem: () => setProblem(null),
    dismiss: (importId: Id<"documentImports">) =>
      dismiss({ importId }).catch(() => {}),
  };
}
