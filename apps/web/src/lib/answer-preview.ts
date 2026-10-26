/**
 * Plain text for a collapsed margin answer. Strips the markdown an answer
 * carries: emphasis, code, links and list markers at line starts. A hyphen or
 * a lone asterisk inside a sentence stays, because only a marker that starts a
 * line is taken as list syntax.
 */
export function answerPreview(markdown: string): string {
  return markdown
    .split("\n")
    .map((line) => line.replace(/^\s*[-*]\s+/, ""))
    .join(" ")
    .replace(/\[([^\]\n]+)\]\([^)\s]+\)/g, "$1")
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    .replace(/\*(\S(?:[^*\n]*\S)?)\*/g, "$1")
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}
