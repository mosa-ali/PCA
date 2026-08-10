export type InvitationId = string;
export type OpaqueFamilyId = string;
export type Platform = 'ANDROID' | 'IOS';
export type RequestedProtectionMode = 'ANDROID_STANDARD' | 'ANDROID_PROTECTED' | 'IOS_STANDARD';
export type InvitationStatus = 'CREATED' | 'OPENED' | 'REDEEMED' | 'EXPIRED' | 'REVOKED';

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
  redeemedAt: Date | null;
  revokedAt: Date | null;
}
