import type { InvitationId, InvitationRecord } from './types.js';

export type RedemptionResult =
  | { outcome: 'REDEEMED'; record: InvitationRecord }
  | { outcome: 'ALREADY_REDEEMED' }
  | { outcome: 'REVOKED' }
  | { outcome: 'EXPIRED' }
  | { outcome: 'NOT_FOUND' };

/**
 * Persistence port for the invitation lifecycle. INV-A ships this interface
 * plus a deterministic in-memory implementation confined to test support.
 * The production PostgreSQL implementation (INV-B) is a separate slice and
 * must not be faked or assumed here.
 *
 * redeemAtomically MUST guarantee exactly one caller observes REDEEMED for a
 * given invitation even under concurrent attempts.
 */
export interface InvitationRepository {
  create(record: InvitationRecord): Promise<void>;
  findByTokenHash(tokenHash: string): Promise<InvitationRecord | null>;
  markOpened(invitationId: InvitationId, openedAt: Date): Promise<InvitationRecord>;
  redeemAtomically(invitationId: InvitationId, redeemedAt: Date): Promise<RedemptionResult>;
  revoke(invitationId: InvitationId, revokedAt: Date): Promise<InvitationRecord>;
}
