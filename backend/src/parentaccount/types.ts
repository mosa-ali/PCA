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

/**
 * PCA-DEC-037: verification activates the account and nothing else. It does
 * not issue a session -- the owner journey is verify -> sign in, and the first
 * sign-in is the event that starts the MFA grace window and provisions the
 * family.
 */
export interface VerifyEmailOutcome {
  status: 'VERIFIED';
}

/** Server-derived MFA posture exposed to the Parent client. Dates are ISO strings at the HTTP boundary. */
export type ParentMfaSummary =
  | { status: 'ACTIVE' }
  | { status: 'GRACE'; graceExpiresAt: Date }
  | { status: 'SETUP_REQUIRED'; graceExpiresAt: Date }
  | { status: 'RECOVERY_PENDING'; recoveryAvailableAt: Date };

interface EstablishedSession {
  accountId: ParentAccountId;
  familyId: OpaqueFamilyId | null;
  rawSessionToken: string;
  sessionExpiresAt: Date;
  role: FamilyMembershipRole | null;
  mfa: ParentMfaSummary;
}

/**
 * PCA-DEC-037 login outcomes. An account with an ACTIVE authenticator gets
 * MFA_REQUIRED until the request carries a valid 6-digit code; no email code
 * and no remembered-browser grant can substitute for it. An account without
 * one uses the emailed step-up (or, inside its grace window only, this
 * browser's daily grant).
 */
export type LoginOutcome =
  | ({ status: 'AUTHENTICATED' } & EstablishedSession)
  | { status: 'STEP_UP_REQUIRED' }
  | { status: 'MFA_REQUIRED' }
  | { status: 'MFA_RECOVERY_PENDING'; recoveryAvailableAt: Date };

export type CompleteLoginStepUpOutcome =
  | ({ status: 'AUTHENTICATED'; rawDailyLoginGrantToken: string } & EstablishedSession)
  /** Grace is over: no session. The raw ticket authorizes only the enrollment endpoints. */
  | { status: 'MFA_SETUP_REQUIRED'; rawEnrollmentTicket: string };

export type CompleteEnrollmentOutcome =
  | ({ status: 'ENROLLED_SESSION_ESTABLISHED' } & EstablishedSession)
  | { status: 'ENROLLED' };

export interface SessionReadOutcome {
  accountId: ParentAccountId;
  familyId: OpaqueFamilyId | null;
  emailVerified: true;
  role: FamilyMembershipRole | null;
  mfa: ParentMfaSummary;
}

/** Deliberately identical whether or not the email matches a VERIFIED account -- see ParentAccountService.requestPasswordReset, same enumeration-oracle avoidance as RegisterOutcome. */
export interface RequestPasswordResetOutcome {
  status: 'RESET_CODE_SENT_IF_ACCOUNT_EXISTS';
}

export interface ResetPasswordOutcome {
  status: 'PASSWORD_RESET';
}
