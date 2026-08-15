export type InvitationId = string;
export type OpaqueFamilyId = string;
export type Platform = 'ANDROID' | 'IOS';
export type RequestedProtectionMode = 'ANDROID_STANDARD' | 'ANDROID_PROTECTED' | 'IOS_STANDARD';
/**
 * PCA-ADD-ENR-005 (Addendum 001): the full 8-state invitation lifecycle.
 * INSTALL_REQUIRED / APP_INSTALLED / AUTHORIZATION_REQUIRED are real,
 * persisted states written by explicit InvitationService transitions during
 * the Android install/app-link continuation flow (PCA-ADD-ENR-008), not
 * derived values. EXPIRED is likewise a real persisted transition (written
 * by InvitationRepository.expireIfDue the first time any code path observes
 * an invitation past its expires_at while still non-terminal), never only a
 * value computed on read.
 */
export type InvitationStatus =
  | 'CREATED'
  | 'OPENED'
  | 'INSTALL_REQUIRED'
  | 'APP_INSTALLED'
  | 'AUTHORIZATION_REQUIRED'
  | 'REDEEMED'
  | 'EXPIRED'
  | 'REVOKED';

/**
 * Server-side invitation record. Never carries the raw bearer token — only
 * tokenHash, a one-way digest reference. No child activity/history fields
 * belong here; this is enrollment-bootstrap metadata only.
 */
export interface InvitationRecord {
  invitationId: InvitationId;
  familyId: OpaqueFamilyId;
  tokenHash: string;
  platform: Platform;
  requestedProtectionMode: RequestedProtectionMode;
  status: InvitationStatus;
  createdAt: Date;
  expiresAt: Date;
  openedAt: Date | null;
  installRequiredAt: Date | null;
  appInstalledAt: Date | null;
  authorizationRequiredAt: Date | null;
  redeemedAt: Date | null;
  expiredAt: Date | null;
  revokedAt: Date | null;
}

/** One immutable row of enrollment_invitation_transitions -- append-only audit evidence for PCA-ADD-ENR-005/023. */
export interface InvitationTransitionRecord {
  transitionId: string;
  invitationId: InvitationId;
  fromStatus: InvitationStatus;
  toStatus: InvitationStatus;
  transitionedAt: Date;
}
