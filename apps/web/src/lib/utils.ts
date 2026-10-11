import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatReadTime(minutes: number | undefined): string {
  if (!minutes) return "? min";
  if (minutes < 1) return "< 1 min";
  return `${minutes} min read`;
}

export function formatDate(timestamp: number | undefined): string {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  const now = new Date();
  const diffDays = Math.floor(
    (now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24),
  );

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function obsidianLink(notePath: string): string {
  // obsidian://open?vault=pkm&file=path/to/note
  const cleanPath = notePath.replace(/\.md$/, "");
  return `obsidian://open?vault=pkm&file=${encodeURIComponent(cleanPath)}`;
}
