import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Poll feeds every 30 minutes
crons.interval(
  "poll feeds",
  { minutes: 30 },
  internal.actions.pollFeeds.pollAllFeeds,
);

export default crons;
