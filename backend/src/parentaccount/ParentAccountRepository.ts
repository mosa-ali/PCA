import type { OpaqueFamilyId } from '../familytrustset/types.js';
import type { FreeAccessSnapshot, ParentAccountId, ParentAccountRecord } from './types.js';

export interface NewPendingAccount {
  accountId: ParentAccountId;
  emailHash: Buffer;
  passwordHash: string;
  createdAt: Date;
}

export interface NewVerificationCode {
  codeId: string;
  accountId: ParentAccountId;
  codeHash: string;
  createdAt: Date;
  expiresAt: Date;
}

export interface ActiveVerificationCode {
  codeId: string;
  accountId: ParentAccountId;
  codeHash: string;
  expiresAt: Date;
  consumedAt: Date | null;
  attemptCount: number;
}

export interface VerifiedTransition {
  accountId: ParentAccountId;
  verifiedAt: Date;
  familyId: OpaqueFamilyId | null;
  freeAccess: FreeAccessSnapshot;
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
  /** Only valid while the account is still PENDING_VERIFICATION -- used when a not-yet-verified email registers again (resend semantics). */
  updatePendingPasswordHash(accountId: ParentAccountId, passwordHash: string): Promise<void>;

  insertVerificationCode(record: NewVerificationCode): Promise<void>;
  /** Most recent verification code row for the account, regardless of consumed/expired state -- the caller evaluates freshness/consumption itself. */
  findLatestVerificationCode(accountId: ParentAccountId): Promise<ActiveVerificationCode | null>;
  incrementVerificationAttempt(codeId: string): Promise<void>;
  /** Atomic compare-and-swap: marks the code consumed iff it was not already consumed. Returns true iff THIS call won the race. */
  consumeVerificationCodeIfUnconsumed(codeId: string, consumedAt: Date): Promise<boolean>;

  /** Atomically transitions PENDING_VERIFICATION -> VERIFIED, writing the FREE_ACCESS snapshot and (if genesis succeeded) familyId in the same statement -- see migration 0013's CHECK constraint requiring these to move together. */
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

  /**
   * Grants (or re-activates) an ACTIVE `service_account_family_scopes` row
   * for (serviceAccountId, familyId) -- idempotent. Necessary so a freshly
   * registered Family Owner can actually reach their own family's
   * commercial reads/mutations through the EXISTING, unmodified
   * familyCommercialRoutes.ts/billingCheckoutRoutes.ts
   * (createRequireFamilyCommercialAuthorization/
   * createRequireFamilyAuthorization both require an ACTIVE scope row
   * before anything else runs); without this, a newly genesis-anchored
   * Owner could authenticate but could never reach their own family's
   * data. `backend/src/authz/**` (this table's owning domain) is outside
   * this lane's ownership and exposes no public "grant" method on
   * AuthzRepository -- this is a narrowly-scoped, additive INSERT directly
   * against the SAME existing table, identical in spirit to
   * `revokeAllServiceSessionsFor` above, not a reimplementation or edit of
   * any authz/** source file.
   */
  grantFamilyScopeIfAbsent(serviceAccountId: string, familyId: OpaqueFamilyId, now: Date): Promise<void>;

  /**
   * Idempotent INSERT of a `families` row (migration 0001, `status`/
   * suspend columns added by migration 0017) for a freshly genesis-anchored
   * family -- same "narrowly-scoped direct write against a shared table
   * this domain does not own" precedent as `grantFamilyScopeIfAbsent`
   * above. Without this, self-service registration produced a real,
   * working family (attemptFamilyGenesis/service session/family-commercial
   * access all succeed) that Platform Administration's dashboards, account
   * list/detail, and suspend/reactivate flow (platformadmin/accounts/**)
   * could never see or act on -- confirmed by running real registration
   * against a real database for the first time in this session's local
   * validation (previously only ever exercised via tests that manually
   * INSERTed this row themselves as a documented workaround; see
   * FamilyAccountStatusService.ts's own former header note on this gap).
   */
  createFamilyIfAbsent(familyId: OpaqueFamilyId, now: Date): Promise<void>;
}
