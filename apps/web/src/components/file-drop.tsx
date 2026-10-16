"use client";
import { useEffect, useRef, useState } from "react";

const hasFiles = (event: DragEvent) =>
  Array.from(event.dataTransfer?.types ?? []).includes("Files");

/**
 * Dropping a file anywhere on the page shows one calm target and hands the
 * files on. Dragging text or a link across the page does nothing. The page
 * decides what to make of the files; this only owns the gesture and the target.
 */
export function FileDrop({
  onFiles,
  title,
  hint,
}: {
  onFiles: (files: File[]) => void;
  title: string;
  hint: string;
}) {
  const [over, setOver] = useState(false);
  // Callers pass a fresh function each render; resubscribing would reset the depth mid-drag
  const handle = useRef(onFiles);
  handle.current = onFiles;

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
      const files = Array.from(event.dataTransfer?.files ?? []);
      if (files.length) handle.current(files);
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
  }, []);

  if (!over) return null;
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-[color-mix(in_srgb,var(--reader-bg)_82%,transparent)] p-6"
    >
      <div className="rounded-lg border-[1.5px] border-dashed border-[var(--reader-border-strong)] px-10 py-9 text-center sm:px-[70px] sm:py-[46px]">
        <p className="font-serif text-[26px] leading-tight sm:text-[30px]">
          {title}
        </p>
        <p className="mt-1.5 text-[14px] text-[var(--ink-muted)]">{hint}</p>
      </div>
    </div>
  );
}
