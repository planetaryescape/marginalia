"use client";
import { useState } from "react";
import { DeskPage } from "@/components/desk-page";
import { NotesGraph } from "@/components/notes-graph";
import { NotesList } from "@/components/notes-list";
import { useShortcuts } from "@/lib/shortcuts";

type View = "map" | "list";

export default function NotesPage() {
  const [view, setView] = useState<View>("map");
  useShortcuts(
    { "[": () => setView("map"), "]": () => setView("list") },
    true,
    {
      help: {
        group: "Notes",
        keys: [
          ["[", "Map view"],
          ["]", "List view"],
        ],
      },
    },
  );
  const toggle = <ViewToggle view={view} onChange={setView} />;
  if (view === "list")
    return (
      <DeskPage title="Your notes" action={toggle}>
        <NotesList />
      </DeskPage>
    );
  return <NotesGraph toggle={toggle} />;
}

function ViewToggle({
  view,
  onChange,
}: {
  view: View;
  onChange: (view: View) => void;
}) {
  const option = (value: View, label: string) => (
    <button
      type="button"
      aria-pressed={view === value}
      onClick={() => onChange(value)}
      className={
        view === value
          ? "font-medium text-[var(--reader-fg)]"
          : "text-[var(--reader-fg-soft)] hover:text-[var(--reader-fg)]"
      }
    >
      {label}
    </button>
  );
  return (
    <div
      role="group"
      aria-label="Notes view"
      className="flex items-center gap-2 text-[13.5px]"
    >
      {option("map", "Map")}
      <span aria-hidden="true" className="text-[var(--reader-muted)]">
        ·
      </span>
      {option("list", "List")}
    </div>
  );
}
