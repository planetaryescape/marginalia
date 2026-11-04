import { formatReadTime } from "@/lib/utils";

/**
 * The reader's one meta line under the title: where it came from, then how
 * long it is, with a book's part first. The source is the site, not the
 * author; an upload has no site, so it says what it is.
 */
export function readerMeta(input: {
  url: string;
  uploaded: boolean;
  uploadedFileName?: string;
  author?: string;
  minutes?: number;
  part?: { index: number; of: number };
}): string {
  let host = "";
  try {
    host = new URL(input.url).hostname.replace(/^www\./, "");
  } catch {
    // An uploaded file's address is not a URL
  }
  const upload = /\.epub$/i.test(input.uploadedFileName ?? "")
    ? "EPUB"
    : !input.uploadedFileName || /\.pdf$/i.test(input.uploadedFileName)
      ? "PDF"
      : "Upload";
  const source = host || (input.uploaded ? upload : (input.author ?? ""));
  return [
    input.part ? `Part ${input.part.index + 1} of ${input.part.of}` : "",
    source,
    input.minutes ? formatReadTime(input.minutes) : "",
  ]
    .filter(Boolean)
    .join(" · ");
}
