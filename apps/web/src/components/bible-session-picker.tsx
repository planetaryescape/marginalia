"use client";
import type { BibleSuggestion } from "@marginalia/backend/bible";
import { api } from "@marginalia/backend/convex/_generated/api";
import type { Id } from "@marginalia/backend/convex/_generated/dataModel";
import { useAction, useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ReadingScopeControl } from "./reading-scope";

export function BibleSessionPicker({
  id,
  scope,
}: {
  id: Id<"sessions">;
  scope: "mixed" | "bible";
}) {
  const session = useQuery(api.sessions.getById, { sessionId: id });
  const minutes = session?.requestedMinutes;
  const articles = useQuery(
    api.suggestions.forWindow,
    scope === "mixed" && minutes !== undefined
      ? { requestedMinutes: minutes }
      : "skip",
  );
  const suggest = useAction(api.actions.bible.suggest);
  const openPassage = useAction(api.actions.bible.openPassage);
  const updateSession = useMutation(api.sessions.updateStatus);
  const router = useRouter();
  const [result, setResult] = useState<{
    minutes: number;
    passages: BibleSuggestion[];
  }>();
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [opening, setOpening] = useState<string | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: retry is the reader's explicit retry trigger
  useEffect(() => {
    if (minutes === undefined) return;
    let current = true;
    setError("");
    void suggest({ question: "", minutes }).then(
      ({ passages }) => {
        if (current) setResult({ minutes, passages });
      },
      () => {
        if (current)
          setError("Couldn't find Bible passages. Please try again.");
      },
    );
    return () => {
      current = false;
    };
  }, [minutes, retry, suggest]);
  const startReading = async (
    item: { reference: string } | { articleId: Id<"articles"> },
  ) => {
    if (opening) return;
    setOpening("reference" in item ? item.reference : item.articleId);
    try {
      const articleId =
        "reference" in item ? await openPassage(item) : item.articleId;
      await updateSession({
        sessionId: id,
        articleId,
        readingStatus: "reading",
      });
      router.push(`/read/${articleId}?session=${id}`);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Couldn't open this reading. Try again.",
      );
    } finally {
      setOpening(null);
    }
  };
  return (
    <main className="mx-auto min-h-dvh max-w-3xl px-6 py-10 text-[var(--reader-fg)]">
      <Link href="/" className="text-sm underline underline-offset-4">
        Back to Home
      </Link>
      <h1 className="mb-4 mt-8 font-serif text-3xl">
        {minutes
          ? `Something for your ${minutes} minutes`
          : "Finding your reading window…"}
      </h1>
      <ReadingScopeControl scope={scope} />
      {session === null ? (
        <p className="mt-6">This session isn't here.</p>
      ) : (
        <>
          {result?.minutes !== minutes && !error && (
            <p role="status" className="mt-6">
              Finding Bible passages…
            </p>
          )}
          {error && (
            <p role="alert" className="mt-6">
              {error}{" "}
              <button
                className="underline underline-offset-4"
                onClick={() => setRetry((n) => n + 1)}
              >
                Try again
              </button>
            </p>
          )}
          <ul className="mt-6 divide-y divide-[var(--reader-border)]">
            {result?.minutes === minutes &&
              result?.passages.map((passage) => (
                <li key={passage.reference} className="py-5">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h2 className="font-serif text-2xl">{passage.reference}</h2>
                    <span className="text-sm text-[var(--reader-muted)]">
                      Bible · ~{passage.minutes} min
                    </span>
                  </div>
                  <p className="my-2 text-sm text-[var(--reader-fg-soft)]">
                    {passage.title}
                  </p>
                  <button
                    className="app-button mt-2"
                    disabled={opening !== null}
                    onClick={() =>
                      void startReading({ reference: passage.reference })
                    }
                  >
                    {opening === passage.reference
                      ? "Opening…"
                      : "Read passage"}
                  </button>
                </li>
              ))}
            {articles?.map((article) => (
              <li key={article._id} className="py-5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="font-serif text-2xl">{article.title}</h2>
                  <span className="text-sm text-[var(--reader-muted)]">
                    Article · {article.estimatedReadMinutes} min
                  </span>
                </div>
                <p className="my-2 text-sm text-[var(--reader-fg-soft)]">
                  {article.reason}
                </p>
                <button
                  className="app-button secondary mt-2"
                  disabled={opening !== null}
                  onClick={() => void startReading({ articleId: article._id })}
                >
                  {opening === article._id ? "Opening…" : "Read article"}
                </button>
              </li>
            ))}
          </ul>
          {result?.minutes === minutes && result?.passages.length === 0 && (
            <p className="mt-6">
              No starter passages fit that window. Try a longer window or search
              by topic on Home.
            </p>
          )}
          <p className="mt-6 text-sm text-[var(--reader-muted)]">
            Passage times are estimates, excluding reflection. Marginalia is
            generated when you open a passage.
          </p>
        </>
      )}
    </main>
  );
}
