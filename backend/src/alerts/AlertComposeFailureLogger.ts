/**
 * FABLE-A013: `runtimeSyncRoutes.ts`'s `emitProtectionDegradedAlert` and
 * `InvitationService.emitAlert` both swallow a failed `producer.produce()`
 * call with a bare `catch {}` -- deliberately, since alert emission must
 * stay non-blocking/best-effort (see each call site's own doc comment).
 * Today that failure is ALWAYS the same static, variable-free string from
 * `RejectingOpaqueProtectionAlertComposer` (no reviewed production
 * alert-payload composer exists yet, PCA-DEC-020), so every real-world
 * invocation of this best-effort path is currently silently dropped with
 * no operator-visible signal at all. This gives it one, following the same
 * bounded/console-only convention as `CommercialMaintenanceLogger`
 * (commercialmaintenance/types.ts) and `ShutdownLogger`
 * (runtime/gracefulShutdown.ts): only bounded identifiers and
 * `error.message`, never a raw error object (which could carry
 * request-specific detail future composers might attach).
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
