import type { MfaDecryptionKeySource } from './totp.js';

/**
 * Bounded stage diagnostics for the Platform Admin activation / MFA flow.
 *
 * WHY THIS EXISTS
 * ---------------
 * Activation failures were indistinguishable from the outside. `start`,
 * `complete` and the key-ring each threw the SAME `PlatformAdminActivationError`
 * with no code, so an invalid token, an expired link, an already-started
 * enrollment, a wrong code, a misconfigured key ring and a refused write were
 * all one observation: "activation failed". Recovering from a real production
 * incident in this area required reading the database by hand.
 *
 * WHY THE DETAIL SHAPE IS CLOSED RATHER THAN A FREE-FORM MAP
 * ---------------------------------------------------------
 * This flow handles the highest-value secrets in the product: the activation
 * token, the TOTP secret, the otpauth URI, the MFA encryption keys, the
 * operator's password and the submitted code. A logger that accepts
 * `Record<string, unknown>` can only be kept safe by everyone remembering, at
 * every call site, forever, not to pass one of those -- and one forgetful edit
 * writes a TOTP secret to production logs, where it becomes a permanent
 * credential for that account.
 *
 * So `ActivationDiagnosticDetail` declares the ONLY fields a diagnostic may
 * carry, and every one of them is already non-secret: a reason code from a
 * closed set, the NAME of a key generation (never the key), and a boolean.
 * There is deliberately no field a token, secret, URI, key, password, code,
 * ciphertext or plaintext could be passed through. Passing one is not merely
 * discouraged -- it is not expressible.
 *
 * INVARIANTS
 * ----------
 *  - Diagnostics NEVER alter an authentication or activation outcome. Every
 *    call site reports and then re-throws the original error, or reports and
 *    continues; nothing here returns a decision, and nothing here is awaited
 *    in a way that could fail a request. The sink swallows its own failures.
 *  - Stable stage/reason identifiers, never human-readable messages, so the
 *    output is greppable and does not vary with locale or wording.
 *  - User-facing copy is NOT taken from here. EN/AR strings stay in the locale
 *    files and remain generic; this is an operator-facing internal channel.
 */
export const ACTIVATION_STAGES = [
  'ACTIVATION_TOKEN_VALIDATION',
  'ACTIVATION_START',
  'MFA_SECRET_DECRYPT',
  'MFA_CODE_VERIFICATION',
  'MFA_READ_REPAIR',
  'ACTIVATION_COMPLETE',
  'MFA_PERSISTENCE',
  'MFA_KEYRING_CONFIGURATION',
] as const;

export type ActivationStage = (typeof ACTIVATION_STAGES)[number];

export const ACTIVATION_OUTCOMES = ['OK', 'REJECTED', 'FAILED'] as const;

/**
 * OK       -- the stage did what it was asked to do.
 * REJECTED -- a legitimate refusal of the request. Benign and expected. Used for
 *             both bad input and a lost race, because a refusal is not a fault.
 * FAILED   -- an OBSERVED exception: something threw and we caught it.
 *
 * FAILED IS RESERVED FOR A CAUGHT THROW and must not be used for a `false` or
 * `null` return. A boolean cannot say why it is false -- for example
 * `beginMfa` returns null for a concurrent start, an expired/revoked token or an
 * inactive account, and `complete` returns false for a stale token, a concurrent
 * completion or a guarded UPDATE that matched nothing. Labelling those FAILED, or
 * naming one of the possible causes as if it were established, sends an operator
 * to a recovery action the evidence does not support. Where a cause genuinely
 * cannot be distinguished, use a NEUTRAL reason (`*_NOT_APPLIED`,
 * `ENROLLMENT_STATE_CHANGED`) that says what is true without inventing why.
 */
export type ActivationOutcome = (typeof ACTIVATION_OUTCOMES)[number];

export const ACTIVATION_REASONS = [
  'INVALID_TOKEN_SHAPE',
  'NO_USABLE_TOKEN',
  'ACCOUNT_NOT_ACTIVE',
  'MFA_NOT_PENDING_SETUP',
  'MFA_ALREADY_STARTED',
  'KEYRING_MISCONFIGURED',
  'NO_PERMITTED_KEY',
  'INVALID_CODE',
  'ENROLLMENT_STATE_CHANGED',
  'COMPLETION_NOT_APPLIED',
  'REPAIR_NOT_APPLIED',
] as const;

export type ActivationReason = (typeof ACTIVATION_REASONS)[number];

/** The only fields a diagnostic may carry. Each is non-secret by construction. */
export interface ActivationDiagnosticDetail {
  reason?: ActivationReason;
  /** Which bounded key generation authenticated a decrypt: a NAME, never a key. */
  keySource?: MfaDecryptionKeySource;
  /** Whether a legacy-sealed row was re-sealed under the active key. */
  repaired?: boolean;
}

export interface ActivationDiagnostics {
  stage(stage: ActivationStage, outcome: ActivationOutcome, detail?: ActivationDiagnosticDetail): void;
}

/**
 * Discards everything, and is the CONSTRUCTOR DEFAULT.
 *
 * Observability is opt-in at the composition root (main.ts injects
 * CONSOLE_ACTIVATION_DIAGNOSTICS explicitly). Defaulting to the console sink
 * instead would make every construction site -- including every test that never
 * asked for diagnostics -- emit operational log lines as a side effect, and would
 * leave the choice invisible at the point where it is actually made.
 */
export const NOOP_ACTIVATION_DIAGNOSTICS: ActivationDiagnostics = {
  stage() {
    /* intentionally empty */
  },
};

/**
 * Emits one bounded JSON line per stage, mirroring the established
 * `CONSOLE_ALERT_COMPOSE_FAILURE_LOGGER` convention (a structured event name
 * plus bounded fields, never a raw error object or payload).
 *
 * A sink failure (for example a closed stdout in a container teardown) is
 * swallowed: a diagnostic that cannot be written must never become the reason
 * an activation fails.
 */
export const CONSOLE_ACTIVATION_DIAGNOSTICS: ActivationDiagnostics = {
  stage(stage, outcome, detail) {
    try {
      // eslint-disable-next-line no-console -- intentional bounded structured operational log; the detail shape cannot carry secret material.
      console.warn(JSON.stringify({ event: 'PLATFORM_ADMIN_ACTIVATION', stage, outcome, ...detail }));
    } catch {
      /* a diagnostic must never fail the operation it describes */
    }
  },
};
