import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

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

export default crons;
