"use client";
import { useQuery } from "convex/react";
import { api } from "@marginalia/backend/convex/_generated/api";
import { ThemeToggle } from "@/components/theme-toggle";
import Link from "next/link";

export default function ReadingPage() {
  const stats = useQuery(api.stats.getWeeklyStats);

  if (!stats) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-ink-400 font-sans text-sm">Loading...</p>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto px-6 py-12">
      <div className="flex items-center justify-between mb-10">
        <Link
          href="/"
          className="text-ink-400 hover:text-ink-600 font-sans text-sm transition-colors"
        >
          &larr; Back
        </Link>
        <h1 className="text-xl font-serif font-medium text-ink-950 dark:text-parchment-100">
          This Week
        </h1>
        <ThemeToggle />
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-4 mb-10">
        <StatCard
          label="Articles read"
          value={stats.articlesReadCount}
        />
        <StatCard
          label="Active reading"
          value={`${stats.totalActiveTimeMinutes}m`}
        />
        <StatCard
          label="Avg. scroll depth"
          value={`${stats.avgScrollDepth}%`}
        />
        <StatCard
          label="Annotations opened"
          value={stats.annotationsOpenedCount}
        />
        <StatCard label="Notes taken" value={stats.notesTaken} />
        <StatCard
          label="Reflections written"
          value={stats.reflectionsResponded}
        />
        <StatCard label="Articles skipped" value={stats.articlesSkipped} />
        <StatCard
          label="Preferred time"
          value={stats.preferredReadTime ? `${stats.preferredReadTime}m` : "--"}
        />
      </div>

      {/* Articles read list */}
      {stats.articlesRead.length > 0 && (
        <div>
          <h2 className="text-sm font-sans font-semibold text-ink-600 dark:text-ink-400 uppercase tracking-wider mb-4">
            What you read
          </h2>
          <div className="space-y-2">
            {stats.articlesRead.map((a: any, i: number) => (
              <div
                key={i}
                className="p-3 rounded-lg border border-ink-100 dark:border-ink-800 bg-white dark:bg-ink-900"
              >
                <p className="text-sm font-serif text-ink-800 dark:text-parchment-200">
                  {a.title}
                </p>
                <p className="text-xs font-sans text-ink-400 mt-0.5">
                  {a.author}
                  {a.readMinutes ? ` · ${a.readMinutes} min` : ""}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {stats.articlesReadCount === 0 && (
        <p className="text-center text-ink-400 dark:text-ink-500 font-sans text-sm py-8">
          No reading activity this week.
        </p>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div className="p-4 rounded-xl border border-ink-100 dark:border-ink-800 bg-white dark:bg-ink-900">
      <p className="text-2xl font-serif font-medium text-ink-950 dark:text-parchment-100">
        {value}
      </p>
      <p className="text-xs font-sans text-ink-400 dark:text-ink-500 mt-1">
        {label}
      </p>
    </div>
  );
}
