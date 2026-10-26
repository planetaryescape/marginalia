"use client";

import { BIBLE_BOOKS, parseBibleReference } from "@marginalia/backend/bible";
import { api } from "@marginalia/backend/convex/_generated/api";
import { useAction, useConvexConnectionState, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useId, useState } from "react";
import {
  fieldControl,
  primaryControl,
  quietControl,
} from "./settings-controls";

type Catalogue = FunctionReturnType<typeof api.actions.bible.catalogue>;
type Reading = FunctionReturnType<typeof api.actions.bible.readComparison>;
const preferred = [111, 2692, 100, 113];
const aliases: Record<number, string> = {
  111: "NIV",
  113: "NIVUK",
  2692: "NASB 2020",
  100: "NASB 1995",
};

export function BibleStudy() {
  const params = useSearchParams();
  const prefs = useQuery(api.bible.preferences, {});
  if (!prefs)
    return (
      <p className="px-5 py-10" role="status">
        Loading Bible preferences…
      </p>
    );
  if (!prefs.enabled)
    return (
      <main className="mx-auto max-w-3xl px-5 py-10">
        <h1 className="font-serif text-4xl">Bible study</h1>
        <p className="mt-4">
          Bible reading is off.{" "}
          <Link className="underline underline-offset-4" href="/account">
            Enable it in Your account
          </Link>{" "}
          to browse translations and compare passages.
        </p>
      </main>
    );
  return (
    <EnabledBibleStudy
      key={params.toString()}
      defaultTranslation={prefs.translation}
    />
  );
}

function EnabledBibleStudy({
  defaultTranslation,
}: {
  defaultTranslation: string;
}) {
  const params = useSearchParams();
  const initialLeft = defaultTranslation === "nasb" ? 2692 : 111;
  const [reference, setReference] = useState(
    () => params.get("reference") ?? "John 3:16-21",
  );
  const [left, setLeft] = useState(() =>
    Number(params.get("left") ?? initialLeft),
  );
  const [right, setRight] = useState(() =>
    Number(params.get("right") ?? (initialLeft === 111 ? 2692 : 111)),
  );
  const [versions, setVersions] = useState<Catalogue | null>(null);
  const [catalogueError, setCatalogueError] = useState("");
  const [catalogueRetry, setCatalogueRetry] = useState(0);
  const [reading, setReading] = useState<Reading | null>(null);
  const [error, setError] = useState("");
  const [request, setRequest] = useState<{
    reference: string;
    left: number;
    right: number;
    attempt: number;
  } | null>(() =>
    params.get("reference")
      ? {
          reference: params.get("reference") ?? "John 3:16-21",
          left: Number(params.get("left") ?? initialLeft),
          right: Number(
            params.get("right") ?? (initialLeft === 111 ? 2692 : 111),
          ),
          attempt: 0,
        }
      : null,
  );
  const [loading, setLoading] = useState(false);
  const catalogue = useAction(api.actions.bible.catalogue);
  const compare = useAction(api.actions.bible.readComparison);
  const active = useQuery(api.bible.activeLicensedReading, {});
  const connected = useConvexConnectionState().isWebSocketConnected;
  const id = useId();

  useEffect(() => {
    let current = true;
    if (catalogueRetry > 0) setVersions(null);
    setCatalogueError("");
    void catalogue({}).then(
      (data) => {
        if (current)
          setVersions(
            data.sort((a, b) => {
              const ap = preferred.indexOf(a.id),
                bp = preferred.indexOf(b.id);
              return (
                (ap < 0 ? 100 : ap) - (bp < 0 ? 100 : bp) ||
                a.title.localeCompare(b.title)
              );
            }),
          );
      },
      () => {
        if (current)
          setCatalogueError(
            "Couldn't load your available Bibles. Please retry.",
          );
      },
    );
    return () => {
      current = false;
    };
  }, [catalogue, catalogueRetry]);

  useEffect(() => {
    if (!request) return;
    let current = true;
    setReading(null);
    setError("");
    setLoading(true);
    const timeout = setTimeout(() => {
      current = false;
      setLoading(false);
      setError("The passage took too long to load. Please retry.");
    }, 30_000);
    void compare({
      reference: request.reference,
      versionIds: [request.left, request.right],
    }).then(
      (result) => {
        if (current) {
          setReading(result);
          setLoading(false);
        }
        clearTimeout(timeout);
      },
      (failure: unknown) => {
        if (current) {
          setLoading(false);
          setError(
            failure instanceof Error
              ? failure.message
              : "Couldn't open this passage. Please retry.",
          );
        }
        clearTimeout(timeout);
      },
    );
    return () => {
      current = false;
      clearTimeout(timeout);
    };
  }, [compare, request]);

  function open(nextReference = reference) {
    setRequest({
      reference: nextReference,
      left,
      right,
      attempt: (request?.attempt ?? 0) + 1,
    });
  }
  const parsed = parseBibleReference(reading?.reference ?? "");
  const book = BIBLE_BOOKS.find(([bookId]) => bookId === parsed?.bookId);
  const ownView = reading && active === reading.token && connected;
  const label = (version: Catalogue[number]) =>
    `${aliases[version.id] ? `${aliases[version.id]} · ` : ""}${version.title} (${version.language})`;

  return (
    <main className="mx-auto max-w-[1180px] px-5 py-8 md:px-10 md:py-12">
      <header className="max-w-3xl">
        <h1 className="font-serif text-4xl text-balance sm:text-5xl">
          Bible study
        </h1>
        <p className="mt-3 text-sm leading-6 text-[var(--reader-fg-soft)]">
          Read the same passage side by side. NIV and NASB 2020 are your
          starting pair; browse every edition authorized for this app below.
        </p>
        <p className="mt-2 text-sm leading-6 text-[var(--reader-muted)]">
          Reading only: no AI, saved Scripture, downloads, notes or highlights
          in this view. WEB’s notes and marginalia remain available from the
          desk.
        </p>
      </header>
      {catalogueError ? (
        <p role="alert" className="mt-6">
          {catalogueError}{" "}
          <button
            className={quietControl}
            type="button"
            onClick={() => setCatalogueRetry((n) => n + 1)}
          >
            Retry catalogue
          </button>
        </p>
      ) : !versions ? (
        <p className="mt-6" role="status">
          Loading your authorized Bible catalogue…
        </p>
      ) : (
        <>
          <form
            className="mt-8 grid items-end gap-4 sm:grid-cols-2"
            onSubmit={(event) => {
              event.preventDefault();
              open();
            }}
          >
            <label className="text-sm" htmlFor={`${id}-left`}>
              Left version
              <select
                id={`${id}-left`}
                className={`${fieldControl} mt-2`}
                value={left}
                onChange={(e) => setLeft(Number(e.target.value))}
              >
                {versions.map((v) => (
                  <option key={v.id} value={v.id}>
                    {label(v)}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm" htmlFor={`${id}-right`}>
              Right version
              <select
                id={`${id}-right`}
                className={`${fieldControl} mt-2`}
                value={right}
                onChange={(e) => setRight(Number(e.target.value))}
              >
                {versions.map((v) => (
                  <option key={v.id} value={v.id}>
                    {label(v)}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm" htmlFor={`${id}-reference`}>
              Passage within one chapter
              <input
                id={`${id}-reference`}
                className={`${fieldControl} mt-2`}
                value={reference}
                maxLength={150}
                onChange={(e) => setReference(e.target.value)}
                placeholder="John 3:16-21"
                required
              />
            </label>
            <div>
              <button
                type="submit"
                className={primaryControl}
                disabled={
                  loading ||
                  left === right ||
                  !versions.some((v) => v.id === left) ||
                  !versions.some((v) => v.id === right)
                }
              >
                {loading ? "Opening passage…" : "Compare verses"}
              </button>
              {left === right ? (
                <p className="mt-2 text-sm">Choose two different versions.</p>
              ) : null}
            </div>
          </form>
          {error ? (
            <p role="alert" className="mt-6 text-sm">
              {error}{" "}
              <button
                className={quietControl}
                type="button"
                onClick={() => open()}
              >
                Retry passage
              </button>
            </p>
          ) : null}
          {loading ? (
            <p
              role="status"
              className="mt-8 border-y border-[var(--reader-border)] py-10"
            >
              Loading both versions of this passage…
            </p>
          ) : null}
          {reading && !ownView ? (
            <p role="status" className="mt-8">
              {connected
                ? "This reading view is no longer active. Only one Bible comparison can be open at a time."
                : "Bible text is hidden while the live connection is unavailable."}{" "}
              <button
                type="button"
                className={quietControl}
                onClick={() => open(reading.reference)}
                disabled={!connected || loading}
              >
                Read here
              </button>
            </p>
          ) : null}
          {ownView ? (
            <section
              className="licensed-bible-view mt-10"
              aria-label="Bible version comparison"
            >
              <link
                rel="stylesheet"
                href="https://cdn.youversion.com/platform/1/bible.css"
              />
              <style>{reading.fontCss}</style>
              <h2 className="font-serif text-3xl">{reading.reference}</h2>
              <div className="mt-6 grid gap-8 md:grid-cols-2 md:gap-12">
                {reading.panes.map((pane) => (
                  <section
                    key={pane.id}
                    aria-label={pane.title}
                    className="min-w-0"
                  >
                    <h3 className="border-b border-[var(--reader-border)] pb-3 text-sm font-medium">
                      {pane.title} · {pane.abbreviation}
                    </h3>
                    <div
                      data-yv-sdk=""
                      data-slot="yv-bible-renderer"
                      dir="auto"
                      lang={pane.language}
                      className="licensed-bible-text mt-5 font-serif text-xl leading-8"
                      dangerouslySetInnerHTML={{ __html: pane.html }}
                    />
                    <p className="mt-6 whitespace-pre-line text-xs leading-5 text-[var(--reader-fg-soft)]">
                      {pane.copyright}
                    </p>
                    <a
                      className="inline-flex min-h-11 items-center text-sm underline underline-offset-4"
                      href={pane.publisherUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {pane.publisher}
                    </a>
                  </section>
                ))}
              </div>
              <nav
                aria-label="Comparison chapter navigation"
                className="mt-8 flex flex-wrap justify-between gap-3 border-t border-[var(--reader-border)] pt-4"
              >
                <button
                  type="button"
                  className={quietControl}
                  disabled={!parsed || parsed.chapter <= 1}
                  onClick={() => {
                    if (parsed) {
                      const next = `${parsed.book} ${parsed.chapter - 1}`;
                      setReference(next);
                      open(next);
                    }
                  }}
                >
                  Previous chapter
                </button>
                <button
                  type="button"
                  className={quietControl}
                  disabled={!parsed || !book || parsed.chapter >= book[2]}
                  onClick={() => {
                    if (parsed) {
                      const next = `${parsed.book} ${parsed.chapter + 1}`;
                      setReference(next);
                      open(next);
                    }
                  }}
                >
                  Next chapter
                </button>
              </nav>
            </section>
          ) : null}
          <BibleCatalogue
            versions={versions}
            label={label}
            onChoose={(side, versionId) => {
              if (side === "left") setLeft(versionId);
              else setRight(versionId);
              document.getElementById(`${id}-${side}`)?.focus();
            }}
          />
        </>
      )}
    </main>
  );
}

function BibleCatalogue({
  versions,
  label,
  onChoose,
}: {
  versions: Catalogue;
  label: (v: Catalogue[number]) => string;
  onChoose: (side: "left" | "right", id: number) => void;
}) {
  const [search, setSearch] = useState("");
  const [language, setLanguage] = useState("");
  const [limit, setLimit] = useState(50);
  const id = useId();
  const query = search.trim().toLocaleLowerCase();
  const matches = versions.filter(
    (v) =>
      (!language || v.language === language) &&
      `${label(v)} ${v.title
        .split(/\s+/)
        .map((w) => w[0])
        .join("")} ${v.id}`
        .toLocaleLowerCase()
        .includes(query),
  );
  return (
    <section
      className="mt-12 border-t border-[var(--reader-border)] pt-8"
      aria-labelledby={`${id}-title`}
    >
      <h2 id={`${id}-title`} className="font-serif text-3xl">
        Available Bibles{" "}
        <span className="text-[var(--reader-muted)]">
          ({versions.length.toLocaleString()})
        </span>
      </h2>
      <p className="mt-2 text-sm text-[var(--reader-fg-soft)]">
        Your preferred editions are listed first. This is the app’s authorized
        collection, not YouVersion’s unrestricted public catalogue.
      </p>
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <label className="text-sm" htmlFor={`${id}-search`}>
          Search all available versions
          <input
            id={`${id}-search`}
            type="search"
            className={`${fieldControl} mt-2`}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setLimit(50);
            }}
            placeholder="Name, language, abbreviation or version ID"
          />
        </label>
        <label className="text-sm" htmlFor={`${id}-language`}>
          Language
          <select
            id={`${id}-language`}
            className={`${fieldControl} mt-2`}
            value={language}
            onChange={(e) => {
              setLanguage(e.target.value);
              setLimit(50);
            }}
          >
            <option value="">All languages</option>
            {Array.from(new Set(versions.map((v) => v.language)))
              .sort()
              .map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
          </select>
        </label>
      </div>
      <p role="status" className="mt-4 text-sm text-[var(--reader-muted)]">
        {matches.length.toLocaleString()} matching versions · showing{" "}
        {Math.min(limit, matches.length)}
      </p>
      <ul className="mt-2 divide-y divide-[var(--reader-border)]">
        {matches.slice(0, limit).map((version) => (
          <li
            key={version.id}
            className="flex flex-wrap items-center justify-between gap-2 py-3"
          >
            <span className="min-w-0 flex-1 text-sm">{label(version)}</span>
            <div className="flex gap-2">
              <button
                type="button"
                className={quietControl}
                aria-label={`Use ${version.title} on left`}
                onClick={() => onChoose("left", version.id)}
              >
                Use on left
              </button>
              <button
                type="button"
                className={quietControl}
                aria-label={`Use ${version.title} on right`}
                onClick={() => onChoose("right", version.id)}
              >
                Use on right
              </button>
            </div>
          </li>
        ))}
      </ul>
      {matches.length > limit ? (
        <button
          className={`${quietControl} mt-4`}
          type="button"
          onClick={() => setLimit((n) => n + 50)}
        >
          Show more versions
        </button>
      ) : null}
      {!matches.length ? (
        <p className="py-6 text-sm">
          No authorized versions match. Try another name or language.
        </p>
      ) : null}
    </section>
  );
}
