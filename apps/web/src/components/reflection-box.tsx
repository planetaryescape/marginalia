"use client";
import { useMutation } from "convex/react";
import { useState } from "react";
import { api } from "@marginalia/backend/convex/_generated/api";
import { motion } from "framer-motion";

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
    icon: "^",
    description: "The most defensible claim in this article",
  },
  {
    key: "weakestAssumption" as const,
    label: "Weakest assumption",
    icon: "~",
    description: "What must be true for this to hold",
  },
  {
    key: "credibleCounterview" as const,
    label: "A credible counterview",
    icon: "!",
    description: "What a thoughtful critic would say",
  },
  {
    key: "questionForYou" as const,
    label: "A question for you",
    icon: "?",
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
            <div className="flex items-start gap-4">
              {/* Icon */}
              <span className="w-8 h-8 rounded-full border border-ink-200 dark:border-ink-700 flex items-center justify-center text-sm font-mono text-ink-400 dark:text-ink-500 flex-shrink-0 mt-0.5">
                {prompt.icon}
              </span>
              <div>
                <h3 className="text-sm font-sans font-medium text-ink-600 dark:text-ink-400 mb-1">
                  {prompt.label}
                </h3>
                <p className="text-base font-serif text-ink-800 dark:text-parchment-300 leading-relaxed">
                  {reflection[prompt.key]}
                </p>
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      {/* User response */}
      <div className="mt-10">
        <textarea
          value={response}
          onChange={(e) => setResponse(e.target.value)}
          placeholder="Your thoughts (optional)"
          className="w-full p-4 rounded-xl border border-ink-200 dark:border-ink-700 bg-white dark:bg-ink-900 text-ink-800 dark:text-parchment-300 font-sans text-sm placeholder:text-ink-300 dark:placeholder:text-ink-600 focus:outline-none focus:border-annotation-crossref resize-none"
          rows={3}
        />
      </div>

      {/* Done */}
      <div className="mt-6 text-center">
        <button
          onClick={handleDone}
          className="px-8 py-3 bg-ink-950 dark:bg-parchment-100 text-parchment-50 dark:text-ink-950 rounded-xl font-sans text-sm font-medium hover:opacity-90 transition-opacity"
        >
          Done
        </button>
      </div>
    </motion.div>
  );
}
