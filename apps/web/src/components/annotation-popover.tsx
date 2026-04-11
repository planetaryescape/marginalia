"use client";
import { motion } from "framer-motion";
import { obsidianLink } from "@/lib/utils";

const TYPE_CONFIG = {
  cross_reference: {
    icon: "~",
    label: "Cross-reference",
    color: "text-annotation-crossref",
    accent: "bg-annotation-crossref",
  },
  context: {
    icon: "i",
    label: "Context",
    color: "text-annotation-context",
    accent: "bg-annotation-context",
  },
  tension: {
    icon: "!",
    label: "Tension",
    color: "text-annotation-tension",
    accent: "bg-annotation-tension",
  },
  question: {
    icon: "?",
    label: "Question",
    color: "text-annotation-question",
    accent: "bg-annotation-question",
  },
} as const;

interface AnnotationPopoverProps {
  annotation: {
    type: keyof typeof TYPE_CONFIG;
    content: string;
    notePath?: string;
    noteExcerpt?: string;
  };
  onClose: () => void;
}

export function AnnotationPopover({
  annotation,
  onClose,
}: AnnotationPopoverProps) {
  const config = TYPE_CONFIG[annotation.type];

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 4 }}
      transition={{ duration: 0.15, ease: "easeOut" }}
      className="rounded-xl border border-ink-200 dark:border-ink-700 bg-white dark:bg-ink-900 shadow-xl shadow-black/20 p-5"
      onClick={(e) => e.stopPropagation()}
    >
      {/* Accent bar + header */}
      <div className="flex items-center gap-2.5 mb-3">
        <span
          className={`w-7 h-7 rounded-full ${config.accent} flex items-center justify-center text-xs font-mono font-bold text-white`}
        >
          {config.icon}
        </span>
        <span
          className={`text-xs font-sans font-semibold ${config.color} uppercase tracking-wider`}
        >
          {config.label}
        </span>
        <button
          onClick={onClose}
          className="ml-auto w-6 h-6 flex items-center justify-center rounded-full hover:bg-ink-100 dark:hover:bg-ink-800 text-ink-400 hover:text-ink-600 dark:hover:text-ink-300 text-sm font-sans transition-colors"
        >
          &times;
        </button>
      </div>

      {/* Content */}
      <p className="text-sm font-sans text-ink-700 dark:text-parchment-200 leading-relaxed mb-3">
        {annotation.content}
      </p>

      {/* Note excerpt */}
      {annotation.noteExcerpt && (
        <blockquote className="text-xs font-sans text-ink-500 dark:text-ink-400 border-l-2 border-ink-300 dark:border-ink-600 pl-3 mb-3 italic leading-relaxed">
          {annotation.noteExcerpt}
        </blockquote>
      )}

      {/* Open in Obsidian link */}
      {annotation.notePath && (
        <a
          href={obsidianLink(annotation.notePath)}
          className={`inline-flex items-center gap-1.5 text-xs font-sans font-semibold ${config.color} hover:underline`}
        >
          {annotation.notePath.replace(/\.md$/, "")} &rarr;
        </a>
      )}
    </motion.div>
  );
}
