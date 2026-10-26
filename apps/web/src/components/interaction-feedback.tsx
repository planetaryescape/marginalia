"use client";
import { useEffect, useState } from "react";
import {
  disposeTouchFeedback,
  readFeedback,
  touchFeedback,
  writeFeedback,
} from "@/lib/interaction-feedback";
import { quietControl } from "./settings-controls";
import { SettingsSection } from "./settings-section";

export function InteractionFeedback() {
  useEffect(() => {
    let settings = readFeedback();
    const refresh = () => {
      settings = readFeedback();
    };
    const feedback = (event: PointerEvent) => {
      if (event.pointerType !== "touch" && event.pointerType !== "pen") return;
      const target =
        event.target instanceof Element
          ? event.target.closest("button, a, [role=button]")
          : null;
      if (
        !target ||
        target.matches(
          ":disabled, [aria-disabled=true], [data-feedback-test]",
        ) ||
        target.closest("[contenteditable=true]")
      )
        return;
      touchFeedback(settings);
    };
    document.addEventListener("pointerup", feedback, { passive: true });
    window.addEventListener("reader-feedback", refresh);
    return () => {
      document.removeEventListener("pointerup", feedback);
      window.removeEventListener("reader-feedback", refresh);
      disposeTouchFeedback();
    };
  }, []);
  return null;
}
export function FeedbackPreferences() {
  const [settings, setSettings] = useState({ haptics: true, sound: false });
  const [tested, setTested] = useState(false);
  useEffect(() => setSettings(readFeedback()), []);
  return (
    <SettingsSection
      title="Touch feedback"
      description="Brief feedback for touch actions. On iPhone, taps use a best-effort Safari switch fallback. Sounds are off by default; reduced-motion preferences disable feedback."
    >
      <div>
        {(["haptics", "sound"] as const).map((key) => (
          <label
            key={key}
            className="flex min-h-12 items-center justify-between gap-4 border-b border-[var(--reader-border)] text-sm"
          >
            <span>
              {key === "haptics"
                ? "Haptics, where supported"
                : "Soft tap sounds"}
            </span>
            <input
              type="checkbox"
              checked={settings[key]}
              onChange={(e) => {
                const next = { ...settings, [key]: e.target.checked };
                setSettings(next);
                writeFeedback(next);
              }}
              className="h-5 w-5 accent-[var(--ink)]"
            />
          </label>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className={quietControl}
          data-feedback-test
          disabled={!settings.haptics && !settings.sound}
          onClick={() => {
            touchFeedback(settings);
            setTested(true);
          }}
        >
          Test feedback
        </button>
      </div>
      {tested && (
        <p role="status" className="text-sm text-[var(--reader-muted)]">
          If you didn't feel a tap, your browser or device settings may not
          support it. Soft tap sounds are an optional alternative.
        </p>
      )}
    </SettingsSection>
  );
}
