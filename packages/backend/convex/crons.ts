import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();
crons.interval(
  "discard unpublished Study runs",
  { hours: 1 },
  internal.scriptureStudyCleanup.sweep,
  {},
);
crons.interval(
  "purge expired Bible response cache",
  { hours: 1 },
  internal.bibleResourceCache.prune,
  {},
);

// Each job fans out to the owner's library and every active reader
// (background.ts); disabled and deleted readers are skipped.

// One-time, idempotent initialization also covers installations without Reader.
crons.interval(
  "initialize reading queue counts",
  { minutes: 15 },
  internal.background.fanOut,
  { job: "queue" },
);

// Poll feeds every 30 minutes
crons.interval("poll feeds", { minutes: 30 }, internal.background.fanOut, {
  job: "feeds",
});

// Pull new Readwise Reader documents and highlights for libraries with a token
crons.interval(
  "sync readwise reader",
  { minutes: 15 },
  internal.background.fanOut,
  { job: "readwise" },
);

crons.interval(
  "sweep stale sign-in budgets",
  { minutes: 60 },
  internal.access.sweepAuthAttempts,
  {},
);

// Uploads nobody imported (documentImports.ts)
crons.interval(
  "remove abandoned uploads",
  { minutes: 60 },
  internal.documentImports.sweepUploads,
  {},
);

// What each reader tends to read, then the long articles worth annotating
// ahead of time (D-DES-056, D-DES-057). The profile runs first so the choice
// uses today's; the finish of an article also queues a refresh of its own.
crons.daily(
  "recompute reading taste",
  { hourUTC: 3, minuteUTC: 0 },
  internal.background.fanOut,
  { job: "taste" },
);

crons.daily(
  "annotate likely reads ahead",
  { hourUTC: 4, minuteUTC: 0 },
  internal.background.fanOut,
  { job: "preAnnotate" },
);

// Tag pairs that look like one topic, as suggestions only (D-DES-059)
crons.daily(
  "suggest tag merges",
  { hourUTC: 3, minuteUTC: 30 },
  internal.background.fanOut,
  { job: "tagMerge" },
);

export default crons;
