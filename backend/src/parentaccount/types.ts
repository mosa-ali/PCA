import type { OpaqueFamilyId } from '../familytrustset/types.js';

export type ParentAccountId = string;
export type ParentAccountStatus = 'PENDING_VERIFICATION' | 'VERIFIED';
export type FreeAccessMode = 'TIME_LIMITED' | 'PERPETUAL';

/**
 * PCA-ADD-IDENT-017/018: snapshotted onto the account exactly once, at
 * successful email verification -- never recomputed later merely because
 * platform-wide defaults changed. `null` on a PENDING_VERIFICATION account
 * (no snapshot has been taken yet).
 */
export interface FreeAccessSnapshot {
  mode: FreeAccessMode;
  durationDays: number | null;
  startedAt: Date;
  expiresAt: Date | null;
  defaultParentMemberLimit: number;
  defaultManagedDeviceLimit: number;
}

export interface ParentAccountRecord {
  accountId: ParentAccountId;
  emailHash: Buffer;
  passwordHash: string;
  status: ParentAccountStatus;
  familyId: OpaqueFamilyId | null;
  serviceAccountId: string | null;
  freeAccess: FreeAccessSnapshot | null;
  createdAt: Date;
  verifiedAt: Date | null;
  disabledAt: Date | null;
}

/** Output of a successful registration call -- deliberately identical in shape whether the email was new or already pending, so the HTTP layer can never distinguish the two (see ParentAccountService.register). */
export interface RegisterOutcome {
  status: 'PENDING_VERIFICATION';
}

export interface VerifyEmailOutcome {
  accountId: ParentAccountId;
  familyId: OpaqueFamilyId | null;
  rawSessionToken: string;
  sessionExpiresAt: Date;
}

export interface LoginOutcome {
  accountId: ParentAccountId;
  familyId: OpaqueFamilyId | null;
  rawSessionToken: string;
  sessionExpiresAt: Date;
}

export interface SessionReadOutcome {
  accountId: ParentAccountId;
  familyId: OpaqueFamilyId | null;
  emailVerified: true;
}

/** Deliberately identical whether or not the email matches a VERIFIED account -- see ParentAccountService.requestPasswordReset, same enumeration-oracle avoidance as RegisterOutcome. */
export interface RequestPasswordResetOutcome {
  status: 'RESET_CODE_SENT_IF_ACCOUNT_EXISTS';
}

export interface ResetPasswordOutcome {
  status: 'PASSWORD_RESET';
}
