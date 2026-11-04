import type { DocumentFormat } from "@/lib/document-import";

export type ImportIdentityProps = {
  title?: string;
  author?: string;
  fileName?: string;
  format: DocumentFormat;
};

export function ImportIdentity({
  title,
  author,
  fileName,
  format,
}: ImportIdentityProps) {
  const heading =
    title ||
    (format === "epub"
      ? "Your EPUB"
      : fileName?.replace(/\.pdf$/i, "") || "Your PDF");
  return (
    <>
      <h2 className="mt-2 break-words font-serif text-[24px] leading-tight lg:text-[30px]">
        {heading}
      </h2>
      {author && (
        <p className="mt-1.5 break-words text-[15px] text-[var(--ink-soft)]">
          {author}
        </p>
      )}
      {fileName && (
        <p
          title={fileName}
          className="mt-1.5 max-w-full truncate text-[12px] text-[var(--ink-muted)]"
        >
          {fileName}
        </p>
      )}
    </>
  );
}
