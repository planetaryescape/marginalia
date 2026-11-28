/** Which wait never finished before the reader could open. */
export type StartupPhase = "session" | "reader" | "onboarding";

/**
 * The only facts a stalled start reports: what was awaited and how the
 * library connection looked. No URLs, tokens, identities or server messages,
 * so the record is safe to keep in a browser console.
 */
export interface StartupStall {
  readonly phase: StartupPhase;
  readonly waitedMs: number;
  readonly connection: {
    readonly isWebSocketConnected: boolean;
    readonly hasEverConnected: boolean;
    readonly connectionCount: number;
    readonly connectionRetries: number;
  };
}

export type StartupStallSink = (message: string, stall: StartupStall) => void;

export const STARTUP_STALL_MESSAGE = "Marginalia startup unavailable";

/**
 * Reports each phase's stall once per page load, however many times the
 * reader retries or the screen remounts. True when this call reported.
 */
export function createStartupReporter(
  sink: StartupStallSink,
): (stall: StartupStall) => boolean {
  const reported = new Set<StartupPhase>();
  return (stall) => {
    if (reported.has(stall.phase)) return false;
    reported.add(stall.phase);
    sink(STARTUP_STALL_MESSAGE, {
      phase: stall.phase,
      waitedMs: stall.waitedMs,
      connection: {
        isWebSocketConnected: stall.connection.isWebSocketConnected,
        hasEverConnected: stall.connection.hasEverConnected,
        connectionCount: stall.connection.connectionCount,
        connectionRetries: stall.connection.connectionRetries,
      },
    });
    return true;
  };
}

/** The browser console is the only private diagnostic channel this app has. */
export const reportStartupStall = createStartupReporter((message, stall) =>
  console.error(message, stall),
);
