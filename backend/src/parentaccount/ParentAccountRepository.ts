import type { OpaqueFamilyId } from '../familytrustset/types.js';
import type { FreeAccessSnapshot, ParentAccountId, ParentAccountRecord, ParentAccountType } from './types.js';

export interface NewPendingAccount {
  accountId: ParentAccountId;
  emailHash: Buffer;
  passwordHash: string;
  createdAt: Date;
  accountType: ParentAccountType | null;
  estimatedChildCount: number | null;
}

export interface NewVerificationCode {
  codeId: string;
  accountId: ParentAccountId;
  codeHash: string;
  /**
   * The credential THIS code authorises (migration 0030). Registration no
   * longer writes a pending account's credential directly -- see
   * ParentAccountService.register's own doc comment for the account-takeover
   * this closes.
   */
  passwordHash: string;
  createdAt: Date;
  expiresAt: Date;
}

export interface ActiveVerificationCode {
  codeId: string;
  accountId: ParentAccountId;
  codeHash: string;
  /** Null only for a row written before migration 0030 -- verifyEmail then leaves the account's existing credential untouched. */
  passwordHash: string | null;
  expiresAt: Date;
  consumedAt: Date | null;
  attemptCount: number;
}

export interface VerifiedTransition {
  accountId: ParentAccountId;
  verifiedAt: Date;
  familyId: OpaqueFamilyId | null;
  /** The consumed verification code's own bound credential; null leaves the account's existing password_hash unchanged (pre-migration-0030 rows only). */
  passwordHash: string | null;
  freeAccess: FreeAccessSnapshot;
}

/** Same shape as NewPasswordResetCode/ActivePasswordResetCode, deliberately kept as a separate type against the separate parent_login_step_up_codes table (migration 0042) -- see that migration's header. */
export interface NewLoginStepUpCode {
  codeId: string;
  accountId: ParentAccountId;
  codeHash: string;
  createdAt: Date;
  expiresAt: Date;
}

export interface ActiveLoginStepUpCode {
  codeId: string;
  accountId: ParentAccountId;
  codeHash: string;
  expiresAt: Date;
  consumedAt: Date | null;
  attemptCount: number;
}

/** Same shape as NewVerificationCode/ActiveVerificationCode, deliberately kept as a separate type against the separate parent_password_reset_codes table (migration 0029) -- see that migration's header. */
export interface NewPasswordResetCode {
  codeId: string;
  accountId: ParentAccountId;
  codeHash: string;
  createdAt: Date;
  expiresAt: Date;
}

export interface ActivePasswordResetCode {
  codeId: string;
  accountId: ParentAccountId;
  codeHash: string;
  expiresAt: Date;
  consumedAt: Date | null;
  attemptCount: number;
}

/**
 * Persistence port for the parentaccount domain. `MySqlParentAccountRepository`
 * is the production implementation; a deterministic in-memory
 * implementation exists only under backend/test/ for unit tests.
 *
 * Deliberately does NOT wrap backend/src/auth/**'s AuthRepository/
 * AuthService -- session issuance/validation/revocation for an individual
 * token is delegated entirely to the EXISTING, unmodified AuthService (see
 * ParentAccountService's own header). `revokeAllServiceSessionsFor` is the
 * one exception: no existing AuthRepository method revokes every session
 * for an account, and this domain does not edit backend/src/auth/** to add
 * one -- it instead performs a narrowly-scoped, additive UPDATE directly
 * against the SAME `service_sessions` table AuthRepository already owns
 * (identical WHERE/SET shape to MySqlAuthRepository.revokeSession, just
 * keyed by account_id instead of token_hash), leaving backend/src/auth/**
 * completely untouched.
 */
export interface ParentAccountRepository {
  /** Throws a duplicate-entry error (see db/pool.ts's isDuplicateEntry) if emailHash already exists. */
  createPendingAccount(record: NewPendingAccount): Promise<void>;
  findByEmailHash(emailHash: Buffer): Promise<ParentAccountRecord | null>;
  findById(accountId: ParentAccountId): Promise<ParentAccountRecord | null>;
  findByServiceAccountId(serviceAccountId: string): Promise<ParentAccountRecord | null>;
  /**
   * PCA-ADD-PA-017 enforcement (Writer73): the login-time family-suspend
   * check needs to read `families.status` (migration 0017, written by
   * `platformadmin/accounts/FamilyAccountStatusService.ts`) without this
   * domain taking any write dependency on the `families` table -- mirrors
   * `grantFamilyScopeIfAbsent`'s "narrowly-scoped direct read/write against
   * a shared table this domain does not own" precedent, read-only this
   * time. Returns null iff the family row does not exist (soft-deleted or
   * never created) -- callers treat that identically to ACTIVE, since a
   * missing family row is never itself a reason to deny a parent's login.
   */
  findFamilyStatus(familyId: OpaqueFamilyId): Promise<'ACTIVE' | 'SUSPENDED' | null>;

  insertVerificationCode(record: NewVerificationCode): Promise<void>;
  /**
   * The account's most recently issued verification codes (newest first,
   * bounded by `limit`), regardless of consumed/expired/attempt state --
   * the caller evaluates freshness/consumption/attempt budget itself.
   *
   * Deliberately plural: a registration for an already-PENDING email issues
   * an ADDITIONAL code (each bound to its own credential, migration 0030)
   * rather than replacing the previous one, so an unauthenticated third
   * party can no longer invalidate the code the real mailbox owner is
   * holding. See ParentAccountService.verifyEmail for the per-candidate
   * attempt accounting that keeps the total guess budget unchanged.
   */
  findRecentVerificationCodes(accountId: ParentAccountId, limit: number): Promise<ActiveVerificationCode[]>;
  incrementVerificationAttempt(codeId: string): Promise<void>;
  /** Atomic compare-and-swap: marks the code consumed iff it was not already consumed. Returns true iff THIS call won the race. */
  consumeVerificationCodeIfUnconsumed(codeId: string, consumedAt: Date): Promise<boolean>;

  /** Atomically transitions PENDING_VERIFICATION -> VERIFIED, writing the consumed code's bound credential and FREE_ACCESS snapshot. Family binding is deliberately null here and belongs to the separate atomic DSK genesis repository. */
  markVerified(transition: VerifiedTransition): Promise<void>;

  insertPasswordResetCode(record: NewPasswordResetCode): Promise<void>;
  /** Most recent password-reset code row for the account, regardless of consumed/expired state -- the caller evaluates freshness/consumption itself. */
  findLatestPasswordResetCode(accountId: ParentAccountId): Promise<ActivePasswordResetCode | null>;
  incrementPasswordResetAttempt(codeId: string): Promise<void>;
  /** Atomic compare-and-swap: marks the code consumed iff it was not already consumed. Returns true iff THIS call won the race. */
  consumePasswordResetCodeIfUnconsumed(codeId: string, consumedAt: Date): Promise<boolean>;
  /** Only valid against a VERIFIED account -- resetPassword's own guard enforces this before calling. */
  updatePasswordHash(accountId: ParentAccountId, passwordHash: string): Promise<void>;
  /** Idempotent: only writes if the column is currently NULL (the deterministic accountReferenceHash lookup means every subsequent call resolves to the same service account anyway). */
  setServiceAccountIdIfAbsent(accountId: ParentAccountId, serviceAccountId: string): Promise<void>;

  revokeAllServiceSessionsFor(serviceAccountId: string, revokedAt: Date): Promise<number>;

  insertLoginStepUpCode(record: NewLoginStepUpCode): Promise<void>;
  /** Most recent login-step-up code row for the account, regardless of consumed/expired state -- the caller evaluates freshness/consumption itself. */
  findLatestLoginStepUpCode(accountId: ParentAccountId): Promise<ActiveLoginStepUpCode | null>;
  incrementLoginStepUpAttempt(codeId: string): Promise<void>;
  /** Atomic compare-and-swap: marks the code consumed iff it was not already consumed. Returns true iff THIS call won the race. */
  consumeLoginStepUpCodeIfUnconsumed(codeId: string, consumedAt: Date): Promise<boolean>;
  /** Idempotent: only writes if the column is currently NULL. */
  markFirstLoginCompletedIfAbsent(accountId: ParentAccountId, completedAt: Date): Promise<void>;

  /** Legacy narrow scope helper retained for invitation/admin-owned flows. The Parent registration/GENESIS_R1 path must not call it independently; genesis uses one atomic repository boundary instead. */
  grantFamilyScopeIfAbsent(serviceAccountId: string, familyId: OpaqueFamilyId, now: Date): Promise<void>;

  /** Legacy idempotent family-row helper retained for separately authorized admin/test setup. Parent GENESIS_R1 uses its own all-or-none repository and never calls this helper as a partial commit. */
  createFamilyIfAbsent(familyId: OpaqueFamilyId, now: Date): Promise<void>;
}
