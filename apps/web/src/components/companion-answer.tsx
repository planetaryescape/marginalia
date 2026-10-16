import Link from "next/link";
import { Fragment, type ReactNode } from "react";

const INLINE =
  /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(¶\s?\d+(?:\s*[–-]\s*\d+)?)|\[([^\]\n]+)\]\((https?:\/\/[^)\s]+|\/read\/[a-z0-9]+)\)/g;

function renderInline(
  text: string,
  onJump: (index: number) => void,
): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    const index = match.index ?? 0;
    if (index > last) nodes.push(text.slice(last, index));
    const [token, code, bold, ref, linkText, linkUrl] = match;
    if (code) {
      nodes.push(
        <code
          key={index}
          className="font-mono text-[0.86em] px-1 py-px rounded bg-[var(--reader-chip)] text-[var(--reader-fg)]"
        >
          {code.slice(1, -1)}
        </code>,
      );
    } else if (bold) {
      nodes.push(
        <strong key={index} className="font-semibold text-[var(--reader-fg)]">
          {bold.slice(2, -2)}
        </strong>,
      );
    } else if (ref) {
      const first = Number(ref.match(/\d+/)?.[0]);
      nodes.push(
        <button
          key={index}
          type="button"
          onClick={() => onJump(first - 1)}
          title={`Jump to ${ref.replace(/\s/g, "")}`}
          className="inline-flex items-center align-[0.08em] mx-px px-1.5 h-[1.35em] rounded-md font-mono text-[0.72em] tabular-nums bg-[var(--reader-chip)] text-[var(--reader-muted)] hover:text-[var(--ink)] transition-colors"
        >
          {ref.replace(/\s/g, "")}
        </button>,
      );
    } else if (linkUrl?.startsWith("/read/")) {
      // Links to articles in the reader's own library
      nodes.push(
        <Link
          key={index}
          href={linkUrl}
          className="font-medium text-[var(--reader-fg)] underline decoration-[var(--pencil-rule)] decoration-[1.5px] underline-offset-[3px] hover:decoration-[var(--ink)]"
        >
          {linkText}
        </Link>,
      );
    } else if (linkUrl) {
      nodes.push(
        <a
          key={index}
          href={linkUrl}
          target="_blank"
          rel="noopener noreferrer"
          title={linkUrl}
          className="text-[var(--ink)] underline decoration-[var(--pencil-rule)] underline-offset-2 hover:decoration-[var(--ink)]"
        >
          {linkText}
        </a>,
      );
    } else {
      nodes.push(token);
    }
    last = index + token.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

export function CompanionAnswer({
  text,
  lead,
  streaming,
  onJump,
}: {
  text: string;
  lead: boolean;
  streaming: boolean;
  onJump: (index: number) => void;
}) {
  const paragraphs = text.trim().split(/\n{2,}/);
  return (
    <div className="space-y-3">
      {paragraphs.map((paragraph, i) => {
        const isLast = i === paragraphs.length - 1;
        const content = (
          <Fragment key="content">
            {renderInline(paragraph.replace(/\n/g, " "), onJump)}
            {streaming && isLast && (
              <span className="companion-caret" aria-hidden />
            )}
          </Fragment>
        );
        return i === 0 && lead ? (
          <p
            key={i}
            className="text-[15px] leading-[1.6] font-medium text-[var(--reader-fg)]"
          >
            <span className="companion-lead">{content}</span>
          </p>
        ) : (
          <p
            key={i}
            className="text-[14px] leading-[1.7] text-[var(--reader-fg-soft)]"
          >
            {content}
          </p>
        );
      })}
    </div>
  );
}
