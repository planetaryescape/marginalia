"use client";
import { useConvexConnectionState } from "convex/react";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { FAILURE_COPY } from "@/lib/failure-copy";
import {
  reportStartupStall,
  type StartupPhase,
  type StartupStall,
} from "@/lib/startup-diagnostics";

/** How long opening may take before a way to try again appears. */
export const SLOW_MS = 10_000;
/** How long opening may take before the reader is told it isn't available. */
export const UNAVAILABLE_MS = 30_000;

type StartupStage = "opening" | "slow" | "unavailable";

const StartupReporter =
  createContext<(stall: StartupStall) => boolean>(reportStartupStall);

/** Where stalled starts are reported; the console unless a caller supplies one. */
export const StartupReporterProvider = StartupReporter.Provider;

/**
 * Shows `opening` while the reader waits for the library, then, once the wait
 * has gone on too long, a plain unavailable screen. Retrying asks again in
 * place and restarts the wait. Unmounting, because the wait ended, is how the
 * reader recovers, so a library that comes back opens without a reload.
 */
export function StartupWait({
  phase,
  onRetry,
  opening,
}: {
  phase: StartupPhase;
  onRetry: () => void;
  opening: (slow: boolean) => ReactNode;
}) {
  const report = useContext(StartupReporter);
  const connection = useConvexConnectionState();
  const [stage, setStage] = useState<StartupStage>("opening");
  const [attempt, setAttempt] = useState(0);
  // The latest phase and connection, read when the wait runs out
  const latest = useRef({ phase, connection });
  latest.current = { phase, connection };
  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt only restarts the wait
  useEffect(() => {
    setStage("opening");
    const slow = setTimeout(() => setStage("slow"), SLOW_MS);
    const unavailable = setTimeout(() => {
      setStage("unavailable");
      const { phase, connection } = latest.current;
      report({
        phase,
        waitedMs: UNAVAILABLE_MS,
        connection: {
          isWebSocketConnected: connection.isWebSocketConnected,
          hasEverConnected: connection.hasEverConnected,
          connectionCount: connection.connectionCount,
          connectionRetries: connection.connectionRetries,
        },
      });
    }, UNAVAILABLE_MS);
    return () => {
      clearTimeout(slow);
      clearTimeout(unavailable);
    };
  }, [attempt, report]);
  const retry = useCallback(() => {
    onRetry();
    setAttempt((count) => count + 1);
  }, [onRetry]);
  if (stage === "unavailable") return <StartupUnavailable onRetry={retry} />;
  return opening(stage === "slow");
}

function StartupUnavailable({ onRetry }: { onRetry: () => void }) {
  return (
    <main className="auth-screen">
      <div className="w-full max-w-sm" role="alert">
        <p className="font-serif text-2xl mb-10">Marginalia</p>
        <h1 className="font-serif text-3xl mb-3">
          Your reader isn't available right now
        </h1>
        <p className="text-sm text-[var(--reader-muted)] mb-7">
          {FAILURE_COPY.unreachable}
        </p>
        <button type="button" className="app-button w-full" onClick={onRetry}>
          Try again
        </button>
      </div>
    </main>
  );
}
