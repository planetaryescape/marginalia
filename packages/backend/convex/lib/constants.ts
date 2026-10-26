// The owner's library ID. Other readers get their own (see access.ts getReader).
export const DEFAULT_USER_ID = "default_user";

// Reading speed: average adult reads ~220 WPM
export const WORDS_PER_MINUTE = 220;

// Annotation quality thresholds
// Matches the 0.5 "specific and useful" floor in the annotation prompt's scoring scale
export const MIN_RELEVANCE_SCORE = 0.5;
// How many notes an article gets is budgeted by its length: lib/annotationGate.ts

// Feed polling
export const FEED_POLL_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
// Articles extracted per run; a full page schedules the next run
export const EXTRACT_PAGE = 10;
