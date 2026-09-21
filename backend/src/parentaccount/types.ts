import type { OpaqueFamilyId } from '../familytrustset/types.js';
import type { FamilyMembershipRole } from '../familymembers/FamilyMembershipRepository.js';

export type ParentAccountId = string;
export type ParentAccountStatus = 'PENDING_VERIFICATION' | 'VERIFIED';
export type FreeAccessMode = 'TIME_LIMITED' | 'PERPETUAL';
export type ParentAccountType = 'PARENT_GUARDIAN' | 'OTHER';

export interface ParentSignupProfile {
  accountType: ParentAccountType;
  estimatedChildCount: number | null;
}

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
  /**
   * Owner authentication-architecture decision (2026-09-15): null until
   * this account has ever completed an authenticated session -- set at
   * email-verification time (verifyEmail's own auto-session issuance IS an
   * authentication event: proving control of the mailbox via a code is at
   * least as strong as a login-time step-up code) and, for any legacy account
   * that reaches login() before that has happened, at first successful
   * step-up-verified login. Current routine-login assurance is controlled by
   * the separate browser-bound daily-login grant, not by this account-level
   * marker.
   */
  firstLoginCompletedAt: Date | null;
  /** Profile metadata only; never an authorization input. */
  accountType: ParentAccountType | null;
  /** Profile metadata only; nullable and bounded at the HTTP/domain boundary. */
  estimatedChildCount: number | null;
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
  role: FamilyMembershipRole | null;
}

/**
 * Owner authentication-architecture decision (2026-09-15): a first-ever
 * login is not complete until the browser has a valid daily-login grant;
 * without one it durably enqueues the existing step-up code and returns
 * STEP_UP_REQUIRED. The first-login marker remains historical metadata and
 * is not a global daily bypass.
 */
export type LoginOutcome =
  | { status: 'AUTHENTICATED'; accountId: ParentAccountId; familyId: OpaqueFamilyId | null; rawSessionToken: string; sessionExpiresAt: Date; role: FamilyMembershipRole | null }
  | { status: 'STEP_UP_REQUIRED' };

export interface CompleteLoginStepUpOutcome {
  accountId: ParentAccountId;
  familyId: OpaqueFamilyId | null;
  rawSessionToken: string;
  sessionExpiresAt: Date;
  role: FamilyMembershipRole | null;
  /** Raw token is returned only to the HTTP layer so it can be set as an HttpOnly cookie. */
  rawDailyLoginGrantToken: string;
}

export interface SessionReadOutcome {
  accountId: ParentAccountId;
  familyId: OpaqueFamilyId | null;
  emailVerified: true;
  role: FamilyMembershipRole | null;
}

/** Deliberately identical whether or not the email matches a VERIFIED account -- see ParentAccountService.requestPasswordReset, same enumeration-oracle avoidance as RegisterOutcome. */
export interface RequestPasswordResetOutcome {
  status: 'RESET_CODE_SENT_IF_ACCOUNT_EXISTS';
}

export interface ResetPasswordOutcome {
  status: 'PASSWORD_RESET';
}
