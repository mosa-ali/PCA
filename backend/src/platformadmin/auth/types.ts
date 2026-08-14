/**
 * PCA Platform Administration -- admin identity/RBAC domain types.
 * PCA-ADD-PA-010/011/012/013: a first-class, structurally independent
 * account/role/session type -- never a flag on, or extension of, a
 * family/parent account record (backend/src/auth/types.ts,
 * backend/src/familyrbac/types.ts). Nothing in this file imports from, or
 * is imported by, backend/src/auth, backend/src/authz, or
 * backend/src/familyrbac.
 */

export type PlatformAdminId = string;
export type PlatformAdminSessionId = string;
export type PlatformAdminStepUpId = string;
export type PlatformAdminRoleAssignmentId = string;
export type PlatformAdminLoginAttemptId = string;

/** Section 3's five roles, transcribed verbatim. */
export const PLATFORM_ADMIN_ROLES = [
  'APP_OWNER',
  'PLATFORM_ADMIN',
  'FINANCE_ADMIN',
  'SUPPORT_ADMIN',
  'AUDITOR_READ_ONLY',
] as const;

export type PlatformAdminRole = (typeof PLATFORM_ADMIN_ROLES)[number];

export type PlatformAdminAccountStatus = 'ACTIVE' | 'DISABLED';

export type PlatformAdminMfaStatus = 'PENDING_SETUP' | 'ACTIVE' | 'DISABLED';

export type PlatformAdminLoginOutcome = 'SUCCESS' | 'FAILED_CREDENTIALS' | 'FAILED_MFA' | 'LOCKED_OUT';

export const PLATFORM_ADMIN_STEP_UP_SCOPES = [
  'REFUND',
  'SETTLEMENT_BANK_CONFIG',
  'ADMIN_ROLE_GRANT',
  'FAMILY_ACCOUNT_SUSPEND',
  'FAMILY_ACCOUNT_REACTIVATE',
  'ENTITLEMENT_LIMIT_OVERRIDE',
] as const;

export type PlatformAdminStepUpScope = (typeof PLATFORM_ADMIN_STEP_UP_SCOPES)[number];

export interface PlatformAdminAccountRecord {
  adminId: PlatformAdminId;
  emailHash: Buffer;
  displayName: string;
  passwordCredential: string;
  status: PlatformAdminAccountStatus;
  createdAt: Date;
  disabledAt: Date | null;
}

export interface PlatformAdminRoleAssignmentRecord {
  assignmentId: PlatformAdminRoleAssignmentId;
  adminId: PlatformAdminId;
  role: PlatformAdminRole;
  grantedAt: Date;
  revokedAt: Date | null;
  grantedByAdminId: PlatformAdminId | null;
}

/** realm is always the literal 'PLATFORM_ADMIN' -- see the migration's own comment on this belt-and-suspenders marker. */
export interface PlatformAdminSessionRecord {
  sessionId: PlatformAdminSessionId;
  adminId: PlatformAdminId;
  tokenHash: string;
  realm: 'PLATFORM_ADMIN';
  issuedAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
}

export interface PlatformAdminMfaStateRecord {
  adminId: PlatformAdminId;
  status: PlatformAdminMfaStatus;
  totpSecretCiphertext: Buffer | null;
  totpSecretNonce: Buffer | null;
  activatedAt: Date | null;
  createdAt: Date;
  /** TOTP-REPLAY-1: the durable, monotonic replay-prevention watermark shared identically across LOGIN and STEP-UP verification -- NULL means no code has ever been accepted for this admin. See AuthRepository.claimTotpCounter and migration 0005's column comment. */
  lastAcceptedTotpCounter: number | null;
}

export interface PlatformAdminStepUpSessionRecord {
  stepUpId: PlatformAdminStepUpId;
  adminId: PlatformAdminId;
  sessionId: PlatformAdminSessionId;
  scope: PlatformAdminStepUpScope;
  assertedAt: Date;
  expiresAt: Date;
  consumedAt: Date | null;
}

export interface PlatformAdminLoginAttemptRecord {
  attemptId: PlatformAdminLoginAttemptId;
  emailHash: Buffer;
  outcome: PlatformAdminLoginOutcome;
  occurredAt: Date;
}

/** Output of an authenticated whoami/session-validation lookup: the admin id and every currently-active (granted, not revoked) role. */
export interface PlatformAdminIdentity {
  adminId: PlatformAdminId;
  roles: PlatformAdminRole[];
  sessionId: PlatformAdminSessionId;
  sessionExpiresAt: Date;
}
