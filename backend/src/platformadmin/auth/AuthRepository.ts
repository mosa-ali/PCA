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
}
