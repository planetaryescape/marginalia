"use client";
import type { BibleSuggestion, ReadingScope } from "@marginalia/backend/bible";
import { api } from "@marginalia/backend/convex/_generated/api";
import { useAction } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useState } from "react";
import { BibleBrowser } from "./bible-browser";
import { ReadingScopeControl } from "./reading-scope";

export function BibleDiscovery({
  preferences,
  minutes,
}: {
  preferences?: { enabled: boolean; scope: ReadingScope; translation: string };
  minutes?: number;
}) {
  if (!preferences?.enabled) return null;
  return (
    <section aria-label="Bible discovery" className="space-y-4">
      <ReadingScopeControl scope={preferences.scope} />
      {preferences.scope !== "articles" && (
        <PassageFinder
          key={preferences.translation}
          minutes={minutes}
          translation={preferences.translation}
        />
      )}
    </section>
  );
}

function PassageFinder({
  minutes,
  translation,
}: {
  minutes?: number;
  translation: string;
}) {
  const suggest = useAction(api.actions.bible.suggest);
  const openPassage = useAction(api.actions.bible.openReading);
  const router = useRouter();
  const inputId = useId();
  const [draft, setDraft] = useState("");
  const [request, setRequest] = useState({ question: "", retry: 0 });
  const [result, setResult] = useState<{
    passages: BibleSuggestion[];
    notice: string | null;
  } | null>(null);
  const [error, setError] = useState("");
  const [opening, setOpening] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    setResult(null);
    setError("");
    const timeout = setTimeout(() => {
      current = false;
      setError("Bible search couldn't complete. Please try again.");
    }, 30_000);
    void suggest({ question: request.question, minutes }).then(
      (value) => {
        if (current) setResult(value);
        clearTimeout(timeout);
      },
      () => {
        if (current)
          setError("Bible search couldn't complete. Please try again.");
        clearTimeout(timeout);
      },
    );
    return () => {
      current = false;
      clearTimeout(timeout);
    };
  }, [suggest, request, minutes]);

  return (
    <div className="space-y-4">
      <form
        className="space-y-2"
        onSubmit={(event) => {
          event.preventDefault();
          setRequest({ question: draft.trim(), retry: request.retry + 1 });
        }}
      >
        <label htmlFor={inputId} className="block text-sm">
          Bible topic or passage{minutes ? ` · up to ${minutes} minutes` : ""}
        </label>
        <div className="flex flex-wrap gap-2">
          <input
            id={inputId}
            className="app-input min-w-0 flex-1"
            placeholder="Comfort, forgiveness, or Romans 8"
            value={draft}
            maxLength={2000}
            onChange={(event) => setDraft(event.target.value)}
          />
          <button type="submit" className="app-button">
            Find passages
          </button>
        </div>
      </form>
      {!result && !error && <p role="status">Finding Bible passages…</p>}
      {error && (
        <p role="alert" className="text-sm">
          {error}{" "}
          <button
            type="button"
            className="underline underline-offset-4"
            onClick={() => setRequest({ ...request, retry: request.retry + 1 })}
          >
            Retry Bible search
          </button>
        </p>
      )}
      <ul className="divide-y divide-[var(--reader-border)]">
        {result?.passages.map((passage) => (
          <li key={passage.reference} className="py-3">
            <button
              type="button"
              className="min-h-11 w-full text-left"
              disabled={opening !== null}
              onClick={async () => {
                setOpening(passage.reference);
                setError("");
                try {
                  const id = await openPassage({
                    reference: passage.reference,
                  });
                  router.push(`/read/${id}`);
                } catch {
                  setError("Couldn't open this passage. Please try again.");
                } finally {
                  setOpening(null);
                }
              }}
            >
              <span className="block font-serif text-xl">
                {passage.reference}
              </span>
              <span className="block text-sm text-[var(--reader-fg-soft)]">
                {opening === passage.reference ? "Opening…" : passage.reason}
                {" · "}~{passage.minutes} min
              </span>
            </button>
          </li>
        ))}
      </ul>
      {result?.passages.length === 0 && (
        <p className="text-sm">
          No passages fit. Try a different topic or a longer window.
        </p>
      )}
      {result?.notice && (
        <p className="text-sm text-[var(--reader-muted)]">{result.notice}</p>
      )}
      <Link
        href="/bible"
        className="inline-flex min-h-11 items-center text-sm underline underline-offset-4"
      >
        All available Bibles
      </Link>
      <BibleBrowser onOpen={() => {}} translation={translation} />
    </div>
  );
}
