"use client";
import { useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";

interface SelectionToolbarProps {
  containerRef: React.RefObject<HTMLElement | null>;
  onAddNote: (selection: {
    text: string;
    startOffset?: number;
    endOffset?: number;
  }) => void;
}

export function SelectionToolbar({
  containerRef,
  onAddNote,
}: SelectionToolbarProps) {
  const [position, setPosition] = useState<{
    top: number;
    left: number;
  } | null>(null);
  const [selectedText, setSelectedText] = useState("");

  const handleSelectionChange = useCallback(() => {
    const selection = window.getSelection();
    if (
      !selection ||
      selection.isCollapsed ||
      !selection.rangeCount ||
      !containerRef.current
    ) {
      // Small delay before hiding — avoids flicker when clicking the toolbar
      setTimeout(() => {
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed) {
          setPosition(null);
          setSelectedText("");
        }
      }, 200);
      return;
    }

    const range = selection.getRangeAt(0);

    // Only show if selection is inside the article container
    if (!containerRef.current.contains(range.commonAncestorContainer)) {
      setPosition(null);
      setSelectedText("");
      return;
    }

    const text = selection.toString().trim();
    if (text.length < 5) {
      setPosition(null);
      setSelectedText("");
      return;
    }

    const rect = range.getBoundingClientRect();
    setPosition({
      top: rect.top - 44,
      left: rect.left + rect.width / 2 - 50,
    });
    setSelectedText(text);
  }, [containerRef]);

  useEffect(() => {
    document.addEventListener("selectionchange", handleSelectionChange);
    return () =>
      document.removeEventListener("selectionchange", handleSelectionChange);
  }, [handleSelectionChange]);

  const handleClick = () => {
    onAddNote({ text: selectedText });
    // Clear selection
    window.getSelection()?.removeAllRanges();
    setPosition(null);
    setSelectedText("");
  };

  return (
    <AnimatePresence>
      {position && selectedText && (
        <motion.div
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 4 }}
          transition={{ duration: 0.1 }}
          className="fixed z-50"
          style={{ top: position.top, left: position.left }}
        >
          <button
            onMouseDown={(e) => {
              e.preventDefault(); // Prevent losing selection
              handleClick();
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-ink-950 dark:bg-parchment-100 text-parchment-50 dark:text-ink-950 rounded-lg text-xs font-sans font-medium shadow-lg shadow-black/30 hover:opacity-90 transition-opacity"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
            </svg>
            Add note
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
