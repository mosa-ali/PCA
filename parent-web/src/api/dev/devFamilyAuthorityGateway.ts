import type { FamilyAuthorityGateway } from '../interfaces';
import type { FamilyAction, FamilyRole, PermissionResult } from '../../domain/roles';
import { evaluatePermission, SAFE_DEFAULT_DELEGATION } from '../../domain/roles';
import type { AuditEntrySummary, FamilyMember } from '../../domain/types';
import { DEV_AUDIT, DEV_MEMBERS } from './fixtures';
import { getDevRole } from './devState';

const delay = (ms = 120) => new Promise((r) => setTimeout(r, ms));

let members: FamilyMember[] = [...DEV_MEMBERS];
let audit: AuditEntrySummary[] = [...DEV_AUDIT];

function recordAudit(actionType: string, targetScope: string, result: 'SUCCESS' | 'DENIED'): AuditEntrySummary {
  const entry: AuditEntrySummary = {
    eventId: `audit-${audit.length + 1}`,
    actionType,
    actorMemberId: `member-${getDevRole().toLowerCase()}`,
    targetScope,
    trustSetEpoch: 4,
    policyRevision: 14,
    timestampUtc: new Date().toISOString(),
    resultStatus: result,
    reasonCategory: result === 'DENIED' ? 'INSUFFICIENT_ROLE' : null,
    correlationId: `corr-${Date.now()}`,
  };
  audit = [entry, ...audit];
  return entry;
}

/**
 * DEVELOPMENT_ONLY fixture implementation of FamilyAuthorityGateway. Every
 * mutating method re-checks permission via evaluatePermission before acting
 * -- this is the client-side half of "UI hiding is never authorization"
 * (doc 18 Section 1); it still rejects even if a caller bypasses the UI.
 */
export class DevFamilyAuthorityGateway implements FamilyAuthorityGateway {
  async checkPermission(action: FamilyAction): Promise<PermissionResult> {
    await delay(30);
    return evaluatePermission(getDevRole(), action, SAFE_DEFAULT_DELEGATION);
  }

  async listMembers(): Promise<FamilyMember[]> {
    await delay();
    return members;
  }

  async inviteMember(role: 'ADMINISTRATOR' | 'VIEWER', label: string): Promise<{ invitationId: string }> {
    const action: FamilyAction = role === 'ADMINISTRATOR' ? 'ADD_ADMINISTRATOR' : 'ADD_VIEWER';
    const permission = evaluatePermission(getDevRole(), action);
    await delay();
    if (!permission.allowed) {
      recordAudit('DENIED_AUTHORIZATION_ATTEMPT', 'family/members', 'DENIED');
      throw new Error(permission.reason);
    }
    members = [
      ...members,
      {
        memberId: `member-${Date.now()}`,
        displayName: `${label} (DEV, pending)`,
        role,
        endpointLabel: 'Not yet paired',
        deviceCount: 0,
        status: 'PENDING_DELIVERY',
        lastAcknowledgedPolicyRevision: null,
      },
    ];
    recordAudit('ROLE_INVITATION', 'family/members', 'SUCCESS');
    return { invitationId: `inv-${Date.now()}` };
  }

  async removeMember(memberId: string): Promise<{ auditEventId: string }> {
    const permission = evaluatePermission(getDevRole(), 'REMOVE_NON_OWNER_PARENT');
    await delay();
    if (!permission.allowed) {
      const e = recordAudit('DENIED_AUTHORIZATION_ATTEMPT', `family/members/${memberId}`, 'DENIED');
      throw new Error(permission.reason + ` (audit ${e.eventId})`);
    }
    members = members.filter((m) => m.memberId !== memberId);
    const e = recordAudit('ROLE_REVOKE', `family/members/${memberId}`, 'SUCCESS');
    return { auditEventId: e.eventId };
  }

  async changeRole(memberId: string, newRole: FamilyRole): Promise<{ auditEventId: string }> {
    const permission = evaluatePermission(getDevRole(), 'CHANGE_ANY_ROLE');
    await delay();
    if (!permission.allowed) {
      const e = recordAudit('DENIED_AUTHORIZATION_ATTEMPT', `family/members/${memberId}`, 'DENIED');
      throw new Error(permission.reason + ` (audit ${e.eventId})`);
    }
    members = members.map((m) => (m.memberId === memberId ? { ...m, role: newRole } : m));
    const e = recordAudit('ROLE_CHANGE', `family/members/${memberId}`, 'SUCCESS');
    return { auditEventId: e.eventId };
  }

  async transferOwnership(newOwnerMemberId: string): Promise<{ auditEventId: string }> {
    const permission = evaluatePermission(getDevRole(), 'TRANSFER_OWNERSHIP');
    await delay();
    if (!permission.allowed) {
      const e = recordAudit('DENIED_AUTHORIZATION_ATTEMPT', `family/members/${newOwnerMemberId}`, 'DENIED');
      throw new Error(permission.reason + ` (audit ${e.eventId})`);
    }
    const e = recordAudit('OWNER_TRANSFER_STARTED', `family/members/${newOwnerMemberId}`, 'SUCCESS');
    return { auditEventId: e.eventId };
  }

  async listAuditTrail(): Promise<AuditEntrySummary[]> {
    await delay();
    return audit;
  }
}
