"use client";
import { useEffect, useState } from "react";
import { firstPdf } from "@/lib/pdf-import";

const hasFiles = (event: DragEvent) =>
  Array.from(event.dataTransfer?.types ?? []).includes("Files");

/**
 * Dropping a PDF anywhere on the page shows one calm target and hands the file
 * on. Dragging text or a link across the page does nothing.
 */
export function PdfDrop({ onFile }: { onFile: (file: File) => void }) {
  const [over, setOver] = useState(false);

  useEffect(() => {
    // dragenter and dragleave fire for every child; the depth says when the drag has left the page
    let depth = 0;
    const enter = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      depth++;
      setOver(true);
    };
    const leave = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setOver(false);
    };
    const dragOver = (event: DragEvent) => {
      // Without this the browser opens the file in the tab
      if (hasFiles(event)) event.preventDefault();
    };
    const drop = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      depth = 0;
      setOver(false);
      const file = firstPdf(Array.from(event.dataTransfer?.files ?? []));
      if (file) onFile(file);
      // A drop with no PDF in it falls to the import's own message
      else if (event.dataTransfer?.files[0])
        onFile(event.dataTransfer.files[0]);
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("dragover", dragOver);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragover", dragOver);
      window.removeEventListener("drop", drop);
    };
  }, [onFile]);

  if (!over) return null;
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-[color-mix(in_srgb,var(--reader-bg)_82%,transparent)] p-6"
    >
      <div className="rounded-xl border-[1.5px] border-dashed border-[var(--reader-border-strong)] px-10 py-9 text-center sm:px-[70px] sm:py-[46px]">
        <p className="font-serif text-[26px] leading-tight sm:text-[30px]">
          Drop to read
        </p>
        <p className="mt-1.5 text-[14px] text-[var(--ink-muted)]">
          A PDF becomes an article in your library
        </p>
      </div>
    </div>
  );
}
