"use client";
import { api } from "@marginalia/backend/convex/_generated/api";
import { useAction, useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { type GraphEdge, KIND_LABELS } from "@/lib/idea-kinds";
import { readLink } from "@/lib/notes-groups";

const LABEL =
  "mb-2 text-[11.5px] font-medium uppercase tracking-[0.08em] text-[var(--reader-muted)]";
const SECONDARY =
  "rounded-md bg-[var(--reader-chip)] px-3 py-1.5 text-[13.5px] text-[var(--reader-fg-soft)] hover:text-[var(--reader-fg)] transition-colors disabled:opacity-50";
const PRIMARY =
  "rounded-md bg-[var(--reader-fg)] px-3 py-1.5 text-[13.5px] text-[var(--reader-bg)] disabled:opacity-50";

function errorText(error: unknown, fallback: string): string {
  return error instanceof ConvexError && typeof error.data === "string"
    ? error.data
    : fallback;
}

function formatDay(at: number) {
  return new Date(at).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

/** Wraps a plain-text draft as the paragraphs the note editor stores. */
export function draftToHtml(text: string): string {
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return text
    .trim()
    .split(/\n{2,}/)
    .map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

/** One idea, read in full, with the ways to carry on from it. */
export function NodePanel({
  nodeKey,
  onWrite,
}: {
  nodeKey: string;
  onWrite: (prompt?: string) => void;
}) {
  const node = useQuery(api.ideaGraph.node, { key: nodeKey });
  if (node === undefined)
    return (
      <p role="status" className="text-sm text-[var(--reader-muted)]">
        Opening…
      </p>
    );
  if (node === null)
    return (
      <p className="text-sm text-[var(--reader-muted)]">
        This idea is no longer in your notes.
      </p>
    );
  const source = [
    node.articleTitle,
    node.filePath ?? undefined,
    formatDay(node.createdAt),
  ].filter(Boolean);
  return (
    <div>
      <p className={LABEL}>{KIND_LABELS[node.kind]}</p>
      {node.quote && (
        <p className="mb-2 font-serif text-[15px] italic leading-normal text-[var(--reader-muted)]">
          “{node.quote}”
        </p>
      )}
      {node.kind === "note" && (
        <p className="mb-3 whitespace-pre-wrap break-words border-l-2 border-[var(--pen)] pl-3 text-[15.5px] leading-relaxed text-[var(--reader-fg)]">
          {node.text}
        </p>
      )}
      {node.kind === "highlight" && (
        <p className="mb-3 font-serif text-[16px] leading-relaxed text-[var(--reader-fg)]">
          <span className="rounded-sm bg-[var(--highlighter)]">
            {node.text}
          </span>
        </p>
      )}
      {node.kind === "answer" && (
        <p
          data-hand="pencil"
          className="mb-3 whitespace-pre-wrap break-words text-[15px] leading-relaxed text-[var(--pencil)]"
        >
          {node.text}
        </p>
      )}
      {node.kind === "article" && node.articleId && (
        <>
          <h2 className="mb-2 font-serif text-xl leading-snug text-[var(--reader-fg)]">
            {node.articleTitle}
          </h2>
          <p className="mb-3 text-[15px] leading-relaxed text-[var(--reader-fg-soft)]">
            {node.text}
          </p>
          <Link
            href={`/read/${node.articleId}`}
            className="mb-4 inline-block text-[13.5px] text-[var(--reader-fg)] underline decoration-[var(--reader-border-strong)] underline-offset-[3px]"
          >
            Open article
          </Link>
        </>
      )}
      {node.kind === "vault" && (
        <p className="mb-3 whitespace-pre-wrap break-words border-l-2 border-[var(--vault)] pl-3 text-[15px] leading-relaxed text-[var(--reader-fg)]">
          {node.text}
        </p>
      )}
      <p
        className="mb-4 text-[12.5px] text-[var(--reader-muted)]"
        hidden={node.kind === "article"}
      >
        {node.articleId && node.articleTitle ? (
          <>
            From{" "}
            <Link
              href={readLink(node.articleId, node.quote)}
              className="text-[var(--reader-fg-soft)] underline decoration-[var(--reader-border-strong)] underline-offset-[3px]"
            >
              {node.articleTitle}
            </Link>{" "}
            · {formatDay(node.createdAt)}
          </>
        ) : (
          source.join(" · ")
        )}
      </p>
      {node.canWrite ? (
        <div className="flex flex-wrap gap-2.5">
          {node.kind !== "article" && (
            <button
              type="button"
              className={SECONDARY}
              onClick={() => onWrite(node.text)}
            >
              Reply
            </button>
          )}
          <button type="button" className={SECONDARY} onClick={() => onWrite()}>
            New connected note
          </button>
        </div>
      ) : (
        <p className="text-[13px] text-[var(--reader-muted)]">
          Marginalia hasn’t tied this vault note to an article yet, so notes
          can’t be written beside it. Open one of your notes to write.
        </p>
      )}
    </div>
  );
}

/** Writes a note that joins the map, linked to the idea it was written from. */
export function Composer({
  fromKey,
  fromLabel,
  prompt,
  onSaved,
  onCancel,
}: {
  fromKey: string;
  fromLabel: string;
  /** Set for a reply: the idea being answered. */
  prompt?: string;
  onSaved: (key: string) => void;
  onCancel: () => void;
}) {
  const write = useMutation(api.ideaLinks.writeConnected);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  // Opening the composer is the reader asking to write
  useEffect(() => field.current?.focus(), []);

  async function save() {
    const plain = text.trim();
    if (!plain || saving) return;
    setSaving(true);
    try {
      const key = await write({
        from: fromKey,
        content: draftToHtml(plain),
        contentPlain: plain,
        prompt,
      });
      onSaved(key);
    } catch (error) {
      toast.error(errorText(error, "Couldn't save the note. Try again."));
      setSaving(false);
    }
  }

  return (
    <div>
      <p className={LABEL}>
        {prompt ? "Reply to" : "New note, linked to"} “{fromLabel}”
      </p>
      <textarea
        ref={field}
        aria-label="Your note"
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && text) event.stopPropagation();
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            void save();
          }
        }}
        placeholder="Think it through here…"
        rows={5}
        className="min-h-[96px] w-full resize-y rounded-lg border border-[var(--reader-border-strong)] bg-transparent p-3 text-[14.5px] leading-relaxed text-[var(--reader-fg)] placeholder:text-[var(--reader-muted)] focus:outline-none focus-visible:border-[var(--reader-focus)]"
      />
      <div className="mt-2.5 flex gap-2.5">
        <button
          type="button"
          className={PRIMARY}
          disabled={!text.trim() || saving}
          onClick={() => void save()}
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button type="button" className={SECONDARY} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

type Explained =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "done"; reason: string };

/** Why two ideas are connected: found in the notes, or generated once and kept. */
export function EdgePanel({
  edge,
  labels,
}: {
  edge: GraphEdge;
  labels: Map<string, string>;
}) {
  const explain = useAction(api.actions.explainIdeaEdge.explain);
  const link = useMutation(api.ideaLinks.link);
  const unlink = useMutation(api.ideaLinks.unlink);
  const [attempt, setAttempt] = useState(0);
  const [explained, setExplained] = useState<Explained>({ status: "loading" });
  const linked = edge.reasons.some((r) => r.type === "linked");

  // Only a pair that embeddings alone put together costs a model call
  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` re-runs the request after a failure
  useEffect(() => {
    if (!edge.needsAi) return;
    let live = true;
    setExplained({ status: "loading" });
    explain({ a: edge.a, b: edge.b })
      .then((result) => {
        if (!live) return;
        if (result.source === "generated") {
          setExplained({ status: "done", reason: result.reason });
        } else
          setExplained({
            status: "done",
            reason: result.reasons.map((r) => r.text).join(" · "),
          });
      })
      .catch((error: unknown) => {
        if (live)
          setExplained({
            status: "error",
            message: errorText(error, "Couldn't explain this one just now."),
          });
      });
    return () => {
      live = false;
    };
  }, [edge.id, edge.a, edge.b, edge.needsAi, explain, attempt]);

  return (
    <div aria-live="polite">
      <p className={LABEL}>Why these connect</p>
      <p className="mb-3 text-[13px] text-[var(--reader-muted)]">
        “{labels.get(edge.a)}” and “{labels.get(edge.b)}”
      </p>
      {edge.needsAi ? (
        <>
          {explained.status === "loading" && (
            <p
              role="status"
              className="mb-3 text-[14.5px] text-[var(--pencil)]"
            >
              Marginalia is looking at the two together…
            </p>
          )}
          {explained.status === "done" && (
            <>
              <p
                data-hand="pencil"
                className="mb-3 text-[14.5px] leading-relaxed text-[var(--pencil)]"
              >
                {explained.reason}
              </p>
              <p className="mb-4 text-[12.5px] text-[var(--reader-muted)]">
                Marginalia noticed this · generated when you selected it. What
                it means is yours to say.
              </p>
            </>
          )}
          {explained.status === "error" && (
            <div className="mb-4">
              <p className="mb-2 text-[14px] text-[var(--danger)]">
                {explained.message}
              </p>
              <button
                type="button"
                className={SECONDARY}
                onClick={() => setAttempt((n) => n + 1)}
              >
                Try again
              </button>
            </div>
          )}
        </>
      ) : (
        <ul className="mb-4 space-y-1 text-[14.5px] text-[var(--reader-fg)]">
          {edge.reasons.map((reason) => (
            <li key={reason.text}>{reason.text}</li>
          ))}
        </ul>
      )}
      <div className="flex gap-2.5">
        {linked ? (
          <button
            type="button"
            className={SECONDARY}
            onClick={() =>
              unlink({ a: edge.a, b: edge.b }).catch(() =>
                toast.error("Couldn't remove the link. Try again."),
              )
            }
          >
            Remove link
          </button>
        ) : (
          <button
            type="button"
            className={SECONDARY}
            onClick={() =>
              link({ from: edge.a, to: edge.b }).catch((error) =>
                toast.error(
                  errorText(error, "Couldn't keep the link. Try again."),
                ),
              )
            }
          >
            Keep this link
          </button>
        )}
      </div>
    </div>
  );
}
