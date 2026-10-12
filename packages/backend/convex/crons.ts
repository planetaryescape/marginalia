import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// One-time, idempotent initialization also covers installations without Reader.
crons.interval(
  "initialize reading queue counts",
  { minutes: 15 },
  internal.readingQueue.initialize,
  {},
);

// Poll feeds every 30 minutes
crons.interval(
  "poll feeds",
  { minutes: 30 },
  internal.actions.pollFeeds.pollAllFeeds,
);

// Pull new Readwise Reader documents and highlights (no-op without READWISE_TOKEN)
crons.interval(
  "sync readwise reader",
  { minutes: 15 },
  internal.actions.readwiseSync.sync,
);

export default crons;
