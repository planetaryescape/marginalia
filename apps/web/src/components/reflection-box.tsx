"use client";
import { api } from "@marginalia/backend/convex/_generated/api";
import { useMutation } from "convex/react";
import { motion } from "framer-motion";
import { type MutableRefObject, useEffect, useRef, useState } from "react";
import { createNoteAutosave } from "@/lib/note-autosave";

interface Reflection {
  _id: string;
  strongestPoint: string;
  weakestAssumption: string;
  credibleCounterview: string;
  questionForYou: string;
  userResponse?: string;
}

interface ReflectionBoxProps {
  reflection: Reflection;
  /** Filled with a function that saves any unsaved text, so Done can wait for it */
  flushRef?: MutableRefObject<(() => Promise<boolean>) | null>;
}

const SAVE_DELAY_MS = 700;

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

export function ReflectionBox({ reflection, flushRef }: ReflectionBoxProps) {
  const [response, setResponse] = useState(reflection.userResponse ?? "");
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">(
    "idle",
  );
  const saveResponse = useMutation(api.reflections.saveResponse);
  const reflectionId = reflection._id;
  const saveRef = useRef(saveResponse);
  saveRef.current = saveResponse;
  const timer = useRef<number | null>(null);

  // Typing saves itself, as the impression does: nothing waits for Done
  const autosave = useRef<ReturnType<typeof createNoteAutosave> | null>(null);
  if (!autosave.current)
    autosave.current = createNoteAutosave(async ({ plain }) => {
      setStatus("saving");
      try {
        await saveRef.current({
          reflectionId: reflectionId as any,
          userResponse: plain.trim(),
        });
        setStatus("saved");
        return true;
      } catch {
        setStatus("error");
        return false;
      }
    });
  const flush = () => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
    return autosave.current?.flush() ?? Promise.resolve(true);
  };
  const flushLatest = useRef(flush);
  flushLatest.current = flush;
  useEffect(() => {
    if (flushRef) flushRef.current = () => flushLatest.current();
    return () => {
      if (flushRef) flushRef.current = null;
      void flushLatest.current();
    };
  }, [flushRef]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
      className="border-t border-[var(--reader-border)] pt-10"
    >
      {/* Section title */}
      <div className="text-center mb-10">
        <p className="text-xs font-sans text-[var(--ink-muted)] uppercase tracking-[0.2em] mb-2">
          Before you go
        </p>
        <div className="w-8 h-px bg-[var(--reader-border-strong)] mx-auto" />
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
        <div
          className="mb-1 h-4 text-right text-[11px] font-sans text-[var(--ink-muted)]"
          aria-live="polite"
        >
          {status === "saving"
            ? "Saving…"
            : status === "saved"
              ? "Saved"
              : status === "error"
                ? "Couldn't save. Try again."
                : ""}
        </div>
        <textarea
          aria-label="Your reflection"
          value={response}
          onChange={(e) => {
            const value = e.target.value;
            setResponse(value);
            autosave.current?.change({ html: value, plain: value });
            if (timer.current) window.clearTimeout(timer.current);
            timer.current = window.setTimeout(
              () => void flushLatest.current(),
              SAVE_DELAY_MS,
            );
          }}
          onBlur={() => void flush()}
          placeholder="Your thoughts (optional)"
          className="w-full p-4 rounded-lg border border-[var(--reader-border-strong)] bg-[var(--reader-surface)] text-[var(--reader-fg)] font-sans text-sm placeholder:text-[var(--reader-muted)] focus:outline-none focus:border-[var(--ink-muted)] resize-none"
          rows={3}
        />
      </div>
    </motion.div>
  );
}
