"use client";
import { FileDrop } from "@/components/file-drop";
import { firstPdf } from "@/lib/pdf-import";

/** Dropping a PDF anywhere on the desk reads it in. */
export function PdfDrop({ onFile }: { onFile: (file: File) => void }) {
  return (
    <FileDrop
      title="Drop to read"
      hint="A PDF becomes an article in your library"
      onFiles={(files) => {
        // A drop with no PDF in it falls to the import's own message
        const file = firstPdf(files) ?? files[0];
        if (file) onFile(file);
      }}
    />
  );
}
