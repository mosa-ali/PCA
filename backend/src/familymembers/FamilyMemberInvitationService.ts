import { randomUUID } from 'node:crypto';
import { hashInvitedEmail, isPlausibleInvitedEmail } from './emailHash.js';
import type { FamilyMemberInvitationRepository } from './FamilyMemberInvitationRepository.js';
import type {
  FamilyMemberInvitationId,
  FamilyMemberInvitationRecord,
  FamilyMemberInvitationStatus,
  InvitedFamilyRole,
  OpaqueAccountId,
  OpaqueFamilyId,
} from './types.js';
import { FamilyAuditService, InMemoryFamilyAuditRepository } from '../familyrbac/FamilyAuditStore.js';
import type { ParentActionAuthorizationService } from '../familyrbac/ParentActionAuthorizationService.js';
import type { EntitlementRepository } from '../entitlements/EntitlementRepository.js';

export type FamilyMemberInvitationErrorCode =
  | 'INVALID_INPUT'
  | 'NOT_FOUND'
  | 'EXPIRED'
  | 'REVOKED'
  | 'ALREADY_ACCEPTED'
  /** A PENDING invitation already exists for this exact (family, email) pair -- revoke it first rather than issuing a duplicate. */
  | 'DUPLICATE_PENDING_INVITATION'
  /** ParentActionAuthorizationService.authorize() did not return ALLOW -- see its own `reason` in the thrown error's cause, never surfaced as a distinguishable code to the caller (same error-oracle posture as CROSS_FAMILY_TARGET). */
  | 'NOT_AUTHORIZED'
  /** The family's parentMemberLimit (including complimentary capacity) has no room for this invitation once already-used seats and other still-PENDING invitations are counted. */
  | 'CAPACITY_EXCEEDED'
  /** changeRole only ever applies to a still-PENDING invitation -- once accepted, role is resolved from the (not-yet-real) TrustSetRoleResolver, not this table. */
  | 'NOT_PENDING';

/** Message text is always a fixed, generic string per code -- never interpolates the raw email or family data. */
export class FamilyMemberInvitationError extends Error {
  readonly code: FamilyMemberInvitationErrorCode;
  constructor(code: FamilyMemberInvitationErrorCode) {
    super(FAMILY_MEMBER_INVITATION_ERROR_MESSAGES[code]);
    this.name = 'FamilyMemberInvitationError';
    this.code = code;
  }
}

const FAMILY_MEMBER_INVITATION_ERROR_MESSAGES: Record<FamilyMemberInvitationErrorCode, string> = {
  INVALID_INPUT: 'Invalid invitation input.',
  NOT_FOUND: 'Invitation was not found.',
  EXPIRED: 'Invitation has expired.',
  REVOKED: 'Invitation was revoked.',
  ALREADY_ACCEPTED: 'Invitation was already accepted.',
  DUPLICATE_PENDING_INVITATION: 'A pending invitation already exists for this family member.',
  NOT_AUTHORIZED: 'You are not authorized to perform this action.',
  CAPACITY_EXCEEDED: 'This family has reached its parent-member limit.',
  NOT_PENDING: 'This invitation is no longer pending and its role can no longer be changed.',
};

const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days -- a person-invitation is not a one-time device bootstrap link, longer-lived than enrollment_invitations' short TTL is appropriate.
const TERMINAL_STATUSES: ReadonlySet<FamilyMemberInvitationStatus> = new Set(['ACCEPTED', 'EXPIRED', 'REVOKED']);

export interface CreateFamilyMemberInvitationInput {
  familyId: OpaqueFamilyId;
  invitedEmail: string;
  role: InvitedFamilyRole;
  invitedByAccountId: OpaqueAccountId;
  /** The inviting parent's OWN browser/device, verified via ParentActionAuthorizationService -- never the invited person's identity (they have none in this family yet). */
  actorDeviceId: OpaqueAccountId;
  ttlMs?: number;
}

function operationForRole(role: InvitedFamilyRole): 'ADD_ADMINISTRATOR' | 'ADD_VIEWER' {
  return role === 'ADMINISTRATOR' ? 'ADD_ADMINISTRATOR' : 'ADD_VIEWER';
}

/**
 * Optional composition hook: on successful acceptance, binds the accepting
 * account to the family (sets parent_accounts.family_id). Mirrors
 * ParentAccountService's own "narrowly-scoped direct write against a
 * shared table this domain doesn't own" precedent
 * (grantFamilyScopeIfAbsent/createFamilyIfAbsent) -- this domain does not
 * own parent_accounts, so it depends on this narrow interface rather than
 * importing parentaccount/ directly. Optional and defaults to a no-op (like
 * InvitationService's InvitationAlerting) so tests/callers that only care
 * about the invitation's own lifecycle are unaffected; production wiring
 * (a real HTTP route, out of scope for this pass) should inject a real
 * implementation.
 */
export interface FamilyMemberAccountBinder {
  /** Idempotent: must not overwrite an account that is already bound to a (possibly different) family -- accepting an invitation never silently reassigns an existing membership. */
  bindAccountToFamily(accountId: OpaqueAccountId, familyId: OpaqueFamilyId, now: Date): Promise<void>;
}

export class NoopFamilyMemberAccountBinder implements FamilyMemberAccountBinder {
  async bindAccountToFamily(): Promise<void> {
    // Deliberately does nothing -- see FamilyMemberAccountBinder's own doc comment.
  }
}

export class FamilyMemberInvitationService {
  private readonly repository: FamilyMemberInvitationRepository;
  private readonly authorization: ParentActionAuthorizationService;
  private readonly now: () => Date;
  private readonly auditService: FamilyAuditService;
  private readonly accountBinder: FamilyMemberAccountBinder;
  private readonly entitlementRepository: EntitlementRepository | null;

  /**
   * `auditService` defaults to a private, per-instance in-memory reference
   * store when not supplied -- production wiring should inject a SHARED
   * FamilyAuditService instance so records from every family-rbac event
   * source land in one place, exactly like InvitationService's own
   * constructor doc comment.
   *
   * `authorization` is required (not optional/defaulted) -- unlike
   * accountBinder/entitlementRepository, there is no honest no-op default
   * for "should this action be allowed" the way NoopFamilyMemberAccountBinder
   * is an honest no-op for "bind this account to a family" (see PCA10's own
   * rule: RBAC is enforced by every receiving endpoint, never optional).
   * Every call site must supply a real ParentActionAuthorizationService,
   * even one wired to UnavailableTrustSetRoleResolver in production --
   * that is a fail-closed real answer, not a missing one.
   *
   * `entitlementRepository` is optional (null = capacity check skipped)
   * only because the same PARENT_MEMBER_CONSUMPTION_BINDING_REQUIRED gap
   * this constructor closes means some callers (e.g. lower-level unit
   * tests of the invitation lifecycle alone) legitimately don't care about
   * billing capacity; production wiring (buildServer.ts) must supply a
   * real one.
   */
  constructor(
    repository: FamilyMemberInvitationRepository,
    authorization: ParentActionAuthorizationService,
    now: () => Date = () => new Date(),
    auditService: FamilyAuditService = new FamilyAuditService(new InMemoryFamilyAuditRepository()),
    accountBinder: FamilyMemberAccountBinder = new NoopFamilyMemberAccountBinder(),
    entitlementRepository: EntitlementRepository | null = null,
  ) {
    this.repository = repository;
    this.authorization = authorization;
    this.entitlementRepository = entitlementRepository;
    this.now = now;
    this.auditService = auditService;
    this.accountBinder = accountBinder;
  }

  async createInvitation(input: CreateFamilyMemberInvitationInput): Promise<FamilyMemberInvitationRecord> {
    if (!isPlausibleInvitedEmail(input.invitedEmail)) throw new FamilyMemberInvitationError('INVALID_INPUT');
    if (!isInvitedFamilyRole(input.role)) throw new FamilyMemberInvitationError('INVALID_INPUT');

    const createdAt = this.now();
    const decision = this.authorization.authorize({
      familyId: input.familyId,
      actorDeviceId: input.actorDeviceId,
      operation: operationForRole(input.role),
      // No existing member/device is being targeted yet -- inviting a new
      // person acts on the family's own membership roster, not on any
      // individual member. See ParentActionAuthorizationService's FAMILY
      // targetScope validation (target.id must equal the acting family).
      targetScope: { kind: 'FAMILY', id: input.familyId },
      issuedAt: createdAt,
      expiresAt: new Date(createdAt.getTime() + 60_000),
      stepUp: null,
      idempotencyKey: randomUUID(),
      actionId: randomUUID(),
    });
    if (decision.verdict !== 'ALLOW') throw new FamilyMemberInvitationError('NOT_AUTHORIZED');

    const invitedEmailHash = hashInvitedEmail(input.invitedEmail);

    const existingPending = await this.repository.findPendingByFamilyAndEmailHash(input.familyId, invitedEmailHash);
    if (existingPending && !(await this.isExpiredNow(existingPending))) {
      throw new FamilyMemberInvitationError('DUPLICATE_PENDING_INVITATION');
    }

    if (this.entitlementRepository) {
      const entitlement = await this.entitlementRepository.getForFamily(input.familyId);
      if (entitlement) {
        const pending = await this.repository.listForFamily(input.familyId);
        const pendingCount = pending.filter((r) => r.status === 'PENDING' && !this.isExpired(r)).length;
        if (entitlement.parentMemberUsedCount + pendingCount >= entitlement.parentMemberLimit) {
          throw new FamilyMemberInvitationError('CAPACITY_EXCEEDED');
        }
      }
    }

    const invitationId = randomUUID();
    const expiresAt = new Date(createdAt.getTime() + (input.ttlMs ?? DEFAULT_TTL_MS));

    const record: FamilyMemberInvitationRecord = {
      invitationId,
      familyId: input.familyId,
      invitedEmailHash,
      role: input.role,
      status: 'PENDING',
      invitedByAccountId: input.invitedByAccountId,
      createdAt,
      expiresAt,
      acceptedAt: null,
      expiredAt: null,
      revokedAt: null,
      acceptedByAccountId: null,
    };
    await this.repository.create(record);
    await this.auditService.record({
      familyId: record.familyId,
      actionType: 'ROLE_INVITATION',
      actorDeviceId: input.actorDeviceId,
      actorMemberId: null,
      targetScope: { kind: 'FAMILY', id: record.familyId },
      authorizationRole: null,
      trustSetEpoch: 0,
      policyRevision: null,
      clientMonotonicSequence: null,
      resultStatus: 'SUCCESS',
      targetAcknowledgementCount: 0,
      reasonCategory: null,
      correlationId: record.invitationId,
      actionId: null,
    });
    return record;
  }

  async getInvitationForFamily(familyId: OpaqueFamilyId, invitationId: FamilyMemberInvitationId): Promise<FamilyMemberInvitationRecord> {
    const record = await this.repository.findByIdForFamily(familyId, invitationId);
    if (!record) throw new FamilyMemberInvitationError('NOT_FOUND');
    return this.persistExpiryIfDue(record);
  }

  async listInvitationsForFamily(familyId: OpaqueFamilyId): Promise<FamilyMemberInvitationRecord[]> {
    const records = await this.repository.listForFamily(familyId);
    return Promise.all(records.map((record) => this.persistExpiryIfDue(record)));
  }

  private authorizeFamilyOperation(familyId: OpaqueFamilyId, actorDeviceId: OpaqueAccountId, operation: 'REMOVE_NON_OWNER_PARENT' | 'CHANGE_ROLE'): void {
    const now = this.now();
    const decision = this.authorization.authorize({
      familyId,
      actorDeviceId,
      operation,
      targetScope: { kind: 'FAMILY', id: familyId },
      issuedAt: now,
      expiresAt: new Date(now.getTime() + 60_000),
      stepUp: null,
      idempotencyKey: randomUUID(),
      actionId: randomUUID(),
    });
    if (decision.verdict !== 'ALLOW') throw new FamilyMemberInvitationError('NOT_AUTHORIZED');
  }

  /** Family-scoped revoke: the UPDATE itself is filtered by family_id (see revokeForFamily), so a caller can never revoke another family's invitation by guessing an id. */
  async revokeInvitationForFamily(familyId: OpaqueFamilyId, invitationId: FamilyMemberInvitationId, actorDeviceId: OpaqueAccountId): Promise<FamilyMemberInvitationRecord> {
    this.authorizeFamilyOperation(familyId, actorDeviceId, 'REMOVE_NON_OWNER_PARENT');
    const record = await this.repository.revokeForFamily(familyId, invitationId, this.now());
    if (!record) throw new FamilyMemberInvitationError('NOT_FOUND');
    await this.auditService.record({
      familyId,
      actionType: 'ROLE_REVOKE',
      actorDeviceId,
      actorMemberId: null,
      targetScope: { kind: 'FAMILY', id: familyId },
      authorizationRole: null,
      trustSetEpoch: 0,
      policyRevision: null,
      clientMonotonicSequence: null,
      resultStatus: 'SUCCESS',
      targetAcknowledgementCount: 0,
      reasonCategory: null,
      correlationId: invitationId,
      actionId: null,
    });
    return record;
  }

  /**
   * Revises a still-PENDING invitation's offered role. Deliberately does
   * NOT apply to an already-ACCEPTED invitation: per this file's own header
   * and types.ts's doc comment, the displayed/enforced role for an active
   * (trust-set-resolved) member comes from TrustSetRoleResolver, not this
   * table, once accepted -- there is nothing in this domain's own
   * persistence for this method to honestly change past that point.
   */
  async changeInvitationRole(familyId: OpaqueFamilyId, invitationId: FamilyMemberInvitationId, newRole: InvitedFamilyRole, actorDeviceId: OpaqueAccountId): Promise<FamilyMemberInvitationRecord> {
    if (!isInvitedFamilyRole(newRole)) throw new FamilyMemberInvitationError('INVALID_INPUT');
    this.authorizeFamilyOperation(familyId, actorDeviceId, 'CHANGE_ROLE');
    const existing = await this.repository.findByIdForFamily(familyId, invitationId);
    if (!existing) throw new FamilyMemberInvitationError('NOT_FOUND');
    const current = await this.persistExpiryIfDue(existing);
    if (current.status !== 'PENDING') throw new FamilyMemberInvitationError('NOT_PENDING');

    const record = await this.repository.updateRoleForFamily(familyId, invitationId, newRole);
    if (!record) throw new FamilyMemberInvitationError('NOT_PENDING');
    await this.auditService.record({
      familyId,
      actionType: 'CHANGE_ROLE',
      actorDeviceId,
      actorMemberId: null,
      targetScope: { kind: 'FAMILY', id: familyId },
      authorizationRole: newRole,
      trustSetEpoch: 0,
      policyRevision: null,
      clientMonotonicSequence: null,
      resultStatus: 'SUCCESS',
      targetAcknowledgementCount: 0,
      reasonCategory: null,
      correlationId: invitationId,
      actionId: null,
    });
    return record;
  }

  /**
   * Accepting an invitation is NOT itself trust-set membership -- see
   * types.ts's own doc comment and this file header. It (a) transitions
   * this invitation's own row to ACCEPTED, and (b) best-effort binds the
   * accepting account to the family via the injected FamilyMemberAccountBinder,
   * so the family_id assignment happens atomically with acceptance from this
   * service's point of view, without this domain importing parentaccount/
   * directly.
   */
  async acceptInvitation(invitationId: FamilyMemberInvitationId, acceptingAccountId: OpaqueAccountId): Promise<FamilyMemberInvitationRecord> {
    const acceptedAt = this.now();
    const result = await this.repository.acceptAtomically(invitationId, acceptingAccountId, acceptedAt);
    switch (result.outcome) {
      case 'ACCEPTED':
        await this.accountBinder.bindAccountToFamily(acceptingAccountId, result.record.familyId, acceptedAt);
        await this.auditService.record({
          familyId: result.record.familyId,
          actionType: 'ROLE_ACCEPT',
          actorDeviceId: 'SERVICE_SESSION',
          actorMemberId: null,
          targetScope: { kind: 'FAMILY', id: result.record.familyId },
          authorizationRole: result.record.role,
          trustSetEpoch: 0,
          policyRevision: null,
          clientMonotonicSequence: null,
          resultStatus: 'SUCCESS',
          targetAcknowledgementCount: 0,
          reasonCategory: null,
          correlationId: result.record.invitationId,
          actionId: null,
        });
        return result.record;
      case 'ALREADY_ACCEPTED':
        throw new FamilyMemberInvitationError('ALREADY_ACCEPTED');
      case 'REVOKED':
        throw new FamilyMemberInvitationError('REVOKED');
      case 'EXPIRED':
        throw new FamilyMemberInvitationError('EXPIRED');
      case 'NOT_FOUND':
        throw new FamilyMemberInvitationError('NOT_FOUND');
    }
  }

  private isExpired(record: FamilyMemberInvitationRecord): boolean {
    return this.now().getTime() >= record.expiresAt.getTime();
  }

  private async isExpiredNow(record: FamilyMemberInvitationRecord): Promise<boolean> {
    if (TERMINAL_STATUSES.has(record.status)) return false; // already terminal (e.g. revoked) -- not "expired-and-blocking" for duplicate-detection purposes
    return this.isExpired(record);
  }

  /**
   * EXPIRED is a real, persisted transition rather than a value computed
   * only on read -- mirrors InvitationService.persistExpiryIfDue exactly.
   */
  private async persistExpiryIfDue(record: FamilyMemberInvitationRecord): Promise<FamilyMemberInvitationRecord> {
    if (TERMINAL_STATUSES.has(record.status) || !this.isExpired(record)) return record;
    return this.repository.expireIfDue(record.invitationId, this.now());
  }
}

function isInvitedFamilyRole(value: string): value is InvitedFamilyRole {
  return value === 'ADMINISTRATOR' || value === 'VIEWER';
}
