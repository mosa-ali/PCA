import type { ParentAccountId } from '../types.js';

export type ParentMfaStatus = 'NOT_ENROLLED' | 'ACTIVE';

export interface ParentMfaStateRecord {
  accountId: ParentAccountId;
  status: ParentMfaStatus;
  totpSecretCiphertext: Buffer | null;
  totpSecretNonce: Buffer | null;
  pendingSecretCiphertext: Buffer | null;
  pendingSecretNonce: Buffer | null;
  pendingCreatedAt: Date | null;
  lastAcceptedTotpCounter: number | null;
  graceStartedAt: Date;
  graceExpiresAt: Date;
  enrolledAt: Date | null;
  failedAttemptCount: number;
  failureWindowStartedAt: Date | null;
  lockedUntil: Date | null;
  resetCount: number;
  recoveryHoldStartedAt: Date | null;
  recoveryHoldExpiresAt: Date | null;
}

export type ParentMfaTicketPurpose = 'MFA_SETUP_REQUIRED' | 'MFA_RECOVERY';

/** Only the operations that move money or change a paid commitment. Read-only billing never needs a step-up. */
export const COMMERCIAL_STEP_UP_OPERATIONS = [
  'BILLING_CHECKOUT_CREATE',
  'FAMILY_COMMERCIAL_REQUEST_CREATE',
  'FAMILY_COMMERCIAL_REQUEST_CANCEL',
  'FAMILY_COMMERCIAL_AUTO_RENEW_CANCEL',
  'FAMILY_COMMERCIAL_AUTO_RENEW_RESUME',
] as const;
export type CommercialStepUpOperation = (typeof COMMERCIAL_STEP_UP_OPERATIONS)[number];

export function isCommercialStepUpOperation(value: unknown): value is CommercialStepUpOperation {
  return typeof value === 'string' && (COMMERCIAL_STEP_UP_OPERATIONS as readonly string[]).includes(value);
}

export type ParentSecurityEventType =
  | 'FAMILY_PROVISIONED'
  | 'FIRST_LOGIN'
  | 'MFA_GRACE_STARTED'
  | 'MFA_ENROLLED'
  | 'MFA_LOGIN_FAILED'
  | 'MFA_LOCKED'
  | 'MFA_RECOVERY_REQUESTED'
  | 'MFA_RECOVERY_PENDING'
  | 'MFA_RECOVERY_COMPLETED'
  | 'MFA_RESET'
  | 'STEP_UP_GRANTED'
  | 'STEP_UP_FAILED'
  | 'STEP_UP_CONSUMED';

export interface ParentMfaRecoveryCode {
  codeId: string;
  accountId: ParentAccountId;
  codeHash: string;
  expiresAt: Date;
  consumedAt: Date | null;
  attemptCount: number;
}

export interface FailurePolicy {
  threshold: number;
  windowMs: number;
  lockMs: number;
}

/**
 * Persistence port for Parent TOTP MFA. Every state transition that matters
 * for security is a single guarded statement or a row-locked transaction:
 * grace start is an INSERT that can win only once, activation is a
 * compare-and-swap on the exact pending ciphertext, counter claims only move
 * forward, and tickets/codes/step-up grants are consumed with a CAS on
 * consumed_at IS NULL.
 */
export interface ParentMfaRepository {
  findState(accountId: ParentAccountId): Promise<ParentMfaStateRecord | null>;
  /** Inserts the grace window iff no row exists. Returns true only for the call that created it. */
  startGraceIfAbsent(accountId: ParentAccountId, startedAt: Date, expiresAt: Date): Promise<boolean>;
  savePendingSecret(accountId: ParentAccountId, ciphertext: Buffer, nonce: Buffer, now: Date): Promise<void>;
  /** CAS: promotes exactly the pending secret that was verified, claiming its counter. */
  activatePendingSecret(accountId: ParentAccountId, expectedPendingCiphertext: Buffer, counter: number, now: Date): Promise<boolean>;
  /** Forward-only counter claim for an ACTIVE factor (replay defence). */
  claimTotpCounter(accountId: ParentAccountId, counter: number, now: Date): Promise<boolean>;
  /** Records one failed code under a row lock. Returns whether the factor is now locked. */
  recordFailure(accountId: ParentAccountId, now: Date, policy: FailurePolicy): Promise<{ locked: boolean }>;
  clearFailures(accountId: ParentAccountId, now: Date): Promise<void>;
  /** Recovery: clears every secret, returns to NOT_ENROLLED, and can only SHORTEN grace. */
  resetEnrollment(accountId: ParentAccountId, now: Date): Promise<boolean>;

  insertTicket(record: { ticketId: string; accountId: ParentAccountId; tokenHash: string; purpose: ParentMfaTicketPurpose; createdAt: Date; expiresAt: Date }): Promise<void>;
  findLiveTicket(tokenHash: string, now: Date): Promise<{ ticketId: string; accountId: ParentAccountId; purpose: ParentMfaTicketPurpose } | null>;
  consumeTicket(ticketId: string, now: Date): Promise<boolean>;

  insertRecoveryCode(record: { codeId: string; accountId: ParentAccountId; codeHash: string; createdAt: Date; expiresAt: Date }): Promise<void>;
  findLatestRecoveryCode(accountId: ParentAccountId): Promise<ParentMfaRecoveryCode | null>;
  incrementRecoveryAttempt(codeId: string): Promise<void>;
  consumeRecoveryCode(codeId: string, now: Date): Promise<boolean>;
  /** Consumes the verified code and atomically starts (without extending) or completes the database hold. */
  applyRecoveryCode(input: { codeId: string; accountId: ParentAccountId; serviceAccountId: string | null; now: Date; holdExpiresAt: Date }): Promise<{ status: 'PENDING'; recoveryAvailableAt: Date; started: boolean } | { status: 'READY' }>;

  insertStepUpGrant(record: { grantId: string; accountId: ParentAccountId; familyId: string; operation: CommercialStepUpOperation; tokenHash: string; createdAt: Date; expiresAt: Date }): Promise<void>;
  /** Single-use: succeeds once for the exact account, family and operation, before expiry. */
  consumeStepUpGrant(input: { tokenHash: string; accountId: ParentAccountId; familyId: string; operation: CommercialStepUpOperation; now: Date }): Promise<boolean>;

  recordSecurityEvent(accountId: ParentAccountId, eventType: ParentSecurityEventType, detail: string | null, occurredAt: Date): Promise<void>;
}
