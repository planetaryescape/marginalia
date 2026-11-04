import { formatReadTime } from "@/lib/utils";
import { documentFormat } from "./document-import";

/**
 * The reader's one meta line under the title: where it came from, then how
 * long it is, with a book's part first. The source is the site, not the
 * author; an upload has no site, so it says what it is.
 */
export function readerMeta(input: {
  url: string;
  uploaded: boolean;
  uploadedFileName?: string;
  format?: "pdf" | "epub";
  author?: string;
  minutes?: number;
  part?: { index: number; of: number; title?: string };
}): string {
  let host = "";
  try {
    host = new URL(input.url).hostname.replace(/^www\./, "");
  } catch {
    // An uploaded file's address is not a URL
  }
  const format =
    input.format ??
    documentFormat({ name: input.uploadedFileName ?? "", type: "" }) ??
    (input.part ? null : "pdf");
  const upload = format?.toUpperCase() ?? "Upload";
  const source = host || (input.uploaded ? upload : (input.author ?? ""));
  return [
    input.part
      ? format === "epub" && input.uploaded
        ? input.part.title?.trim() || "Chapter"
        : `Part ${input.part.index + 1} of ${input.part.of}`
      : "",
    source,
    input.minutes ? formatReadTime(input.minutes) : "",
  ]
    .filter(Boolean)
    .join(" · ");
}
