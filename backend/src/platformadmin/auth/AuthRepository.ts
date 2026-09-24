import type { PlatformAdminAuditEvent } from '../audit/types.js';
import type {
  PlatformAdminAccountRecord,
  PlatformAdminAccountStatus,
  PlatformAdminId,
  PlatformAdminLoginOutcome,
  PlatformAdminMfaStateRecord,
  PlatformAdminMfaStatus,
  PlatformAdminRole,
  PlatformAdminRoleAssignmentRecord,
  PlatformAdminSessionId,
  PlatformAdminSessionRecord,
  PlatformAdminStepUpId,
  PlatformAdminStepUpScope,
  PlatformAdminStepUpSessionRecord,
} from './types.js';

export interface InitialMfaSeed {
  status: PlatformAdminMfaStatus;
  totpSecretCiphertext: Buffer | null;
  totpSecretNonce: Buffer | null;
  activatedAt: Date | null;
  createdAt: Date;
}

export interface CreateAccountInput {
  adminId: PlatformAdminId;
  emailHash: Buffer;
  displayName: string;
  passwordCredential: string;
  createdAt: Date;
  assignmentId: string;
  role: PlatformAdminRole;
  grantedByAdminId: PlatformAdminId | null;
  grantedAt: Date;
  /** Bootstrap seeds MFA ACTIVE directly (no pending-setup window, see scripts/bootstrap-platform-owner.mjs's rationale); PlatformAdminAccountService.createAccount seeds PENDING_SETUP. */
  initialMfa: InitialMfaSeed;
  auditEvents: PlatformAdminAuditEvent[];
}

export interface AssignRoleInput {
  assignmentId: string;
  adminId: PlatformAdminId;
  role: PlatformAdminRole;
  grantedAt: Date;
  grantedByAdminId: PlatformAdminId | null;
  auditEvent: PlatformAdminAuditEvent;
}

export interface RevokeRoleResult {
  revokedSessionIds: PlatformAdminSessionId[];
}

export interface SessionValidationLookup {
  session: PlatformAdminSessionRecord;
  displayName: string;
  accountStatus: PlatformAdminAccountStatus;
  activeRoles: PlatformAdminRole[];
}

export interface RecordLoginAttemptInput {
  attemptId: string;
  emailHash: Buffer;
  outcome: PlatformAdminLoginOutcome;
  occurredAt: Date;
  auditEvent: PlatformAdminAuditEvent;
  /** Present only for a SUCCESS outcome -- the new session is inserted in the SAME transaction as the attempt row and audit event. */
  session?: PlatformAdminSessionRecord;
}

export interface CreateStepUpInput {
  stepUpId: PlatformAdminStepUpId;
  adminId: PlatformAdminId;
  sessionId: PlatformAdminSessionId;
  scope: PlatformAdminStepUpScope;
  assertedAt: Date;
  expiresAt: Date;
  auditEvent: PlatformAdminAuditEvent;
}

export interface ConsumeStepUpInput {
  stepUpId: PlatformAdminStepUpId;
  adminId: PlatformAdminId;
  sessionId: PlatformAdminSessionId;
  scope: PlatformAdminStepUpScope;
  consumedAt: Date;
}

export interface BeginMfaEnrollmentInput {
  adminId: PlatformAdminId;
  totpSecretCiphertext: Buffer;
  totpSecretNonce: Buffer;
}

export interface ActivateMfaInput {
  adminId: PlatformAdminId;
  acceptedTotpCounter: number;
  activatedAt: Date;
  auditEvent: PlatformAdminAuditEvent;
}

/**
 * Read-repair input for the bounded MFA key ring.
 *
 * `expectedCiphertext`/`expectedNonce` are the values the caller actually
 * decrypted; the write only lands if the row STILL holds them, so two
 * concurrent repairs cannot both apply and a repair can never overwrite a
 * newer secret. `ciphertext`/`nonce` are the same secret re-sealed under the
 * ACTIVE key. Scope is both PENDING_SETUP and ACTIVE rows: restricting it to
 * pending would leave already-enrolled admins permanently dependent on a
 * legacy key. No activation token is involved, and no state is changed.
 */
export interface CompareAndSwapMfaSecretCiphertextInput {
  adminId: PlatformAdminId;
  expectedCiphertext: Buffer;
  expectedNonce: Buffer;
  ciphertext: Buffer;
  nonce: Buffer;
}

/**
 * Persistence port for the entire Platform Administration auth domain
 * (accounts, roles, sessions, MFA, step-up, login attempts). Deliberately
 * one wide interface rather than one-repository-per-table: several
 * operations (role revocation cascading to session revocation, account
 * creation with its initial role + MFA seed + audit rows, login recording
 * an attempt + audit event + optional session issuance) are each a single
 * atomic transaction spanning multiple tables, so the transaction boundary
 * lives here, not split across several repository classes that would each
 * need their own connection.
 */
export interface PlatformAdminAuthRepository {
  createAccount(input: CreateAccountInput): Promise<PlatformAdminAccountRecord>;
  findAccountByEmailHash(emailHash: Buffer): Promise<PlatformAdminAccountRecord | null>;
  findAccountById(adminId: PlatformAdminId): Promise<PlatformAdminAccountRecord | null>;
  findActiveRoles(adminId: PlatformAdminId): Promise<PlatformAdminRole[]>;
  findActiveRoleAssignments(adminId: PlatformAdminId): Promise<PlatformAdminRoleAssignmentRecord[]>;

  assignRole(input: AssignRoleInput): Promise<void>;
  /** Cascades to force-revoke every active session for the admin, in the SAME transaction (PCA-ADD-PA-019). */
  revokeRole(input: { adminId: PlatformAdminId; role: PlatformAdminRole; revokedAt: Date; auditEvent: PlatformAdminAuditEvent }): Promise<RevokeRoleResult>;
  /** Cascades to force-revoke every active session for the admin, in the SAME transaction. */
  disableAccount(input: { adminId: PlatformAdminId; disabledAt: Date; auditEvent: PlatformAdminAuditEvent }): Promise<RevokeRoleResult>;
  reactivateAccount(input: { adminId: PlatformAdminId; auditEvent: PlatformAdminAuditEvent }): Promise<void>;

  getMfaState(adminId: PlatformAdminId): Promise<PlatformAdminMfaStateRecord | null>;
  /** Stores the encrypted enrollment secret exactly once while MFA is pending. */
  beginMfaEnrollment(input: BeginMfaEnrollmentInput): Promise<boolean>;
  /** Atomically activates a pending factor and claims its first TOTP counter. */
  activateMfa(input: ActivateMfaInput): Promise<boolean>;
  /**
   * Read-repair for the bounded MFA key ring: replaces an existing sealed
   * secret with the same secret re-sealed under the active key, guarded by a
   * compare-and-swap on the observed old ciphertext/nonce identity.
   *
   * Unlike `beginMfaEnrollment` (which stores a secret exactly once while MFA is
   * pending) this is NOT a lifecycle transition: it applies to both
   * PENDING_SETUP and ACTIVE rows, changes no state column, requires and
   * consumes no activation token, and never creates an enrollment.
   *
   * Returns true iff exactly one row was updated. False means the row already
   * moved on -- most often a concurrent repair that won the race. That is a
   * benign outcome, NOT an authentication or activation failure: callers must
   * treat false as "already handled" and continue. InnoDB's row lock on this
   * UPDATE's WHERE clause is the concurrency-safety mechanism.
   */
  compareAndSwapMfaSecretCiphertext(input: CompareAndSwapMfaSecretCiphertextInput): Promise<boolean>;

  createSession(record: PlatformAdminSessionRecord): Promise<void>;
  findSessionForValidation(tokenHash: string): Promise<SessionValidationLookup | null>;
  revokeSessionByTokenHash(tokenHash: string, revokedAt: Date, auditEvent?: PlatformAdminAuditEvent): Promise<boolean>;
  revokeAllActiveSessions(adminId: PlatformAdminId, revokedAt: Date, buildAuditEvent: (sessionId: PlatformAdminSessionId) => PlatformAdminAuditEvent): Promise<RevokeRoleResult>;

  recentFailedLoginTimestampsDescending(emailHash: Buffer, limit: number): Promise<Date[]>;
  recordLoginAttempt(input: RecordLoginAttemptInput): Promise<void>;

  createStepUp(input: CreateStepUpInput): Promise<PlatformAdminStepUpSessionRecord>;
  recordDeniedStepUp(auditEvent: PlatformAdminAuditEvent): Promise<void>;
  /** Guarded single-use consume: returns true iff exactly one matching, unexpired, unconsumed row was updated. */
  consumeStepUp(input: ConsumeStepUpInput): Promise<boolean>;

  /**
   * TOTP-REPLAY-1: atomically claims one absolute HOTP counter for this
   * admin as "accepted," durably, via a single guarded UPDATE (mirroring
   * consumeStepUp's own guarded-UPDATE-then-check-affected-rows idiom):
   *   UPDATE platform_admin_mfa_state
   *   SET last_accepted_totp_counter = ?
   *   WHERE admin_id = ?
   *     AND (last_accepted_totp_counter IS NULL OR last_accepted_totp_counter < ?)
   * Returns true iff exactly one row was affected (this counter is
   * strictly newer than whatever was last accepted -- claim succeeded).
   * Returns false for a stale/replayed/older-or-equal counter, OR a
   * concurrent duplicate submission that lost the race -- both cases are
   * indistinguishable by design. InnoDB's row lock on this UPDATE's WHERE
   * clause is the entire concurrency-safety mechanism: of N simultaneous
   * claims of the SAME counter value, exactly one commits and every other
   * sees its WHERE clause no longer match. This is ONE shared counter per
   * admin (not one per call-site), used identically by both `login` and
   * `assertStepUp` -- that sharing is what makes a code consumed at login
   * unusable for step-up, and vice versa.
   */
  claimTotpCounter(adminId: PlatformAdminId, counter: number): Promise<boolean>;
}
