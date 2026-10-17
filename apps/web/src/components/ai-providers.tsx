"use client";
import { api } from "@marginalia/backend/convex/_generated/api";
import { useAction, useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { useEffect, useId, useState } from "react";
import { FAILURE_COPY, failureSentence } from "@/lib/failure-copy";
import { ConfirmAction } from "./settings-confirm";
import {
  fieldControl,
  primaryControl,
  quietControl,
  textControl,
} from "./settings-controls";
import { SettingsSection } from "./settings-section";

type Provider = "openrouter" | "openai" | "anthropic";

const PROVIDERS: { id: Provider; name: string; hint: string }[] = [
  {
    id: "openrouter",
    name: "OpenRouter",
    hint: "Many models through one key, including search.",
  },
  { id: "openai", name: "OpenAI", hint: "GPT models and search." },
  { id: "anthropic", name: "Anthropic", hint: "Claude models." },
];

/** Only one remove or disconnect is open at a time; touching another control closes it. */
type Confirming = string | null;

function ProviderRow({
  provider,
  saved,
  confirming,
  setConfirming,
}: {
  provider: (typeof PROVIDERS)[number];
  saved: { last4: string; validatedAt: number } | undefined;
  confirming: Confirming;
  setConfirming: (next: Confirming) => void;
}) {
  const id = useId();
  const save = useAction(api.providerCredentials.save);
  const remove = useMutation(api.providerCredentials.remove);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const confirmKey = `provider:${provider.id}`;

  async function submit() {
    setConfirming(null);
    setBusy(true);
    setError("");
    setStatus("");
    try {
      await save({ provider: provider.id, apiKey: key });
      setStatus(`${provider.name} key saved.`);
    } catch (e) {
      setError(failureSentence(e, FAILURE_COPY.save));
    } finally {
      // The full key never stays in the page once it has been sent
      setKey("");
      setBusy(false);
    }
  }

  return (
    <div className="border-b border-[var(--reader-border)] py-3">
      {saved ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm">
            <span className="font-medium">{provider.name}</span>
            <span className="text-[var(--reader-muted)]">
              {" "}
              · Connected, key ending {saved.last4}
            </span>
          </div>
          <ConfirmAction
            label="Remove"
            ariaLabel={`Remove ${provider.name} key`}
            question={`Remove your ${provider.name} key? Features that need it stop until you add a key again.`}
            confirmLabel="Remove"
            busy={busy}
            open={confirming === confirmKey}
            onOpenChange={(open) => setConfirming(open ? confirmKey : null)}
            onConfirm={() => {
              setBusy(true);
              setStatus("");
              remove({ provider: provider.id })
                .then(() => setStatus(`${provider.name} key removed.`))
                .catch(() =>
                  setError(`Couldn't remove the ${provider.name} key.`),
                )
                .finally(() => setBusy(false));
            }}
          />
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (key.trim()) void submit();
          }}
        >
          <label htmlFor={id} className="block text-sm">
            <span className="font-medium">{provider.name}</span>
            <span className="text-[var(--reader-muted)]">
              {" "}
              · {provider.hint}
            </span>
          </label>
          <div className="mt-2 flex flex-wrap gap-2">
            <input
              id={id}
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder={`${provider.name} API key`}
              className={`${fieldControl} max-w-sm flex-1`}
              value={key}
              disabled={busy}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? `${id}-error` : undefined}
              onChange={(e) => setKey(e.target.value)}
            />
            <button
              type="submit"
              className={quietControl}
              disabled={busy || !key.trim()}
            >
              {busy ? "Checking…" : "Save"}
            </button>
          </div>
        </form>
      )}
      {error && (
        <p
          id={`${id}-error`}
          role="alert"
          className="mt-2 text-sm text-[var(--danger)]"
        >
          {error}
        </p>
      )}
      {status && (
        <p role="status" className="mt-2 text-sm">
          {status}
        </p>
      )}
    </div>
  );
}

const CHATGPT_USAGE_URL = "https://chatgpt.com/settings/usage";

const CHATGPT_RESULTS: Record<string, string> = {
  connected: "ChatGPT connected.",
  plan_disabled:
    "ChatGPT connected, but plan usage wasn't allowed, so your plan can't answer here yet.",
  denied: "ChatGPT sign-in was cancelled.",
  expired: "That ChatGPT sign-in expired. Try again.",
  failed: "Couldn't connect ChatGPT. Try again.",
};

/** Shown only when the server offers Sign in with ChatGPT. */
function ChatGPTPlan({
  confirming,
  setConfirming,
}: {
  confirming: Confirming;
  setConfirming: (next: Confirming) => void;
}) {
  const state = useQuery(api.chatgpt.connection, {});
  const start = useAction(api.chatgpt.start);
  const disconnect = useAction(api.chatgpt.disconnect);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  // The sign-in callback returns here with ?chatgpt=<result>
  useEffect(() => {
    const url = new URL(window.location.href);
    const result = url.searchParams.get("chatgpt");
    if (!result) return;
    const message = CHATGPT_RESULTS[result];
    if (message) (result === "connected" ? setStatus : setError)(message);
    url.searchParams.delete("chatgpt");
    window.history.replaceState(null, "", url.toString());
  }, []);

  if (!state) return null;
  const connection = state.connection;

  async function connect(consent = false) {
    setConfirming(null);
    setBusy(true);
    setError("");
    setStatus("");
    try {
      const { url } = await start(consent ? { consent: true } : {});
      window.location.assign(url);
    } catch (e) {
      setError(
        e instanceof ConvexError && typeof e.data === "string"
          ? e.data
          : "Couldn't start ChatGPT sign-in. Try again.",
      );
      setBusy(false);
    }
  }

  return (
    <div className="border-b border-[var(--reader-border)] py-3">
      {connection ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm">
              <span className="font-medium">ChatGPT plan</span>
              <span className="text-[var(--reader-muted)]">
                {" "}
                ·{" "}
                {connection.status === "connected"
                  ? "Connected"
                  : connection.status === "reconnect"
                    ? "Reconnect needed"
                    : "Plan usage not enabled"}
                {connection.email ? ` as ${connection.email}` : ""}
              </span>
            </div>
            <ConfirmAction
              label="Disconnect"
              question="Disconnect ChatGPT? Features using your plan switch to your API keys, if you have any."
              confirmLabel="Disconnect"
              busy={busy}
              open={confirming === "chatgpt"}
              onOpenChange={(open) => setConfirming(open ? "chatgpt" : null)}
              onConfirm={() => {
                setBusy(true);
                setError("");
                setStatus("");
                disconnect({})
                  .then(({ revoked }) =>
                    revoked
                      ? setStatus("ChatGPT disconnected.")
                      : setError(
                          "Disconnected here, but ChatGPT didn't confirm. Also disconnect this reader in ChatGPT Settings.",
                        ),
                  )
                  .catch(() => setError("Couldn't disconnect ChatGPT."))
                  .finally(() => setBusy(false));
              }}
            />
          </div>
          {connection.message && (
            <p className="mt-2 text-sm">{connection.message}</p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
            {connection.status === "reconnect" && (
              <button
                className={primaryControl}
                disabled={busy}
                onClick={() => void connect()}
              >
                Continue with ChatGPT
              </button>
            )}
            {connection.status === "plan_disabled" && (
              <button
                className={quietControl}
                disabled={busy}
                onClick={() => void connect(true)}
              >
                Allow plan usage
              </button>
            )}
            <a
              href={CHATGPT_USAGE_URL}
              target="_blank"
              rel="noreferrer"
              className={textControl}
            >
              ChatGPT usage
            </a>
          </div>
        </>
      ) : (
        <div>
          <p className="text-sm">
            <span className="font-medium">ChatGPT plan</span>
            <span className="text-[var(--reader-muted)]">
              {" "}
              · Answers, summaries and marginalia from your ChatGPT plan. Search
              still needs an OpenAI or OpenRouter key.
            </span>
          </p>
          <button
            className={`${quietControl} mt-2`}
            disabled={busy}
            onClick={() => void connect()}
          >
            {busy ? "Opening ChatGPT…" : "Continue with ChatGPT"}
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-[var(--danger)]">
          {error}
        </p>
      )}
      {status && (
        <p role="status" className="mt-2 text-sm">
          {status}
        </p>
      )}
    </div>
  );
}

export function AiProviders() {
  const saved = useQuery(api.providerCredentials.list, {});
  const capabilities = useQuery(api.providerCredentials.capabilities, {});
  const [confirming, setConfirming] = useState<Confirming>(null);
  return (
    <SettingsSection
      title="AI providers and models"
      description="Answers, summaries and marginalia use your own key. It's checked with the provider, stored encrypted and never shown again. Search and Ask your library need an OpenAI or OpenRouter key."
    >
      <div>
        {PROVIDERS.map((provider) => (
          <ProviderRow
            key={provider.id}
            provider={provider}
            saved={saved?.find((row) => row.provider === provider.id)}
            confirming={confirming}
            setConfirming={setConfirming}
          />
        ))}
        {capabilities?.chatgptAvailable && (
          <ChatGPTPlan confirming={confirming} setConfirming={setConfirming} />
        )}
      </div>
      <CatchUpStatus />
    </SettingsSection>
  );
}

function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`;
}

/** While work skipped for lack of a key is being redone in the background. */
function CatchUpStatus() {
  const progress = useQuery(api.catchUp.status, {});
  if (!progress) return null;
  const done = [
    progress.itemsQueued
      ? `${plural(progress.itemsQueued, "item", "items")} indexed for search`
      : "",
    progress.articlesQueued
      ? `${plural(progress.articlesQueued, "article", "articles")} sent for marginalia`
      : "",
  ].filter(Boolean);
  return (
    <p role="status" className="text-[13px] text-[var(--reader-muted)]">
      Catching up on what was saved without a key
      {done.length ? `: ${done.join(" and ")} so far.` : "…"}
    </p>
  );
}
