"use client";
import { api } from "@marginalia/backend/convex/_generated/api";
import { useQuery } from "convex/react";
import { ArticleDetailList } from "@/components/dashboard/article-detail-list";
import { DashboardOverview } from "@/components/dashboard/dashboard-overview";
import { EngagementDepth } from "@/components/dashboard/engagement-depth";
import { KnowledgeSummary } from "@/components/dashboard/knowledge-summary";
import { ReadingHeatmap } from "@/components/dashboard/reading-heatmap";
import { SessionDistribution } from "@/components/dashboard/session-distribution";
import { TrendComparison } from "@/components/dashboard/trend-comparison";
import { DeskPage } from "@/components/desk-page";

function Divider() {
  return <div className="w-12 h-px bg-[var(--reader-border)] mx-auto my-10" />;
}

export default function ReadingPage() {
  const overview = useQuery(api.stats.getDashboardOverview);
  const patterns = useQuery(api.stats.getReadingPatterns);
  const articles = useQuery(api.stats.getArticleDetails);
  const notes = useQuery(api.stats.getRecentNotes);

  return (
    <DeskPage title="This week">
      {/* A: Overview */}
      {overview ? <DashboardOverview data={overview} /> : <Skeleton />}

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
      {articles ? <ArticleDetailList articles={articles} /> : <Skeleton />}

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
    </DeskPage>
  );
}

function Skeleton() {
  return (
    <div role="status" className="animate-pulse space-y-3">
      <span className="sr-only">Loading reading activity…</span>
      <div className="h-4 bg-[var(--reader-chip)] rounded w-24" />
      <div className="h-8 bg-[var(--reader-chip)] rounded w-16" />
      <div className="h-3 bg-[var(--reader-chip)] rounded w-32" />
    </div>
  );
}
