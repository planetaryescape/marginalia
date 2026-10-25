import type { api } from "@marginalia/backend/convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import Link from "next/link";
import { Skeleton, SkeletonBar } from "@/components/in-place";
import type { RoomPeriod } from "@/lib/reading-sentence";

type Report = FunctionReturnType<typeof api.stats.readingEngagement>;
type Article = Report["articles"][number];

function activityDate(at: number | null, timeZone: string) {
  if (at === null) return null;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    timeZone,
  }).format(at);
}

function MarkCounts({
  article,
  timeZone,
}: {
  article: Article;
  timeZone: string;
}) {
  const personal = [
    article.personalHighlights && `${article.personalHighlights} highlights`,
    article.personalUnderlines && `${article.personalUnderlines} underlines`,
    article.notes && `${article.notes} notes`,
  ].filter(Boolean);
  const imported = [
    article.importedHighlights && `${article.importedHighlights} highlights`,
    article.importedUnderlines && `${article.importedUnderlines} underlines`,
  ].filter(Boolean);

  return (
    <div className="grid min-w-0 gap-3 sm:grid-cols-2">
      <div>
        <p className="text-xs font-medium text-[var(--reader-fg)]">
          Your marks and notes
        </p>
        <p className="mt-1 text-sm text-[var(--reader-muted)]">
          {personal.length ? personal.join(" · ") : "None in this period"}
        </p>
        {activityDate(article.lastPersonalAt, timeZone) && (
          <p className="mt-1 text-xs text-[var(--reader-muted)]">
            Last personal mark or note{" "}
            {activityDate(article.lastPersonalAt, timeZone)}
          </p>
        )}
        {article.personalMarksPerThousandWords !== null && (
          <p className="mt-1 text-xs tabular-nums text-[var(--reader-muted)]">
            {article.personalMarksPerThousandWords} personal marks per 1,000
            words
          </p>
        )}
      </div>
      <div>
        <p className="text-xs font-medium text-[var(--reader-fg)]">
          AI margin notes opened
        </p>
        <p className="mt-1 text-sm tabular-nums text-[var(--reader-muted)]">
          {article.aiMarginNotes} distinct notes
        </p>
        <p className="mt-1 text-xs text-[var(--reader-muted)]">
          Repeated opens count once; dated by recorded reading visit.
        </p>
      </div>
      {imported.length > 0 && (
        <p className="text-xs text-[var(--reader-muted)] sm:col-span-2">
          Imported from Readwise: {imported.join(" · ")}. Date is when imported;
          original mark dates are not stored.
          {activityDate(article.lastImportedAt, timeZone) &&
            ` Latest import ${activityDate(article.lastImportedAt, timeZone)}.`}
        </p>
      )}
    </div>
  );
}

export function ArticleEngagement({
  report,
  period,
}: {
  report: Report | undefined;
  period: RoomPeriod;
}) {
  const current = report?.period.period === period ? report : undefined;
  return (
    <section aria-labelledby="article-engagement-title" className="mt-12">
      <div className="mb-4">
        <h2
          id="article-engagement-title"
          className="text-balance font-serif text-xl font-medium text-[var(--reader-fg)]"
        >
          Articles you engaged with
        </h2>
        <p className="mt-1 text-pretty text-sm text-[var(--reader-muted)]">
          Marks and note counts show activity, including disagreement. They do
          not mean you liked an article.
        </p>
      </div>
      {current === undefined ? (
        <Skeleton
          label="Loading article activity"
          className="rounded-lg border border-[var(--reader-border)] p-4"
        >
          <SkeletonBar className="h-4 w-1/2" />
          <SkeletonBar className="mt-3 h-4 w-4/5" />
        </Skeleton>
      ) : current.articles.length === 0 ? (
        <p className="rounded-lg border border-[var(--reader-border)] p-4 text-sm text-[var(--reader-muted)]">
          {current.partial || current.articlesPartial
            ? "This report is incomplete, so it may miss activity or article context."
            : "No marks, notes or AI margin-note opens recorded in this period."}{" "}
          {!current.partial && !current.articlesPartial && (
            <Link className="underline underline-offset-4" href="/">
              Choose an article to read.
            </Link>
          )}
        </p>
      ) : (
        <ol className="divide-y divide-[var(--reader-border)] border-y border-[var(--reader-border)]">
          {current.articles.map((article) => (
            <li
              key={article.articleId}
              className="grid min-w-0 gap-3 py-4 md:grid-cols-[minmax(12rem,0.7fr)_minmax(0,1.3fr)] md:gap-6"
            >
              <div className="min-w-0">
                <Link
                  className="break-words font-medium text-[var(--reader-fg)] underline decoration-[var(--reader-border)] underline-offset-4 hover:decoration-current"
                  href={`/read/${article.articleId}`}
                >
                  {article.title}
                </Link>
                {article.wordCount !== null && (
                  <p className="mt-1 text-xs tabular-nums text-[var(--reader-muted)]">
                    {article.wordCount.toLocaleString()} words
                  </p>
                )}
              </div>
              <MarkCounts
                article={article}
                timeZone={current.period.timeZone}
              />
            </li>
          ))}
        </ol>
      )}
      {(current?.partial || current?.articlesPartial) && (
        <div
          role="status"
          className="mt-3 space-y-1 text-xs text-[var(--reader-muted)]"
        >
          {current.partial && (
            <p>
              Counts include records read within this report’s data limit; some
              activity or article context may be missing.
            </p>
          )}
          {current.articlesPartial && (
            <p>
              The article list is bounded to 30 entries; some article activity
              may be omitted.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
