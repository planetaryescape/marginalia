// Hardcoded user ID — no auth in v1
export const DEFAULT_USER_ID = "default_user";

// Reading speed: average adult reads ~220 WPM
export const WORDS_PER_MINUTE = 220;

// Annotation quality thresholds
// Matches the 0.5 "specific and useful" floor in the annotation prompt's scoring scale
export const MIN_RELEVANCE_SCORE = 0.5;
export const MAX_ANNOTATIONS_PER_ARTICLE = 10;

// Feed polling
export const FEED_POLL_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
