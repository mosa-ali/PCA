/**
 * FABLE-A013: `runtimeSyncRoutes.ts`'s `emitProtectionDegradedAlert` and
 * `InvitationService.emitAlert` both swallow a failed alert-emission path
 * with a best-effort `catch {}`. This logger intentionally records only a
 * bounded event name plus structured identifiers (for example family and
 * device IDs) and the surfaced `error.message`; it does not log the raw
 * error object or any request-specific payload details.
 *
 * The exact failure source is not fixed to a single static composer string:
 * it may arise from the alert composer itself or from an upstream resolve/
 * persistence step before composition finishes (for example a resolver or
 * persistence failure that still triggers the same best-effort fallback).
 * The invariant here is operational safety and bounded logging, not a claim
 * that every such failure is literally the same literal string.
 */
export interface AlertComposeFailureLogger {
  warn(event: string, detail: Readonly<Record<string, unknown>>): void;
}

export const CONSOLE_ALERT_COMPOSE_FAILURE_LOGGER: AlertComposeFailureLogger = {
  warn(event, detail) {
    // eslint-disable-next-line no-console -- intentional structured operational log, no alert payload content.
    console.warn(JSON.stringify({ event, ...detail }));
  },
};

export function alertComposeFailureMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
