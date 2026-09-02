/**
 * PCA-RUNTIME-SHUTDOWN-1: process-lifecycle shutdown for the API server.
 *
 * WHY THIS EXISTS (this is a correctness fix, not a nicety).
 *
 * Node's default SIGTERM/SIGINT disposition terminates the process. The
 * moment ANY listener is attached to those signals that default is
 * REPLACED, not augmented -- so a handler that only stops a timer leaves a
 * process that cannot be stopped by SIGTERM at all. An orchestrator then
 * waits out its whole termination grace period and SIGKILLs, which is
 * strictly worse than never having installed a handler: SIGKILL cannot be
 * trapped, so in-flight HTTP requests and open MySQL transactions are
 * severed mid-flight instead of drained. This fires on every single deploy.
 *
 * The contract this module implements:
 *  - stop background work, drain the HTTP server, release the DB pool, and
 *    THEN exit -- the process must actually terminate.
 *  - IDEMPOTENT: a second (or third) signal while a shutdown is already in
 *    flight is recorded and ignored. It must never re-enter the sequence,
 *    which would double-close the pool and double-close the server.
 *  - BOUNDED: a stalled connection or a request that never finishes must not
 *    hold the process open forever. Past `timeoutMs` the process exits
 *    non-zero regardless, so the orchestrator's own SIGKILL is never the
 *    thing that ends us.
 *  - HONEST EXIT CODE: 0 only when every step actually completed. A failed
 *    close or a timeout exits non-zero so the failure is visible in the
 *    orchestrator's own event log rather than silently reported as clean.
 *
 * Everything the sequence touches is injected so the behaviour above is
 * unit-testable without booting the real server or a real database.
 */

/** Signals treated as "terminate this process gracefully". */
export const DEFAULT_SHUTDOWN_SIGNALS = ['SIGTERM', 'SIGINT'] as const;

/**
 * Upper bound on the whole drain. Deliberately shorter than a typical
 * orchestrator termination grace period (Kubernetes' default is 30s) so
 * that this process, not the platform's SIGKILL, is what ends the run.
 */
export const DEFAULT_SHUTDOWN_TIMEOUT_MS = 10_000;

export interface ShutdownLogger {
  info(event: string, detail?: Record<string, unknown>): void;
  warn(event: string, detail?: Record<string, unknown>): void;
}

export interface GracefulShutdownOptions {
  /**
   * Stop periodic/background work (interval timers). Called first and
   * synchronously so no new work starts while the drain runs. A throw here
   * is logged and does not abort the rest of the sequence.
   */
  readonly stopBackgroundWork: () => void;
  /** Stop accepting connections and drain in-flight requests (`app.close()`). */
  readonly closeServer: () => Promise<void>;
  /** Release the MySQL connection pool (`closePool()`). */
  readonly closeDatabasePool: () => Promise<void>;
  /** Terminate the process. Injected so tests never actually exit. */
  readonly exit: (code: number) => void;
  readonly log: ShutdownLogger;
  /** Whole-sequence bound. Defaults to {@link DEFAULT_SHUTDOWN_TIMEOUT_MS}. */
  readonly timeoutMs?: number;
}

/** Console-backed logger; only bounded event names and `error.message`. */
export const CONSOLE_SHUTDOWN_LOGGER: ShutdownLogger = {
  info(event, detail) {
    console.log(JSON.stringify({ event, ...detail }));
  },
  warn(event, detail) {
    console.warn(JSON.stringify({ event, ...detail }));
  },
};

/**
 * mysql2 interpolates parameters client-side and hangs the fully-bound
 * statement off `err.sql`, so a raw error object printed at shutdown would
 * emit real family rows into the operational log. Only ever log the
 * message, exactly like the commercial-maintenance logger in main.ts.
 */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export type ShutdownHandler = (signal: string) => Promise<void>;

/**
 * Builds the idempotent, bounded shutdown handler. The returned function is
 * safe to attach to as many signals as you like: the FIRST invocation owns
 * the sequence and every later one resolves against that same run.
 */
export function createGracefulShutdownHandler(options: GracefulShutdownOptions): ShutdownHandler {
  const timeoutMs = options.timeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS;
  let inFlight: Promise<void> | null = null;

  async function run(signal: string): Promise<void> {
    options.log.info('shutdown.started', { signal, timeoutMs });

    let clean = true;
    try {
      options.stopBackgroundWork();
    } catch (error) {
      clean = false;
      options.log.warn('shutdown.background_work_stop_failed', { error: errorMessage(error) });
    }

    const drain = (async (): Promise<'DRAINED'> => {
      try {
        await options.closeServer();
        options.log.info('shutdown.server_closed');
      } catch (error) {
        clean = false;
        options.log.warn('shutdown.server_close_failed', { error: errorMessage(error) });
      }
      // The pool is released AFTER the server drains: an in-flight request
      // still holds a connection, and tearing the pool out from under it
      // would fail the very request we are trying to let finish.
      try {
        await options.closeDatabasePool();
        options.log.info('shutdown.database_pool_closed');
      } catch (error) {
        clean = false;
        options.log.warn('shutdown.database_pool_close_failed', { error: errorMessage(error) });
      }
      return 'DRAINED';
    })();

    let timer: NodeJS.Timeout | undefined;
    const deadline = new Promise<'TIMED_OUT'>((resolve) => {
      timer = setTimeout(() => resolve('TIMED_OUT'), timeoutMs);
    });

    let outcome: 'DRAINED' | 'TIMED_OUT';
    try {
      outcome = await Promise.race([drain, deadline]);
    } finally {
      // Always cleared, on both branches -- an outstanding timer would
      // itself keep the event loop alive and defeat the point of the bound.
      if (timer !== undefined) clearTimeout(timer);
    }

    if (outcome === 'TIMED_OUT') {
      clean = false;
      options.log.warn('shutdown.timed_out', { signal, timeoutMs });
    }

    const code = clean ? 0 : 1;
    options.log.info('shutdown.exiting', { signal, code });
    options.exit(code);
  }

  return (signal: string): Promise<void> => {
    if (inFlight) {
      // Not an error: orchestrators and terminals both re-send. Recorded so
      // the operational log shows it, then folded onto the in-flight run.
      options.log.info('shutdown.signal_ignored_already_shutting_down', { signal });
      return inFlight;
    }
    inFlight = run(signal);
    return inFlight;
  };
}

/** Minimal surface of `process` this module needs -- injectable for tests. */
export interface SignalTarget {
  on(signal: string, listener: () => void): unknown;
}

/**
 * Attaches `handler` to each signal. `on`, not `once`, on purpose: with
 * `once` a repeated SIGTERM would fall through to Node's default and kill
 * the process mid-drain, which is the exact outcome this module exists to
 * prevent. The handler's own in-flight guard provides the idempotency.
 */
export function registerGracefulShutdown(
  handler: ShutdownHandler,
  target: SignalTarget = process,
  signals: readonly string[] = DEFAULT_SHUTDOWN_SIGNALS,
): void {
  for (const signal of signals) {
    target.on(signal, () => {
      void handler(signal);
    });
  }
}
