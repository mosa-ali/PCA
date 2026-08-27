import type { FamilyMemberInvitation, FamilyMemberInvitationClient } from '../interfaces';

const delay = (ms = 120) => new Promise((r) => setTimeout(r, ms));
const FAMILY_ID = 'dev-family-1';
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

let invitations: FamilyMemberInvitation[] = [];
let seq = 0;

/** Test/dev-only reset hook so fixture state doesn't leak between test cases. */
export function __resetDevFamilyMemberInvitationsForTests(): void {
  invitations = [];
  seq = 0;
}

/**
 * DEVELOPMENT_ONLY fixture implementation of FamilyMemberInvitationClient.
 * Mirrors FamilyMemberInvitationService's real lifecycle rules (PENDING-only
 * revoke/role-change, atomic-accept semantics) in memory, so demo mode
 * exercises the same states a real backend would produce -- never a working-
 * looking success where the real service would honestly fail.
 */
export class DevFamilyMemberInvitationClient implements FamilyMemberInvitationClient {
  async list(): Promise<FamilyMemberInvitation[]> {
    await delay();
    return invitations;
  }

  async invite(role: 'ADMINISTRATOR' | 'VIEWER', invitedEmail: string): Promise<FamilyMemberInvitation> {
    await delay();
    if (invitations.some((i) => i.status === 'PENDING')) {
      throw new Error('FamilyMemberInvitationClient.invite: A pending invitation already exists for this family member.');
    }
    seq += 1;
    const now = new Date();
    const record: FamilyMemberInvitation = {
      invitationId: `dev-invitation-${seq}`,
      familyId: FAMILY_ID,
      role,
      status: 'PENDING',
      invitedByAccountId: 'dev-owner-account',
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + DEFAULT_TTL_MS).toISOString(),
      acceptedAt: null,
      expiredAt: null,
      revokedAt: null,
      acceptedByAccountId: null,
    };
    invitations = [record, ...invitations];
    void invitedEmail; // never persisted in plaintext client-side either, matching the real backend's hash-only storage
    return record;
  }

  async revoke(invitationId: string): Promise<FamilyMemberInvitation> {
    await delay();
    const existing = invitations.find((i) => i.invitationId === invitationId);
    if (!existing) throw new Error('FamilyMemberInvitationClient.revoke: Invitation was not found.');
    if (existing.status !== 'PENDING') return existing;
    const updated = { ...existing, status: 'REVOKED' as const, revokedAt: new Date().toISOString() };
    invitations = invitations.map((i) => (i.invitationId === invitationId ? updated : i));
    return updated;
  }

  async changeRole(invitationId: string, newRole: 'ADMINISTRATOR' | 'VIEWER'): Promise<FamilyMemberInvitation> {
    await delay();
    const existing = invitations.find((i) => i.invitationId === invitationId);
    if (!existing) throw new Error('FamilyMemberInvitationClient.changeRole: Invitation was not found.');
    if (existing.status !== 'PENDING') {
      throw new Error('FamilyMemberInvitationClient.changeRole: This invitation is no longer pending and its role can no longer be changed.');
    }
    const updated = { ...existing, role: newRole };
    invitations = invitations.map((i) => (i.invitationId === invitationId ? updated : i));
    return updated;
  }

  async accept(invitationId: string): Promise<FamilyMemberInvitation> {
    await delay();
    const existing = invitations.find((i) => i.invitationId === invitationId);
    if (!existing) throw new Error('FamilyMemberInvitationClient.accept: Invitation was not found.');
    if (existing.status === 'ACCEPTED') throw new Error('FamilyMemberInvitationClient.accept: Invitation was already accepted.');
    if (existing.status === 'REVOKED') throw new Error('FamilyMemberInvitationClient.accept: Invitation was revoked.');
    if (new Date(existing.expiresAt).getTime() <= Date.now()) {
      throw new Error('FamilyMemberInvitationClient.accept: Invitation has expired.');
    }
    const updated = { ...existing, status: 'ACCEPTED' as const, acceptedAt: new Date().toISOString(), acceptedByAccountId: 'dev-accepting-account' };
    invitations = invitations.map((i) => (i.invitationId === invitationId ? updated : i));
    return updated;
  }
}
