"use client";
import { api } from "@marginalia/backend/convex/_generated/api";
import { useMutation } from "convex/react";
import { motion } from "framer-motion";
import { useState } from "react";

interface Reflection {
  _id: string;
  strongestPoint: string;
  weakestAssumption: string;
  credibleCounterview: string;
  questionForYou: string;
}

interface ReflectionBoxProps {
  reflection: Reflection;
  onDone: () => void;
}

const PROMPTS = [
  {
    key: "strongestPoint" as const,
    label: "Strongest point",
    description: "The most defensible claim in this article",
  },
  {
    key: "weakestAssumption" as const,
    label: "Weakest assumption",
    description: "What must be true for this to hold",
  },
  {
    key: "credibleCounterview" as const,
    label: "A credible counterview",
    description: "What a thoughtful critic would say",
  },
  {
    key: "questionForYou" as const,
    label: "A question for you",
    description: "Something to sit with",
  },
];

export function ReflectionBox({ reflection, onDone }: ReflectionBoxProps) {
  const [response, setResponse] = useState("");
  const saveResponse = useMutation(api.reflections.saveResponse);

  const handleDone = async () => {
    if (response.trim()) {
      await saveResponse({
        reflectionId: reflection._id as any,
        userResponse: response.trim(),
      });
    }
    onDone();
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
      className="border-t border-ink-200 dark:border-ink-700 pt-10"
    >
      {/* Section title */}
      <div className="text-center mb-10">
        <p className="text-xs font-sans text-ink-400 dark:text-ink-500 uppercase tracking-[0.2em] mb-2">
          Before you go
        </p>
        <div className="w-8 h-px bg-ink-300 dark:bg-ink-600 mx-auto" />
      </div>

      {/* Reflection prompts */}
      <div className="space-y-8">
        {PROMPTS.map((prompt, i) => (
          <motion.div
            key={prompt.key}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 * i, duration: 0.3 }}
          >
            <div>
              <h3 className="text-sm font-sans font-medium text-[var(--ink-muted)] mb-1">
                {prompt.label}
              </h3>
              <p className="text-base font-sans text-[var(--pencil)] leading-relaxed">
                {reflection[prompt.key]}
              </p>
            </div>
          </motion.div>
        ))}
      </div>

      {/* User response */}
      <div className="mt-10">
        <textarea
          aria-label="Your reflection"
          value={response}
          onChange={(e) => setResponse(e.target.value)}
          placeholder="Your thoughts (optional)"
          className="w-full p-4 rounded-xl border border-[var(--reader-border-strong)] bg-[var(--reader-surface)] text-ink-800 dark:text-parchment-300 font-sans text-sm placeholder:text-ink-300 dark:placeholder:text-ink-600 focus:outline-none focus:border-[var(--ink-muted)] resize-none"
          rows={3}
        />
      </div>

      {/* Done */}
      <div className="mt-6 text-center">
        <button
          onClick={handleDone}
          className="px-8 py-3 rounded-md bg-[var(--ink)] text-[var(--reader-bg)] font-sans text-sm font-medium hover:opacity-90 transition-opacity"
        >
          Done
        </button>
      </div>
    </motion.div>
  );
}
