"use client";
import { parseBibleReference } from "@marginalia/backend/bible";
import { api } from "@marginalia/backend/convex/_generated/api";
import { useAction } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useEffect, useId, useRef, useState } from "react";

export function BibleWordStudy({ reference }: { reference: string }) {
  const parsed = parseBibleReference(reference);
  const bookId = parsed?.bookId;
  const chapter = parsed?.chapter;
  const [verse, setVerse] = useState(() =>
    parsed
      ? `${parsed.book} ${parsed.chapter}:${parsed.verse ?? 1}`
      : reference,
  );
  const [study, setStudy] = useState<FunctionReturnType<
    typeof api.actions.bible.originalWords
  > | null>(null);
  const [selected, setSelected] = useState(0);
  const [explanation, setExplanation] = useState("");
  const [busy, setBusy] = useState(false);
  const [explaining, setExplaining] = useState(false);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const details = useRef<HTMLDetailsElement>(null);
  const getWords = useAction(api.actions.bible.originalWords);
  const explain = useAction(api.actions.bible.explainOriginalWord);
  const id = useId();
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  const word = study?.words[selected];
  async function load(requestedVerse = verse) {
    const request = ++generation.current;
    setBusy(true);
    setError("");
    setExplanation("");
    setStudy(null);
    try {
      const result = await getWords({ reference: requestedVerse });
      if (generation.current === request) {
        setStudy(result);
        setSelected(0);
      }
    } catch (failure) {
      if (generation.current === request)
        setError(
          failure instanceof Error
            ? failure.message
            : "Couldn't load original words. Please retry.",
        );
    } finally {
      if (generation.current === request) {
        setBusy(false);
        setExplaining(false);
      }
    }
  }
  const latestLoad = useRef(load);
  useEffect(() => {
    latestLoad.current = load;
  });
  useEffect(() => {
    const open = (event: Event) => {
      if (!(event instanceof CustomEvent)) return;
      const data: unknown = event.detail;
      if (
        !data ||
        typeof data !== "object" ||
        !("reference" in data) ||
        typeof data.reference !== "string"
      )
        return;
      const target = parseBibleReference(data.reference);
      if (
        !target ||
        !bookId ||
        target.bookId !== bookId ||
        target.chapter !== chapter
      )
        return;
      const single = `${target.book} ${target.chapter}:${target.verse ?? 1}`;
      setVerse(single);
      if (details.current) {
        details.current.open = true;
        details.current.scrollIntoView?.({ block: "nearest" });
      }
      void latestLoad.current(single);
    };
    window.addEventListener("bible-word-study", open);
    return () => window.removeEventListener("bible-word-study", open);
  }, [bookId, chapter]);
  return (
    <details
      ref={details}
      className="border-t border-[var(--reader-border)] pt-2"
    >
      <summary className="min-h-11 cursor-pointer py-3">
        Word study · Greek / Hebrew / Strong’s
      </summary>
      <div className="space-y-4 pb-4">
        <p>
          Look at the original-language verse before choosing a word.
          English-to-original-word alignment is not guessed.
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <label className="min-w-0 flex-1" htmlFor={id}>
            Single verse
            <input
              id={id}
              className="app-input mt-1"
              value={verse}
              onChange={(event) => setVerse(event.target.value)}
              maxLength={150}
            />
          </label>
          <button
            type="button"
            className="app-button"
            disabled={busy}
            onClick={() => void load()}
          >
            {busy ? "Loading words…" : "Load original words"}
          </button>
        </div>
        {error ? <p role="alert">{error}</p> : null}
        {study ? (
          <>
            <p className="text-[var(--reader-fg-soft)]">
              {study.reference} · {study.edition}
              <br />
              Original verse: {study.originalId}
            </p>
            <div
              className="flex flex-wrap gap-2"
              dir={study.language.startsWith("Hebrew") ? "rtl" : "ltr"}
              role="group"
              aria-label="Original-language words"
            >
              {study.words.map((token, index) => (
                <button
                  key={`${study.originalId}-${index}`}
                  type="button"
                  aria-pressed={selected === index}
                  className="min-h-11 rounded border border-[var(--reader-border)] px-3 py-2 font-serif text-xl aria-pressed:bg-[var(--reader-chip)]"
                  onClick={() => {
                    generation.current++;
                    setSelected(index);
                    setExplanation("");
                    setExplaining(false);
                  }}
                >
                  {token.surface}
                </button>
              ))}
            </div>
            {word ? (
              <div className="space-y-3">
                <p>
                  <strong>{word.surface}</strong> ·{" "}
                  {word.strongs.join(", ") || "No verified Strong’s number"}
                  <br />
                  Lemma tag: {word.lemma || "See dictionary entry"}
                  <br />
                  Morphology: {word.morphology.join(" / ") || "Not supplied"}
                </p>
                {study.entries
                  .filter((entry) => word.strongs.includes(entry.id))
                  .map((entry) => (
                    <p key={entry.id}>
                      <strong>
                        {entry.id} · {entry.lemma}
                      </strong>{" "}
                      {entry.transliteration}
                      <br />
                      {entry.definition}
                    </p>
                  ))}
                {study.occurrences
                  .filter((entry) => word.strongs.includes(entry.id))
                  .map((entry) => (
                    <details key={entry.id}>
                      <summary className="min-h-11 cursor-pointer py-2">
                        Other {entry.id} examples in this book:{" "}
                        {entry.references.join(", ") ||
                          "No additional examples found"}
                      </summary>
                      <ul className="space-y-3">
                        {entry.examples?.map((example) => (
                          <li key={example.id}>
                            <span className="text-xs">{example.id}</span>
                            <p dir="auto" className="font-serif text-lg">
                              {example.text}
                            </p>
                          </li>
                        ))}
                      </ul>
                    </details>
                  ))}
                <button
                  type="button"
                  className="app-button"
                  disabled={explaining || busy}
                  onClick={async () => {
                    const request = ++generation.current;
                    setExplaining(true);
                    setError("");
                    setExplanation("");
                    try {
                      const result = await explain({
                        reference: study.reference,
                        wordIndex: selected,
                      });
                      if (generation.current === request)
                        setExplanation(result.explanation);
                    } catch (failure) {
                      if (generation.current === request)
                        setError(
                          failure instanceof Error
                            ? failure.message
                            : "Couldn't explain this word. Please retry.",
                        );
                    } finally {
                      if (generation.current === request) setExplaining(false);
                    }
                  }}
                >
                  {explaining
                    ? "Explaining with source context…"
                    : "Explain this original word"}
                </button>
              </div>
            ) : null}
            {explanation ? (
              <section
                className="whitespace-pre-wrap leading-6"
                aria-label="AI word-study explanation"
              >
                {explanation}
              </section>
            ) : null}
            <ul className="list-disc space-y-2 pl-5 text-xs leading-5 text-[var(--reader-muted)]">
              {study.notices.map((notice) => (
                <li key={notice}>{notice}</li>
              ))}
            </ul>
            <ul className="space-y-2 text-xs leading-5 text-[var(--reader-muted)]">
              {study.sources.map((source) => (
                <li key={source.url}>
                  <a
                    className="underline underline-offset-4"
                    href={source.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {source.title}
                  </a>{" "}
                  · {source.license}
                  <br />
                  Revision: {source.revision}
                  <br />
                  {source.attribution}
                  <br />
                  <a
                    className="underline underline-offset-4"
                    href={source.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Exact source text
                  </a>
                  {" · "}
                  <a
                    className="underline underline-offset-4"
                    href={source.licenseUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    License terms
                  </a>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </div>
    </details>
  );
}
