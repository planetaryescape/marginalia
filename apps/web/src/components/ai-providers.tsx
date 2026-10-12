"use client";
import { api } from "@marginalia/backend/convex/_generated/api";
import { useAction, useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { KeyRound } from "lucide-react";
import { useId, useState } from "react";

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

function errorMessage(error: unknown) {
  if (error instanceof ConvexError && typeof error.data === "string")
    return error.data;
  return "Couldn't save that key. Try again.";
}

function ProviderRow({
  provider,
  saved,
}: {
  provider: (typeof PROVIDERS)[number];
  saved: { last4: string; validatedAt: number } | undefined;
}) {
  const id = useId();
  const save = useAction(api.providerCredentials.save);
  const remove = useMutation(api.providerCredentials.remove);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  async function submit() {
    setBusy(true);
    setError("");
    setStatus("");
    try {
      await save({ provider: provider.id, apiKey: key });
      setStatus(`${provider.name} key saved.`);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      // The full key never stays in the page once it has been sent
      setKey("");
      setBusy(false);
    }
  }

  return (
    <div className="py-4 border-b border-[var(--reader-border)]">
      {saved ? (
        <div className="flex items-center justify-between gap-4">
          <div className="text-sm">
            <span className="font-medium">{provider.name}</span>
            <span className="text-[var(--reader-muted)]">
              {" "}
              · Connected, key ending {saved.last4}
            </span>
          </div>
          <button
            className="min-h-11 px-3 text-sm"
            aria-label={`Remove ${provider.name} key`}
            disabled={busy}
            onClick={() => {
              if (
                !confirm(
                  `Remove your ${provider.name} key? Features that need it stop until you add a key again.`,
                )
              )
                return;
              setBusy(true);
              setStatus("");
              remove({ provider: provider.id })
                .then(() => setStatus(`${provider.name} key removed.`))
                .catch(() =>
                  setError(`Couldn't remove the ${provider.name} key.`),
                )
                .finally(() => setBusy(false));
            }}
          >
            Remove
          </button>
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
              className="app-input max-w-sm flex-1"
              value={key}
              disabled={busy}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? `${id}-error` : undefined}
              onChange={(e) => setKey(e.target.value)}
            />
            <button
              type="submit"
              className="app-button secondary"
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
          className="mt-2 text-sm text-annotation-tension"
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

export function AiProviders() {
  const saved = useQuery(api.providerCredentials.list, {});
  const capabilities = useQuery(api.providerCredentials.capabilities, {});
  return (
    <section className="account-section">
      <h2 className="flex items-center gap-2 font-serif text-2xl">
        <KeyRound size={22} />
        AI providers
      </h2>
      <p className="text-sm text-[var(--reader-muted)] my-3">
        Answers, summaries and marginalia use your own key. It's checked with
        the provider, stored encrypted and never shown again. Search and Ask
        your library need an OpenAI or OpenRouter key.
      </p>
      {capabilities?.deploymentFallback && (
        <p className="text-sm my-3">
          You're using the reader's built-in OpenRouter key until you add your
          own.
        </p>
      )}
      {PROVIDERS.map((provider) => (
        <ProviderRow
          key={provider.id}
          provider={provider}
          saved={saved?.find((row) => row.provider === provider.id)}
        />
      ))}
    </section>
  );
}
