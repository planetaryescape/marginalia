import type { api } from "@marginalia/backend/convex/_generated/api";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import {
  type DocumentFormat,
  documentFormat,
  problemWithFile,
  sha256Hex,
  type uploadWithProgress,
} from "./document-import";
import { readEpubMetadata } from "./epub-metadata";
import { failureSentence } from "./failure-copy";

export type UploadState = {
  fileName: string;
  format: DocumentFormat;
  percent: number;
  title?: string;
  author?: string;
  stage: "metadata" | "checking" | "uploading";
};

export type DocumentUploadOperations = {
  generateUploadUrl: (
    args: FunctionArgs<typeof api.documentImports.generateUploadUrl>,
  ) => Promise<string>;
  startImport: (
    args: FunctionArgs<typeof api.documentImports.start>,
  ) => Promise<FunctionReturnType<typeof api.documentImports.start>>;
  upload: typeof uploadWithProgress;
};

export async function uploadDocument(
  file: File,
  operations: DocumentUploadOperations,
  onUpload: (state: UploadState) => void,
) {
  const format = documentFormat(file);
  if (!format)
    return {
      ok: false,
      error: "Marginalia reads PDF and EPUB files.",
    } as const;
  const problem = problemWithFile(file);
  if (problem) return { ok: false, error: problem } as const;
  try {
    onUpload({
      fileName: file.name,
      format,
      percent: 0,
      stage: format === "epub" ? "metadata" : "checking",
    });
    const metadata = format === "epub" ? await readEpubMetadata(file) : null;
    const identity = { fileName: file.name, format, ...metadata };
    if (format === "epub")
      onUpload({ ...identity, percent: 0, stage: "checking" });
    const sha256 = await sha256Hex(file);
    const url = await operations.generateUploadUrl({
      sha256,
      size: file.size,
      format,
    });
    onUpload({ ...identity, percent: 0, stage: "uploading" });
    const storageId = await operations.upload(
      url,
      file,
      (percent) => onUpload({ ...identity, percent, stage: "uploading" }),
      format,
    );
    return await operations.startImport({
      // SAFETY: Convex storage returns the ID of the file just uploaded.
      storageId: storageId as FunctionArgs<
        typeof api.documentImports.start
      >["storageId"],
      fileName: file.name,
      format,
    });
  } catch (error) {
    return {
      ok: false,
      error: failureSentence(error, "The upload didn't finish. Try again."),
    } as const;
  }
}
