import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";
import { DEFAULT_USER_ID } from "./lib/constants";

const crons = cronJobs();

// Background work still runs for the owner's library only; per-reader jobs
// arrive with reader-owned credentials.
const owner = { userId: DEFAULT_USER_ID };

// One-time, idempotent initialization also covers installations without Reader.
crons.interval(
  "initialize reading queue counts",
  { minutes: 15 },
  internal.readingQueue.initialize,
  owner,
);

// Poll feeds every 30 minutes
crons.interval(
  "poll feeds",
  { minutes: 30 },
  internal.actions.pollFeeds.pollAllFeeds,
  owner,
);

// Pull new Readwise Reader documents and highlights (no-op without READWISE_TOKEN)
crons.interval(
  "sync readwise reader",
  { minutes: 15 },
  internal.actions.readwiseSync.sync,
  owner,
);

export default crons;
