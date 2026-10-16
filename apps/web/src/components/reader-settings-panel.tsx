"use client";
import { api } from "@marginalia/backend/convex/_generated/api";
import * as Popover from "@radix-ui/react-popover";
import { useMutation, useQuery } from "convex/react";
import {
  AlignJustify,
  AlignLeft,
  ChevronDown,
  Headphones,
  Map as MapIcon,
  Pilcrow,
  RotateCcw,
  ScanEye,
} from "lucide-react";
import Link from "next/link";
import { useTheme } from "next-themes";
import { type ReactNode, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  DROP_CAP_FAMILIES,
  DROP_CAP_LINES,
  type DropCap,
  type HighlighterColor,
  isDarkTheme,
  type PenColor,
  type ReaderSettings,
  type ReaderTheme,
  SIZE_RANGE,
  TYPEFACE_FAMILIES,
  type Typeface,
} from "@/lib/reader-settings";
import { useCommand } from "@/lib/shortcuts";
import { cn } from "@/lib/utils";

type ModelRole = "annotations" | "quick" | "deep";
type ModelSettings = {
  selected: Record<ModelRole, string | null>;
  available: { id: string; name: string; provider: string }[];
};

const PROVIDER_LABELS: Record<string, string> = {
  openrouter: "OpenRouter",
  openai: "OpenAI",
  anthropic: "Anthropic",
  chatgpt: "ChatGPT plan",
};

function ModelRow({
  label,
  modelRole: role,
  models,
  onChange,
}: {
  label: string;
  modelRole: ModelRole;
  models: ModelSettings | undefined;
  onChange: (role: ModelRole, model: string) => void;
}) {
  // Name the provider only when the same model could come from more than one
  const manyProviders =
    new Set(models?.available.map((m) => m.provider)).size > 1;
  return (
    <Row label={label}>
      <div className="relative flex-1">
        <select
          value={models?.selected[role] ?? ""}
          disabled={!models}
          onChange={(e) => onChange(role, e.target.value)}
          aria-label={`${label} model`}
          className="w-full h-8 appearance-none rounded-[10px] bg-[var(--reader-chip)] pl-3 pr-8 text-[12.5px] text-[var(--reader-fg)] outline-none focus-visible:ring-1 focus-visible:ring-[var(--reader-focus)] cursor-pointer disabled:opacity-50"
        >
          {models?.available.map((model) => (
            <option key={model.id} value={model.id}>
              {model.name}
              {manyProviders
                ? ` · ${PROVIDER_LABELS[model.provider] ?? model.provider}`
                : ""}
            </option>
          ))}
        </select>
        <ChevronDown
          size={14}
          className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--reader-muted)]"
        />
      </div>
    </Row>
  );
}

const THEMES: { id: ReaderTheme; label: string; bg: string; fg: string }[] = [
  { id: "auto", label: "Auto", bg: "#faf8f5", fg: "#201d1b" },
  { id: "paper", label: "Paper", bg: "#faf8f5", fg: "#201d1b" },
  { id: "sepia", label: "Sepia", bg: "#f3ead8", fg: "#4a3b2a" },
  { id: "snow", label: "Snow", bg: "#ffffff", fg: "#1a1a1a" },
  { id: "dusk", label: "Dusk", bg: "#34302c", fg: "#f1ece6" },
  { id: "night", label: "Night", bg: "#201d1b", fg: "#e7e5e3" },
  { id: "ink", label: "Ink", bg: "#0e1014", fg: "#dde1e8" },
];

const PENS: { id: PenColor; label: string; hex: string }[] = [
  { id: "vermilion", label: "Vermilion", hex: "#d1492b" },
  { id: "cobalt", label: "Cobalt", hex: "#3b63d9" },
  { id: "forest", label: "Forest", hex: "#2f7d47" },
  { id: "graphite", label: "Graphite", hex: "#555555" },
];

const HIGHLIGHTERS: { id: HighlighterColor; label: string; hex: string }[] = [
  { id: "yellow", label: "Yellow", hex: "#f6d55c" },
  { id: "green", label: "Green", hex: "#9fd89a" },
  { id: "blue", label: "Blue", hex: "#9cc4f5" },
  { id: "pink", label: "Pink", hex: "#f2a7c8" },
];

const TYPEFACES: { id: Typeface; label: string }[] = [
  { id: "serif", label: "Serif" },
  { id: "book", label: "Book" },
  { id: "sans", label: "Sans" },
  { id: "legible", label: "Legible" },
];

const DROP_CAP_OPTIONS: { id: DropCap; label: string; family?: string }[] = [
  { id: "off", label: "Off" },
  { id: "text", label: "Text", family: DROP_CAP_FAMILIES.text },
  { id: "ornate", label: "Ornate", family: DROP_CAP_FAMILIES.ornate },
  { id: "gothic", label: "Gothic", family: DROP_CAP_FAMILIES.gothic },
];

type Tab = "look" | "text" | "answers";

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { id: T; label: ReactNode }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex flex-1 rounded-[10px] bg-[var(--reader-chip)] p-[3px]">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          aria-pressed={value === option.id}
          onClick={() => onChange(option.id)}
          className={cn(
            "flex-1 flex items-center justify-center gap-1.5 h-7 rounded-[8px] text-[12.5px] transition-all outline-none focus-visible:ring-1 focus-visible:ring-[var(--reader-focus)]",
            value === option.id
              ? "bg-[var(--reader-surface)] text-[var(--reader-fg)] font-medium shadow-[0_1px_2px_rgba(0,0,0,0.12)]"
              : "text-[var(--reader-muted)] hover:text-[var(--reader-fg)]",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-[76px] shrink-0 text-[12.5px] text-[var(--reader-muted)]">
        {label}
      </span>
      {children}
    </div>
  );
}

function SwatchRow<T extends string>({
  label,
  value,
  options,
  onChange,
  shape,
}: {
  label: string;
  value: T;
  options: { id: T; label: string; hex: string }[];
  onChange: (value: T) => void;
  shape: "dot" | "marker";
}) {
  const selected = options.find((o) => o.id === value);
  return (
    <Row label={label}>
      <div className="flex items-center gap-1.5">
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            title={option.label}
            aria-label={option.label}
            aria-pressed={value === option.id}
            onClick={() => onChange(option.id)}
            className={cn(
              "w-8 h-8 flex items-center justify-center rounded-full transition-shadow",
              value === option.id &&
                "ring-[1.5px] ring-[color-mix(in_srgb,var(--reader-fg)_55%,transparent)]",
            )}
          >
            <span
              className={
                shape === "dot"
                  ? "w-[18px] h-[18px] rounded-full"
                  : "w-[20px] h-[12px] rounded-[3px] -rotate-12"
              }
              style={{ background: option.hex }}
            />
          </button>
        ))}
      </div>
      <span className="hidden min-[380px]:inline ml-auto text-[12.5px] text-[var(--reader-muted)]">
        {selected?.label}
      </span>
    </Row>
  );
}

function ToggleTile({
  icon,
  label,
  active,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "flex items-center justify-center gap-2 h-10 rounded-xl text-[13px] font-medium transition-colors border",
        active
          ? "bg-[var(--reader-chip)] text-[var(--ink)] border-[var(--reader-border-strong)]"
          : "border-[var(--reader-border)] text-[var(--reader-muted)] hover:text-[var(--reader-fg)] hover:bg-[var(--reader-chip)]",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

export interface ReaderSettingsPanelProps {
  settings: ReaderSettings;
  update: (patch: Partial<ReaderSettings>) => void;
  resetText: () => void;
  listening: boolean;
  onToggleListen: () => void;
  /** Lets the toolbar keep itself shown while the panel is open. */
  onOpenChange?: (open: boolean) => void;
}

export function ReaderSettingsPanel({
  settings,
  update,
  resetText,
  listening,
  onToggleListen,
  onOpenChange,
}: ReaderSettingsPanelProps) {
  const [tab, setTab] = useState<Tab>("look");
  const [open, setOpen] = useState(false);
  // The `,` shortcut opens the panel without going through Radix's callback
  useEffect(() => {
    onOpenChange?.(open);
  }, [open, onOpenChange]);
  useCommand("open-settings", () => setOpen(true));
  const models = useQuery(api.userSettings.getModels, {});
  const setModelMutation = useMutation(api.userSettings.setModel);
  const setModel = (role: ModelRole, model: string) => {
    setModelMutation({ role, model }).catch(() =>
      toast.error("Couldn't change the model"),
    );
  };
  const { setTheme } = useTheme();
  const pen = PENS.find((p) => p.id === settings.pen)?.hex ?? PENS[1].hex;

  const chooseTheme = (theme: ReaderTheme) => {
    update({ theme });
    setTheme(
      theme === "auto" ? "system" : isDarkTheme(theme) ? "dark" : "light",
    );
  };

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          aria-keyshortcuts=","
          className="h-11 min-w-11 sm:h-9 sm:min-w-9 px-2.5 flex items-center justify-center rounded-md font-serif text-[15px] text-[var(--ink-muted)] hover:text-[var(--ink)] hover:bg-[var(--reader-chip)] data-[state=open]:bg-[var(--reader-chip)] data-[state=open]:text-[var(--ink)] transition-colors"
          title="Reading settings"
          aria-label="Reading settings"
        >
          Aa
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={10}
          collisionPadding={12}
          className="reader-popover z-50 w-[360px] max-w-[calc(100vw-24px)] max-h-[var(--radix-popover-content-available-height)] overflow-y-auto overscroll-contain rounded-2xl p-4 font-sans bg-[var(--reader-surface)] text-[var(--reader-fg)] ring-1 ring-[var(--reader-border)] shadow-[0_24px_60px_-24px_rgba(0,0,0,0.45)] outline-none"
        >
          <Segmented
            value={tab}
            onChange={setTab}
            options={[
              { id: "look", label: "Look" },
              { id: "text", label: "Text" },
              { id: "answers", label: "Answers" },
            ]}
          />

          {tab === "look" && (
            <div className="mt-4 space-y-4">
              <div>
                <p className="mb-2 text-[12.5px] text-[var(--reader-muted)]">
                  Theme
                </p>
                <div className="grid grid-cols-7 gap-1.5">
                  {THEMES.map((theme) => {
                    const active = settings.theme === theme.id;
                    return (
                      <button
                        key={theme.id}
                        type="button"
                        aria-pressed={active}
                        onClick={() => chooseTheme(theme.id)}
                        className="group flex flex-col items-center gap-1"
                      >
                        <span
                          className={cn(
                            "relative w-full aspect-[1/0.9] rounded-[10px] overflow-hidden flex flex-col items-center justify-center ring-1 ring-black/10 transition-shadow",
                            active && "ring-2 ring-[var(--reader-fg)]",
                          )}
                          style={{ background: theme.bg, color: theme.fg }}
                        >
                          {theme.id === "auto" && (
                            <span
                              className="absolute inset-y-0 right-0 w-1/2"
                              style={{ background: "#201d1b" }}
                            />
                          )}
                          <span
                            className="relative font-serif text-[15px] leading-none"
                            style={
                              theme.id === "auto"
                                ? {
                                    mixBlendMode: "difference",
                                    color: "#faf8f5",
                                  }
                                : undefined
                            }
                          >
                            Aa
                          </span>
                          <span
                            className="relative mt-1 h-[2px] w-4 rounded-full"
                            style={{ background: pen }}
                          />
                        </span>
                        <span
                          className={cn(
                            "text-[11px]",
                            active
                              ? "font-semibold text-[var(--reader-fg)]"
                              : "text-[var(--reader-muted)]",
                          )}
                        >
                          {theme.label}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <SwatchRow
                label="Pen"
                shape="dot"
                value={settings.pen}
                options={PENS}
                onChange={(pen) => update({ pen })}
              />
              <SwatchRow
                label="Highlighter"
                shape="marker"
                value={settings.highlighter}
                options={HIGHLIGHTERS}
                onChange={(highlighter) => update({ highlighter })}
              />

              <div className="h-px bg-[var(--reader-border)]" />

              <div className="grid grid-cols-2 gap-2">
                <ToggleTile
                  icon={<Pilcrow size={15} />}
                  label="Numbers"
                  active={settings.numbers}
                  onClick={() => update({ numbers: !settings.numbers })}
                />
                <ToggleTile
                  icon={<MapIcon size={15} />}
                  label="Map"
                  active={settings.map}
                  onClick={() => update({ map: !settings.map })}
                />
                <ToggleTile
                  icon={<ScanEye size={15} />}
                  label="Focus"
                  active={settings.focus}
                  onClick={() => update({ focus: !settings.focus })}
                />
                <ToggleTile
                  icon={<Headphones size={15} />}
                  label="Listen"
                  active={listening}
                  onClick={onToggleListen}
                />
              </div>
            </div>
          )}

          {tab === "text" && (
            <div className="mt-4 space-y-3.5">
              <div>
                <p className="mb-2 text-[12.5px] text-[var(--reader-muted)]">
                  Typeface
                </p>
                <div className="grid grid-cols-4 gap-2">
                  {TYPEFACES.map((face) => {
                    const active = settings.typeface === face.id;
                    return (
                      <button
                        key={face.id}
                        type="button"
                        aria-pressed={active}
                        onClick={() => update({ typeface: face.id })}
                        className={cn(
                          "flex flex-col items-center justify-center h-[62px] rounded-xl border transition-colors",
                          active
                            ? "border-[var(--reader-fg)] bg-[var(--reader-chip)]"
                            : "border-[var(--reader-border)] hover:bg-[var(--reader-chip)]",
                        )}
                      >
                        <span
                          className="text-[22px] leading-none"
                          style={{ fontFamily: TYPEFACE_FAMILIES[face.id] }}
                        >
                          Ag
                        </span>
                        <span
                          className={cn(
                            "mt-1 text-[10.5px]",
                            active
                              ? "font-semibold text-[var(--reader-fg)]"
                              : "text-[var(--reader-muted)]",
                          )}
                        >
                          {face.label}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <Row label="Size">
                <button
                  type="button"
                  aria-label="Smaller text"
                  onClick={() =>
                    update({
                      size: Math.max(SIZE_RANGE.min, settings.size - 1),
                    })
                  }
                  className="w-6 text-[var(--reader-muted)] hover:text-[var(--reader-fg)]"
                >
                  −
                </button>
                <input
                  type="range"
                  min={SIZE_RANGE.min}
                  max={SIZE_RANGE.max}
                  value={settings.size}
                  onChange={(e) => update({ size: Number(e.target.value) })}
                  aria-label="Text size"
                  className="reader-range flex-1"
                />
                <button
                  type="button"
                  aria-label="Larger text"
                  onClick={() =>
                    update({
                      size: Math.min(SIZE_RANGE.max, settings.size + 1),
                    })
                  }
                  className="w-6 text-[var(--reader-muted)] hover:text-[var(--reader-fg)]"
                >
                  +
                </button>
                <span className="w-6 text-right font-mono text-[11px] tabular-nums text-[var(--reader-muted)]">
                  {settings.size}
                </span>
              </Row>
              <Row label="Spacing">
                <Segmented
                  value={settings.spacing}
                  onChange={(spacing) => update({ spacing })}
                  options={[
                    { id: "snug", label: "Snug" },
                    { id: "even", label: "Even" },
                    { id: "airy", label: "Airy" },
                  ]}
                />
              </Row>
              <Row label="Width">
                <Segmented
                  value={settings.width}
                  onChange={(width) => update({ width })}
                  options={[
                    { id: "narrow", label: "Narrow" },
                    { id: "even", label: "Even" },
                    { id: "wide", label: "Wide" },
                  ]}
                />
              </Row>
              <Row label="Align">
                <Segmented
                  value={settings.align}
                  onChange={(align) => update({ align })}
                  options={[
                    {
                      id: "left",
                      label: (
                        <>
                          <AlignLeft size={13} /> Left
                        </>
                      ),
                    },
                    {
                      id: "justify",
                      label: (
                        <>
                          <AlignJustify size={13} /> Justified
                        </>
                      ),
                    },
                  ]}
                />
              </Row>
              <Row label="Paragraphs">
                <Segmented
                  value={settings.paragraphs}
                  onChange={(paragraphs) => update({ paragraphs })}
                  options={[
                    { id: "spaced", label: "Spaced" },
                    { id: "indented", label: "Indented" },
                  ]}
                />
              </Row>
              <div>
                <p className="mb-2 text-[12.5px] text-[var(--reader-muted)]">
                  Drop cap
                </p>
                <div className="grid grid-cols-4 gap-2">
                  {DROP_CAP_OPTIONS.map((option) => {
                    const active = settings.dropCap === option.id;
                    return (
                      <button
                        key={option.id}
                        type="button"
                        aria-pressed={active}
                        onClick={() => update({ dropCap: option.id })}
                        className={cn(
                          "flex flex-col items-center justify-center h-[62px] rounded-xl border transition-colors outline-none focus-visible:ring-1 focus-visible:ring-[var(--reader-focus)]",
                          active
                            ? "border-[var(--reader-fg)] bg-[var(--reader-chip)]"
                            : "border-[var(--reader-border)] hover:bg-[var(--reader-chip)]",
                        )}
                      >
                        <span
                          className={cn(
                            "text-[24px] leading-none",
                            option.family
                              ? "text-[var(--ink)]"
                              : "text-[var(--reader-muted)]",
                          )}
                          style={{
                            fontFamily:
                              option.id === "text"
                                ? TYPEFACE_FAMILIES[settings.typeface]
                                : option.family,
                          }}
                        >
                          {option.family ? "A" : "–"}
                        </span>
                        <span
                          className={cn(
                            "mt-1 text-[10.5px]",
                            active
                              ? "font-semibold text-[var(--reader-fg)]"
                              : "text-[var(--reader-muted)]",
                          )}
                        >
                          {option.label}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
              {settings.dropCap !== "off" && (
                <Row label="Lines">
                  <Segmented
                    value={String(settings.dropCapLines)}
                    onChange={(lines) =>
                      update({ dropCapLines: Number(lines) })
                    }
                    options={DROP_CAP_LINES.map((n) => ({
                      id: String(n),
                      label: String(n),
                    }))}
                  />
                </Row>
              )}
              <button
                type="button"
                onClick={resetText}
                className="flex items-center gap-1.5 pt-1 text-[12px] text-[var(--reader-muted)] hover:text-[var(--reader-fg)]"
              >
                <RotateCcw size={12} /> Reset text settings
              </button>
            </div>
          )}

          {tab === "answers" && (
            <div className="mt-4 space-y-3.5">
              <p className="text-[12.5px] leading-relaxed text-[var(--reader-muted)]">
                How Ask, Explain, Simplify and Define answer when you highlight
                a passage.
              </p>
              <Row label="Length">
                <Segmented
                  value={settings.answerLength}
                  onChange={(answerLength) => update({ answerLength })}
                  options={[
                    { id: "brief", label: "Brief" },
                    { id: "standard", label: "Standard" },
                    { id: "detailed", label: "Detailed" },
                  ]}
                />
              </Row>
              <Row label="Level">
                <Segmented
                  value={settings.answerLevel}
                  onChange={(answerLevel) => update({ answerLevel })}
                  options={[
                    { id: "plain", label: "Plain" },
                    { id: "balanced", label: "Balanced" },
                    { id: "expert", label: "Expert" },
                  ]}
                />
              </Row>
              <Row label="Default">
                <Segmented
                  value={settings.answerDepth}
                  onChange={(answerDepth) => update({ answerDepth })}
                  options={[
                    { id: "quick", label: "Quick" },
                    { id: "deep", label: "Deep" },
                  ]}
                />
              </Row>

              <Row label="Web search">
                <Segmented
                  value={settings.webSearch}
                  onChange={(webSearch) => update({ webSearch })}
                  options={[
                    { id: "off", label: "Off" },
                    { id: "deep", label: "Deep" },
                    { id: "always", label: "Always" },
                  ]}
                />
              </Row>
              <p className="pl-[88px] text-[11.5px] leading-relaxed text-[var(--reader-muted)]">
                When on, the model searches only if the article and its own
                knowledge aren't enough, and cites what it finds. About $0.007
                per search.
              </p>

              <div className="h-px bg-[var(--reader-border)]" />
              <p className="text-[12.5px] text-[var(--reader-muted)]">Models</p>
              {models && !models.available.length ? (
                <p className="text-[12.5px] leading-relaxed text-[var(--reader-fg-soft)]">
                  Answers and marginalia need an AI provider key.{" "}
                  <Link
                    href="/account"
                    onClick={() => setOpen(false)}
                    className="inline-flex min-h-11 items-center underline underline-offset-2 sm:min-h-0"
                  >
                    Add a key in Your account
                  </Link>
                </p>
              ) : (
                <>
                  <ModelRow
                    label="Quick"
                    modelRole="quick"
                    models={models}
                    onChange={setModel}
                  />
                  <ModelRow
                    label="Deep"
                    modelRole="deep"
                    models={models}
                    onChange={setModel}
                  />
                  <ModelRow
                    label="Marginalia"
                    modelRole="annotations"
                    models={models}
                    onChange={setModel}
                  />
                  <p className="text-[11.5px] leading-relaxed text-[var(--reader-muted)]">
                    Marginalia writes the automatic notes, the end-of-article
                    reflection and summaries. Changes apply to the next one it
                    writes. If a model fails, another of your models steps in.
                    The list comes from the keys in Your account.
                  </p>
                </>
              )}
              <div className="h-px bg-[var(--reader-border)]" />
              <p className="text-[11.5px] leading-relaxed text-[var(--reader-muted)]">
                Shortcuts: select text, then press{" "}
                <kbd className="reader-kbd">A</kbd> to ask,{" "}
                <kbd className="reader-kbd">E</kbd> to explain or{" "}
                <kbd className="reader-kbd">S</kbd> to simplify and{" "}
                <kbd className="reader-kbd">D</kbd> to define in context.
              </p>
            </div>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
