"use client";
import { X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useCommand, useShortcuts } from "@/lib/shortcuts";
import { useModalDialog } from "@/lib/use-modal-dialog";

const SECTIONS: { title: string; keys: [string, string][] }[] = [
  {
    title: "Everywhere",
    keys: [
      ["?", "Show these shortcuts"],
      ["g h", "Go home"],
      ["g l", "Go to your library"],
      ["g n", "Go to notes"],
      ["g w", "Go to this week"],
      ["g s", "Go to sources"],
      ["Esc", "Close a card, panel or menu"],
    ],
  },
  {
    title: "Home",
    keys: [
      ["/", "Find an article or paste a link"],
      ["↑ ↓", "Choose a search result, Enter to read"],
      ["1 – 4", "Read for 5, 10, 20 or 30+ minutes"],
      ["c", "Continue reading"],
      ["j  k", "Move through Up next, Enter to open"],
    ],
  },
  {
    title: "Reading",
    keys: [
      ["j  k", "Next and previous paragraph"],
      ["e", "Explain the selection or paragraph"],
      ["s", "Simplify it"],
      ["d", "Define a word or phrase in context"],
      ["a", "Ask about it"],
      ["h", "Highlight it"],
      ["p", "Pen-mark it"],
      ["o", "Open the note or conversation on this paragraph"],
      ["/", "Ask about the whole article"],
      ["r", "Rate the article"],
      ["u", "Show or hide the summary"],
      ["n", "Open notes"],
      [",", "Reading settings"],
      ["l", "Listen"],
    ],
  },
  {
    title: "Library",
    keys: [["/", "Ask your library"]],
  },
];

function Key({ children }: { children: string }) {
  return (
    <span className="flex gap-1">
      {children.split(/\s+/).map((part) =>
        part === "–" ? (
          <span key={part} className="text-[var(--reader-muted)]">
            –
          </span>
        ) : (
          <kbd key={part} className="reader-kbd min-w-[1.6em] text-[11px]">
            {part}
          </kbd>
        ),
      )}
    </span>
  );
}

/** Global shortcuts (help sheet and "g" navigation), mounted once in the root layout. */
export function KeyboardShortcuts() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [enabled, setEnabled] = useState(true);
  useEffect(() => {
    const enabled =
      localStorage.getItem("marginalia:keyboard-shortcuts") !== "off";
    setEnabled(enabled);
    document.documentElement.dataset.keyboardShortcuts = enabled ? "on" : "off";
  }, []);

  useShortcuts({
    "?": () => setOpen((o) => !o),
    "g h": () => router.push("/"),
    "g l": () => router.push("/library"),
    "g n": () => router.push("/notes"),
    "g w": () => router.push("/reading"),
    "g s": () => router.push("/feeds"),
  });
  useCommand("open-shortcuts", () => setOpen(true));

  useModalDialog(dialogRef, open);

  return (
    <dialog
      ref={dialogRef}
      aria-label="Keyboard shortcuts"
      onCancel={(e) => {
        e.preventDefault();
        setOpen(false);
      }}
      onClose={() => setOpen(false)}
      className="m-auto w-[calc(100%-2rem)] max-w-[760px] max-h-[86dvh] overflow-y-auto rounded-2xl p-6 font-sans bg-[var(--reader-surface)] text-[var(--reader-fg)] ring-1 ring-[var(--reader-border)] shadow-[0_30px_80px_-30px_rgba(0,0,0,0.6)] backdrop:bg-black/40"
    >
      <div className="flex items-center justify-between">
        <h2 className="font-serif text-[24px] tracking-tight">
          Keyboard shortcuts
        </h2>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close"
          className="w-8 h-8 flex items-center justify-center rounded-full text-[var(--reader-muted)] hover:text-[var(--reader-fg)] hover:bg-[var(--reader-chip)]"
        >
          <X size={16} />
        </button>
      </div>
      <div className="mt-5 grid gap-x-10 gap-y-6 sm:grid-cols-2">
        {SECTIONS.map((section) => (
          <section key={section.title}>
            <h3 className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-[var(--reader-muted)]">
              {section.title}
            </h3>
            <dl className="mt-2 space-y-1.5">
              {section.keys.map(([keys, description]) => (
                <div
                  key={keys}
                  className="flex items-center justify-between gap-4 text-[13px]"
                >
                  <dt className="text-[var(--reader-fg-soft)]">
                    {description}
                  </dt>
                  <dd className="shrink-0">
                    <Key>{keys}</Key>
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
      <p className="mt-6 text-[12px] text-[var(--reader-muted)]">
        Tab moves between controls everywhere. Shortcuts pause while you type in
        a field.
      </p>
      <label className="mt-3 flex items-center gap-2 text-[13px]">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => {
            const enabled = e.currentTarget.checked;
            setEnabled(enabled);
            document.documentElement.dataset.keyboardShortcuts = enabled
              ? "on"
              : "off";
            localStorage.setItem(
              "marginalia:keyboard-shortcuts",
              enabled ? "on" : "off",
            );
          }}
        />
        Enable single-key shortcuts (Tab and Escape always work)
      </label>
    </dialog>
  );
}
