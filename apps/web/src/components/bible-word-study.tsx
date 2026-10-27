"use client";
import { parseBibleReference } from "@marginalia/backend/bible";
import { api } from "@marginalia/backend/convex/_generated/api";
import { useAction } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useCallback, useEffect, useId, useRef, useState } from "react";

export function BibleWordStudy({
  reference,
  selectedText,
}: {
  reference: string;
  selectedText?: string;
}) {
  const parsed = parseBibleReference(reference);
  const [verse, setVerse] = useState(() =>
    parsed
      ? `${parsed.book} ${parsed.chapter}:${parsed.verse ?? 1}`
      : reference,
  );
  const [study, setStudy] = useState<FunctionReturnType<
    typeof api.actions.bible.originalWords
  > | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [explanation, setExplanation] = useState("");
  const [busy, setBusy] = useState(false);
  const [explaining, setExplaining] = useState(false);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const getWords = useAction(api.actions.bible.originalWords);
  const explain = useAction(api.actions.bible.explainOriginalWord);
  const id = useId();
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  const word = selected === null ? undefined : study?.words[selected];
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
        setSelected(null);
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
  return (
    <div>
      {selectedText && (
        <>
          <p className="mb-2" data-selected-english>
            Selected English wording: <strong>{selectedText}</strong>
          </p>
          <p className="mb-5 text-[var(--reader-fg-soft)]">
            In {reference}. An English dictionary meaning is not a claim about
            which Greek or Hebrew word it translates.
          </p>
          <EnglishWordMeaning key={selectedText} word={selectedText} />
        </>
      )}
      <details className="border-t border-[var(--reader-border)] pt-2">
        <summary className="min-h-11 cursor-pointer py-3">
          {selectedText
            ? "Optional original-language details"
            : "Original-language details"}
        </summary>
        <div className="space-y-4 pb-4">
          <p>
            These are source words, not an automatic match for an English
            selection. Choose a word to inspect its pronunciation and dictionary
            entry. No English-to-original-word alignment is assumed.
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
                {study.words.map((token, index) => {
                  const entry = study.entries.find((entry) =>
                    token.strongs.includes(entry.id),
                  );
                  return (
                    <button
                      key={`${study.originalId}-${index}`}
                      type="button"
                      aria-pressed={selected === index}
                      aria-label={`Inspect original word ${index + 1}: ${entry?.transliteration || token.surface}`}
                      className="min-h-11 rounded border border-[var(--reader-border)] px-3 py-2 font-serif text-xl aria-pressed:bg-[var(--reader-chip)]"
                      onClick={() => {
                        generation.current++;
                        setSelected(index);
                        setExplanation("");
                        setExplaining(false);
                      }}
                    >
                      <span className="block font-sans text-sm">
                        {entry?.transliteration || `Source word ${index + 1}`}
                      </span>
                      <span className="block">{token.surface}</span>
                    </button>
                  );
                })}
              </div>
              {selected === null && (
                <p>
                  Choose an original word above. The first word is not
                  automatically treated as your English selection.
                </p>
              )}
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
                      if (selected === null) return;
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
                        if (generation.current === request)
                          setExplaining(false);
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
    </div>
  );
}

function EnglishWordMeaning({ word }: { word: string }) {
  const define = useAction(api.actions.bible.defineEnglishWord);
  const [result, setResult] = useState<FunctionReturnType<
    typeof api.actions.bible.defineEnglishWord
  > | null>(null);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const load = useCallback(async () => {
    const request = ++generation.current;
    setResult(null);
    setError("");
    try {
      const value = await define({ word });
      if (generation.current === request) setResult(value);
    } catch {
      if (generation.current === request)
        setError("The English dictionary is unavailable.");
    }
  }, [define, word]);
  useEffect(() => {
    void load();
    return () => {
      generation.current++;
    };
  }, [load]);
  return (
    <section className="mb-6 space-y-4" aria-label="English meaning">
      <h3 className="font-medium">English meaning</h3>
      {!result && !error && <p role="status">Looking up the English word…</p>}
      {error && (
        <p role="alert">
          {error}{" "}
          <button
            type="button"
            className="min-h-11 underline"
            onClick={() => void load()}
          >
            Retry dictionary
          </button>
        </p>
      )}
      {result?.entries.length === 0 && (
        <p>
          No English dictionary entry was found. Select a single English word;
          the original-language details below remain available.
        </p>
      )}
      {result?.entries.map((entry) => (
        <div key={JSON.stringify(entry)} className="space-y-3">
          {entry.phonetic && <p>{entry.phonetic}</p>}
          {entry.meanings.map((meaning) => (
            <div key={meaning.partOfSpeech}>
              <h4 className="font-medium">{meaning.partOfSpeech}</h4>
              <ul className="list-disc space-y-2 pl-5">
                {meaning.definitions.map((definition) => (
                  <li key={definition}>{definition}</li>
                ))}
              </ul>
            </div>
          ))}
          <p className="text-sm text-[var(--reader-muted)]">
            {entry.sourceUrls.map((url) => (
              <a
                key={url}
                className="underline"
                href={url}
                target="_blank"
                rel="noreferrer"
              >
                Wiktionary
              </a>
            ))}{" "}
            via Free Dictionary API ·{" "}
            <a
              className="underline"
              href={entry.license.url}
              target="_blank"
              rel="noreferrer"
            >
              {entry.license.name}
            </a>
            . General meanings, not a verified contextual or original-language
            match.
          </p>
        </div>
      ))}
    </section>
  );
}
