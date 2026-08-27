export type FamilyMemberInvitationId = string;
export type OpaqueFamilyId = string;
export type OpaqueAccountId = string;

/**
 * Never OWNER -- see PCA_FAMILY_AUTHORITY_COMPLETION_ARCHITECTURE.md's
 * OWNER/ADMIN/VIEWER_AUTHORITY section: ownership is never granted by
 * invitation, only by the family genesis ceremony or an explicit
 * step-up-gated CHANGE_ROLE/ownership-transfer action.
 */
export type InvitedFamilyRole = 'ADMINISTRATOR' | 'VIEWER';

/**
 * Deliberately simpler than enrollment_invitations' 8-state device-pairing
 * lifecycle -- this is a person+role invitation, not a device bootstrap,
 * and has no INSTALL_REQUIRED/APP_INSTALLED/AUTHORIZATION_REQUIRED-shaped
 * intermediate states to model.
 */
export type FamilyMemberInvitationStatus = 'PENDING' | 'ACCEPTED' | 'EXPIRED' | 'REVOKED';

/**
 * Server-side family-member invitation record. Never carries the invited
 * person's plaintext email -- only invitedEmailHash, a one-way digest
 * (mirrors enrollment_invitations never carrying the raw bearer token,
 * only tokenHash).
 */
export interface FamilyMemberInvitationRecord {
  invitationId: FamilyMemberInvitationId;
  familyId: OpaqueFamilyId;
  invitedEmailHash: Buffer;
  role: InvitedFamilyRole;
  status: FamilyMemberInvitationStatus;
  invitedByAccountId: OpaqueAccountId;
  createdAt: Date;
  expiresAt: Date;
  acceptedAt: Date | null;
  expiredAt: Date | null;
  revokedAt: Date | null;
  acceptedByAccountId: OpaqueAccountId | null;
}
