"use client";

import { api } from "@marginalia/backend/convex/_generated/api";
import { useAction, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useId, useState } from "react";
import {
  fieldControl,
  primaryControl,
  quietControl,
} from "./settings-controls";

type Catalogue = FunctionReturnType<typeof api.actions.bible.catalogue>;
const preferred = [111, 2692, 100, 113];
const aliases: Record<number, string> = {
  111: "NIV",
  113: "NIVUK",
  2692: "NASB 2020",
  100: "NASB 1995",
};
function label(version: Catalogue[number]) {
  return `${aliases[version.id] ? `${aliases[version.id]} · ` : ""}${version.title} (${version.language})`;
}

export function BibleStudy() {
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
        <h1 className="font-serif text-4xl">Available Bibles</h1>
        <p className="mt-4">
          Bible reading is off.{" "}
          <Link className="underline underline-offset-4" href="/account">
            Enable it in Your account
          </Link>{" "}
          to browse translations.
        </p>
      </main>
    );
  return <EnabledBibleCatalogue defaultTranslation={prefs.translation} />;
}

function EnabledBibleCatalogue({
  defaultTranslation,
}: {
  defaultTranslation: string;
}) {
  const params = useSearchParams();
  const [reference, setReference] = useState(
    () => params.get("reference") ?? "John 3:16-21",
  );
  const [version, setVersion] = useState(() =>
    Number(
      params.get("version") ??
        params.get("left") ??
        (defaultTranslation === "nasb" ? 2692 : 111),
    ),
  );
  const [versions, setVersions] = useState<Catalogue | null>(null);
  const [retry, setRetry] = useState(0);
  const [catalogueError, setCatalogueError] = useState("");
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [language, setLanguage] = useState("");
  const [limit, setLimit] = useState(50);
  const catalogue = useAction(api.actions.bible.catalogue);
  const openReading = useAction(api.actions.bible.openReading);
  const router = useRouter();
  const id = useId();
  useEffect(() => {
    let current = true;
    if (retry > 0) setVersions(null);
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
  }, [catalogue, retry]);
  async function read(versionId = version) {
    setOpening(true);
    setError("");
    try {
      router.push(`/read/${await openReading({ reference, versionId })}`);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Couldn't open this passage. Please retry.",
      );
    } finally {
      setOpening(false);
    }
  }
  const query = search.trim().toLocaleLowerCase();
  const matches =
    versions?.filter(
      (v) =>
        (!language || v.language === language) &&
        `${label(v)} ${v.title
          .split(/\s+/)
          .map((w) => w[0])
          .join("")} ${v.id}`
          .toLocaleLowerCase()
          .includes(query),
    ) ?? [];
  return (
    <main className="mx-auto max-w-[1180px] px-5 py-8 md:px-10 md:py-12">
      <h1 className="font-serif text-4xl text-balance sm:text-5xl">
        Available Bibles
      </h1>
      <p className="mt-3 max-w-3xl text-sm leading-6 text-[var(--reader-fg-soft)]">
        Choose a version and open a passage in the normal reader. Your preferred
        editions appear first. Comparison is off by default; turn on Compare
        versions inside the reader when you want it.
      </p>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--reader-muted)]">
        The displayed translation stays separate from the public-domain WEB text
        used for AI study notes, summaries and idea maps.
      </p>
      {catalogueError ? (
        <p role="alert" className="mt-6">
          {catalogueError}{" "}
          <button
            type="button"
            className={quietControl}
            onClick={() => setRetry((n) => n + 1)}
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
              void read();
            }}
          >
            <label className="text-sm" htmlFor={`${id}-version`}>
              Version
              <select
                id={`${id}-version`}
                className={`${fieldControl} mt-2`}
                value={version}
                onChange={(e) => setVersion(Number(e.target.value))}
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
                required
              />
            </label>
            <div>
              <button
                type="submit"
                className={primaryControl}
                disabled={opening || !versions.some((v) => v.id === version)}
              >
                {opening ? "Opening passage…" : "Read passage"}
              </button>
            </div>
          </form>
          {error ? (
            <p role="alert" className="mt-5 text-sm">
              {error}{" "}
              <button
                type="button"
                className={quietControl}
                onClick={() => void read()}
              >
                Retry passage
              </button>
            </p>
          ) : null}
          <section
            className="mt-12 border-t border-[var(--reader-border)] pt-8"
            aria-labelledby={`${id}-title`}
          >
            <h2 id={`${id}-title`} className="font-serif text-3xl">
              All authorized editions{" "}
              <span className="text-[var(--reader-muted)]">
                ({versions.length.toLocaleString()})
              </span>
            </h2>
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
            <p
              role="status"
              className="mt-4 text-sm text-[var(--reader-muted)]"
            >
              {matches.length.toLocaleString()} matching versions · showing{" "}
              {Math.min(limit, matches.length)}
            </p>
            <ul className="mt-2 divide-y divide-[var(--reader-border)]">
              {matches.slice(0, limit).map((v) => (
                <li
                  key={v.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-3"
                >
                  <span className="min-w-0 flex-1 text-sm">{label(v)}</span>
                  <button
                    type="button"
                    className={quietControl}
                    disabled={opening}
                    aria-label={`Read ${v.title}`}
                    onClick={() => void read(v.id)}
                  >
                    Read
                  </button>
                </li>
              ))}
            </ul>
            {matches.length > limit ? (
              <button
                type="button"
                className={`${quietControl} mt-4`}
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
        </>
      )}
    </main>
  );
}
