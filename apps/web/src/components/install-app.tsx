"use client";

import * as Popover from "@radix-ui/react-popover";
import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

interface InstallPrompt extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

declare global {
  interface WindowEventMap {
    beforeinstallprompt: InstallPrompt;
  }
}

/** Tracks whether the app is installed and whether the browser offered to install it. */
export function useInstallPrompt() {
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  const [installed, setInstalled] = useState(false);
  useEffect(() => {
    const standalone = window.matchMedia("(display-mode: standalone)");
    const update = () => setInstalled(standalone.matches);
    const capture = (event: InstallPrompt) => {
      event.preventDefault();
      setPrompt(event);
    };
    const complete = () => {
      setInstalled(true);
      setPrompt(null);
    };
    update();
    standalone.addEventListener("change", update);
    window.addEventListener("beforeinstallprompt", capture);
    window.addEventListener("appinstalled", complete);
    return () => {
      standalone.removeEventListener("change", update);
      window.removeEventListener("beforeinstallprompt", capture);
      window.removeEventListener("appinstalled", complete);
    };
  }, []);
  return { installed, prompt, clearPrompt: () => setPrompt(null) };
}

/**
 * The install instructions popover body. Render it inside a Popover.Root whose
 * anchor is the account menu's avatar.
 */
export function InstallAppContent({
  prompt,
  clearPrompt,
  onDone,
}: {
  prompt: InstallPrompt | null;
  clearPrompt: () => void;
  onDone: () => void;
}) {
  return (
    <Popover.Portal>
      <Popover.Content
        align="end"
        sideOffset={8}
        collisionPadding={12}
        className="reader-popover z-50 w-80 max-w-[calc(100vw-24px)] rounded-lg bg-[var(--reader-surface)] p-4 font-sans text-sm text-[var(--reader-fg)] ring-1 ring-[var(--reader-border)] shadow-xl"
      >
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-medium">Marginalia on your home screen</h2>
          <Popover.Close
            aria-label="Close install instructions"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full hover:bg-[var(--reader-chip)]"
          >
            <X size={16} />
          </Popover.Close>
        </div>
        {prompt ? (
          <button
            type="button"
            className="mt-3 min-h-11 rounded-full bg-[var(--reader-fg)] px-5 text-[var(--reader-bg)]"
            onClick={async () => {
              try {
                await prompt.prompt();
                await prompt.userChoice;
                onDone();
              } catch {
                toast.error("Use your browser’s menu to install Marginalia.");
              } finally {
                clearPrompt();
              }
            }}
          >
            Install app
          </button>
        ) : (
          <div className="mt-2 space-y-2 text-[var(--reader-fg-soft)]">
            <p>
              <strong>iPhone or iPad:</strong> open in Safari, tap Share, then
              Add to Home Screen. Keep Open as Web App enabled if offered.
            </p>
            <p>
              <strong>Android or desktop:</strong> use Install app or Add to
              Home screen in your browser’s menu, if available.
            </p>
          </div>
        )}
        <p className="mt-3 text-xs leading-relaxed text-[var(--reader-muted)]">
          Reading, notes and AI still need a connection. Installing doesn’t
          download your library.
        </p>
      </Popover.Content>
    </Popover.Portal>
  );
}
