"use client";
import { useQuery } from "convex/react";
import { api } from "@marginalia/backend/convex/_generated/api";
import { ThemeToggle } from "@/components/theme-toggle";
import { DashboardOverview } from "@/components/dashboard/dashboard-overview";
import { ReadingHeatmap } from "@/components/dashboard/reading-heatmap";
import { SessionDistribution } from "@/components/dashboard/session-distribution";
import { EngagementDepth } from "@/components/dashboard/engagement-depth";
import { KnowledgeSummary } from "@/components/dashboard/knowledge-summary";
import { ArticleDetailList } from "@/components/dashboard/article-detail-list";
import { TrendComparison } from "@/components/dashboard/trend-comparison";
import Link from "next/link";

function Divider() {
  return <div className="w-12 h-px bg-ink-200 dark:bg-ink-700 mx-auto my-10" />;
}

export default function ReadingPage() {
  const overview = useQuery(api.stats.getDashboardOverview);
  const patterns = useQuery(api.stats.getReadingPatterns);
  const articles = useQuery(api.stats.getArticleDetails);
  const notes = useQuery(api.stats.getRecentNotes);

  return (
    <div className="max-w-2xl mx-auto px-6 py-12">
      {/* Header */}
      <div className="flex items-center justify-between mb-12">
        <Link
          href="/"
          className="text-ink-400 hover:text-ink-600 font-sans text-sm transition-colors"
        >
          &larr; Back
        </Link>
        <h1 className="text-xl font-serif font-medium text-ink-950 dark:text-parchment-100">
          Reading
        </h1>
        <ThemeToggle />
      </div>

      {/* A: Overview */}
      {overview ? (
        <DashboardOverview data={overview} />
      ) : (
        <Skeleton />
      )}

      <Divider />

      {/* B: Reading Patterns */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {patterns ? (
          <>
            <ReadingHeatmap data={patterns.hourlyHeatmap} />
            <SessionDistribution data={patterns.sessionDurations} />
          </>
        ) : (
          <>
            <Skeleton />
            <Skeleton />
          </>
        )}
      </div>

      <Divider />

      {/* C: Engagement Depth */}
      {patterns && overview ? (
        <EngagementDepth
          scrollDistribution={patterns.scrollDepthDistribution}
          focusRatio={overview.thisWeek.focusRatio}
          activeTimeMs={overview.thisWeek.totalActiveTimeMs}
          wallTimeMs={overview.thisWeek.totalWallTimeMs}
          annotationsByType={patterns.annotationsByType}
        />
      ) : (
        <Skeleton />
      )}

      <Divider />

      {/* D: Knowledge Building */}
      {overview && notes ? (
        <KnowledgeSummary
          notesTaken={overview.thisWeek.notesTaken}
          reflectionsWritten={overview.thisWeek.reflectionsWritten}
          crossRefsExplored={overview.thisWeek.annotationsOpenedCount}
          lovedTotal={overview.thisWeek.lovedTotal}
          recentNotes={notes}
        />
      ) : (
        <Skeleton />
      )}

      <Divider />

      {/* E: Article Details */}
      {articles ? (
        <ArticleDetailList articles={articles as any} />
      ) : (
        <Skeleton />
      )}

      <Divider />

      {/* F: Trend Comparison */}
      {overview ? (
        <TrendComparison
          thisWeek={overview.thisWeek}
          lastWeek={overview.lastWeek}
        />
      ) : (
        <Skeleton />
      )}
    </div>
  );
}

function Skeleton() {
  return (
    <div className="animate-pulse space-y-3">
      <div className="h-4 bg-ink-100 dark:bg-ink-800 rounded w-24" />
      <div className="h-8 bg-ink-100 dark:bg-ink-800 rounded w-16" />
      <div className="h-3 bg-ink-100 dark:bg-ink-800 rounded w-32" />
    </div>
  );
}
