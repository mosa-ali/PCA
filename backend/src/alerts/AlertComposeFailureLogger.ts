/**
 * FABLE-A013: `runtimeSyncRoutes.ts`'s `emitProtectionDegradedAlert` and
 * `InvitationService.emitAlert` both swallow a failed alert-emission path
 * with a best-effort `catch {}`. This logger intentionally records only a
 * bounded event name plus structured identifiers (for example family and
 * device IDs) and a fixed failure category. Dependency exceptions may contain
 * decrypted content, SQL parameters, ciphertext or keys; their text, custom
 * properties and string conversion must never cross this logging boundary.
 *
 * The exact failure source is not fixed to a single static composer string:
 * it may arise from the alert composer itself or from an upstream resolve/
 * persistence step before composition finishes (for example a resolver or
 * persistence failure that still triggers the same best-effort fallback).
 * The bounded category describes a failed alert delivery, rather than claiming
 * which dependency failed. The calling event identifies the operation.
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

export function alertComposeFailureMessage(_error: unknown): 'ALERT_DELIVERY_FAILED' {
  // Retain the public helper name for existing callers. Do not inspect an
  // untrusted thrown value: even message getters/stringification can execute
  // arbitrary code or disclose protected payloads.
  return 'ALERT_DELIVERY_FAILED';
}
