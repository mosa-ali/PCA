import { randomUUID } from 'node:crypto';
import type { PoolConnection } from 'mysql2/promise';
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
import type { NewCapacityAcquisitionPolicy } from '../parentaccount/freeaccess/FreeAccessAcquisitionPolicy.js';
import { FreeAccessEnforcementError } from '../parentaccount/freeaccess/types.js';
import type { RemoveMemberTransactionHook } from './FamilyMemberInvitationRepository.js';

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
  /** FREE_ACCESS_ENFORCEMENT_V1: this account's free-access period has EXPIRED (with no overriding active complimentary COMMERCIAL_ACCESS grant), and a parent-member invite is one of the three NEW-capacity-consuming operations the frozen contract denies after expiry -- see deriveFreeAccessStatus.ts. Distinct from CAPACITY_EXCEEDED: the family may have seats to spare and still be denied. Mirrors InvitationService's and FamilyCommercialService's own identically-named codes. */
  | 'FREE_ACCESS_EXPIRED_NEW_CAPACITY_DENIED'
  /** changeRole only ever applies to a still-PENDING invitation -- once accepted, role is resolved from the (not-yet-real) TrustSetRoleResolver, not this table. */
  | 'NOT_PENDING'
  /** removeMember only ever targets ANOTHER parent's membership -- see removeMember's own doc comment for why a self-removal is refused rather than modeled as a "leave this family" flow. */
  | 'CANNOT_REMOVE_SELF'
  /** removeMember never revokes ownership -- see FamilyMemberInvitationRepository.removeMemberAtomically's own doc comment for exactly how the Owner is identified without a durable role column. */
  | 'CANNOT_REMOVE_OWNER';

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
  FREE_ACCESS_EXPIRED_NEW_CAPACITY_DENIED: 'Free access for this account has expired, so new family members cannot be invited.',
  NOT_PENDING: 'This invitation is no longer pending and its role can no longer be changed.',
  CANNOT_REMOVE_SELF: 'You cannot remove your own membership from this family.',
  CANNOT_REMOVE_OWNER: 'The family owner cannot be removed.',
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
  private readonly newCapacityAcquisitionPolicy: NewCapacityAcquisitionPolicy | null;

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
   * `entitlementRepository` is optional (null = capacity check AND seat
   * consumption both skipped) only because the same
   * PARENT_MEMBER_CONSUMPTION_BINDING_REQUIRED gap this constructor closes
   * means some callers (e.g. lower-level unit tests of the invitation
   * lifecycle alone) legitimately don't care about billing capacity;
   * production wiring (buildServer.ts) must supply a real one.
   *
   * `newCapacityAcquisitionPolicy` is the FREE_ACCESS_ENFORCEMENT_V1 gate.
   * deriveFreeAccessStatus.ts's frozen contract names exactly three
   * new-capacity-consuming operations denied after expiry -- "device
   * enrollment, parent-member invite, new non-billing commercial
   * activation" -- and issuing a parent-member invitation is the second of
   * them. Optional/`null`-defaulted for the SAME reason (and with the same
   * `?.` call shape) as SlotReservationService's and ChangeRequestService's
   * own constructor parameters: lower-level unit tests of the invitation
   * lifecycle alone legitimately supply none. Production wiring (main.ts)
   * must pass the SAME FreeAccessAcquisitionPolicy instance those two
   * services already share.
   */
  constructor(
    repository: FamilyMemberInvitationRepository,
    authorization: ParentActionAuthorizationService,
    now: () => Date = () => new Date(),
    auditService: FamilyAuditService = new FamilyAuditService(new InMemoryFamilyAuditRepository()),
    accountBinder: FamilyMemberAccountBinder = new NoopFamilyMemberAccountBinder(),
    entitlementRepository: EntitlementRepository | null = null,
    newCapacityAcquisitionPolicy: NewCapacityAcquisitionPolicy | null = null,
  ) {
    this.repository = repository;
    this.authorization = authorization;
    this.entitlementRepository = entitlementRepository;
    this.now = now;
    this.auditService = auditService;
    this.accountBinder = accountBinder;
    this.newCapacityAcquisitionPolicy = newCapacityAcquisitionPolicy;
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

    // FREE_ACCESS_ENFORCEMENT_V1 acquisition gate -- the "parent-member
    // invite" arm of deriveFreeAccessStatus.ts's frozen "Denied after
    // expiry" list, alongside SlotReservationService (device enrollment)
    // and ChangeRequestService (new non-billing commercial activation).
    //
    // Ordered AFTER authorize() so an unauthorized caller can never use
    // this endpoint as an oracle for another family's free-access state,
    // and BEFORE every read/write below so no duplicate-detection or
    // entitlement query runs for a denied acquisition. Only createInvitation
    // is gated: revoke/changeRole/remove and acceptInvitation consume no
    // NEW capacity (acceptance draws on the seat this invitation already
    // counted against the limit), and the frozen contract's "Allowed after
    // EXPIRED" arm explicitly preserves existing-protection continuity.
    //
    // Translated into this domain's own error code exactly as
    // InvitationService and FamilyCommercialService already translate it --
    // FreeAccessEnforcementError's own doc comment requires a call site to
    // surface a coded, non-silent response, and this file's HTTP adapter
    // (familyMemberRoutes.ts) only maps FamilyMemberInvitationError; an
    // un-translated throw would reach the client as a bare 500.
    if (this.newCapacityAcquisitionPolicy) {
      try {
        await this.newCapacityAcquisitionPolicy.assertAllowed(input.familyId, createdAt);
      } catch (error) {
        if (error instanceof FreeAccessEnforcementError) throw new FamilyMemberInvitationError('FREE_ACCESS_EXPIRED_NEW_CAPACITY_DENIED');
        throw error;
      }
    }

    const invitedEmailHash = hashInvitedEmail(input.invitedEmail);

    const existingPending = await this.repository.findPendingByFamilyAndEmailHash(input.familyId, invitedEmailHash);
    if (existingPending && !(await this.isExpiredNow(existingPending))) {
      throw new FamilyMemberInvitationError('DUPLICATE_PENDING_INVITATION');
    }

    // EFFECTIVE capacity, not the base entitlement column: this error's own
    // doc comment above promises "including complimentary capacity", and
    // EntitlementRepository.getEffectiveSnapshotForFamily is this codebase's
    // declared single source of truth for it (base parentMemberLimit + the
    // family's ACTIVE PARENT_MEMBER_CAPACITY grants -- see
    // complimentary/EffectiveEntitlementCapacity.ts's header). Reading
    // getForFamily().parentMemberLimit instead denied invitations a
    // complimentary grant had genuinely paid for.
    if (this.entitlementRepository) {
      const snapshot = await this.entitlementRepository.getEffectiveSnapshotForFamily(input.familyId, createdAt);
      if (snapshot) {
        const pending = await this.repository.listForFamily(input.familyId);
        const pendingCount = pending.filter((r) => r.status === 'PENDING' && !this.isExpired(r)).length;
        if (snapshot.parentMemberUsed + pendingCount >= snapshot.effectiveParentMemberLimit) {
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
   * Removes an already-ACCEPTED family member: clears the target account's
   * own family_id binding and releases the parent-member seat it consumed,
   * atomically, in the SAME transaction -- the mirror image of
   * acceptInvitation's own seat consumption (see
   * FamilyMemberInvitationRepository.removeMemberAtomically's own doc
   * comment for the guarded-UPDATE + disambiguating-SELECT shape and the
   * OWNER-protection reasoning: this schema has no durable OWNER-role
   * column reachable from this domain -- genuine role resolution is
   * TrustSetRoleResolver's job, and that source is out of this method's
   * scope entirely -- so the Owner is identified structurally instead: the
   * one account bound to a family that never joined it via an ACCEPTED
   * invitation, per ParentAccountService.attemptFamilyGenesis's own "no
   * join-an-existing-family path" invariant).
   *
   * `actorAccountId` is the ACTING parent's own account id (from their
   * family session, exactly like createInvitation's invitedByAccountId) --
   * distinct from `actorDeviceId` (used only for authorize()'s trust-set
   * actor resolution). Removing your OWN account through this path is
   * refused (CANNOT_REMOVE_SELF): this operation models one parent acting
   * on ANOTHER parent's membership (doc 18's "remove non-owner parent"
   * row), never a self-service "leave this family" flow -- this codebase
   * defines no semantics for that (would this account's own devices lose
   * access mid-session? no route here answers that), so it is refused
   * rather than guessed at. Checked before authorize() so a self-targeting
   * call never even reaches the authorization/audit layer.
   *
   * Resolves with the real, durable FamilyAuditRecord.eventId this removal
   * produced (never a client-synthesized placeholder) -- the HTTP route
   * surfaces it directly so a caller (e.g. parent-web's
   * FamilyAuthorityGateway.removeMember, whose own return type is `{
   * auditEventId: string }`) has a genuine correlation id, not a
   * fabricated one.
   */
  async removeMember(
    familyId: OpaqueFamilyId,
    targetAccountId: OpaqueAccountId,
    actorAccountId: OpaqueAccountId,
    actorDeviceId: OpaqueAccountId,
  ): Promise<{ auditEventId: string }> {
    if (targetAccountId === actorAccountId) throw new FamilyMemberInvitationError('CANNOT_REMOVE_SELF');
    this.authorizeFamilyOperation(familyId, actorDeviceId, 'REMOVE_NON_OWNER_PARENT');

    const removedAt = this.now();
    const entitlementRepository = this.entitlementRepository;
    const releaseParentMemberSeat: RemoveMemberTransactionHook | undefined = entitlementRepository
      ? async (conn, fId): Promise<void> => {
          const locked = await entitlementRepository.lockForFamily(conn, fId);
          if (!locked) return;
          await entitlementRepository.adjustParentMemberUsedCount(conn, fId, -1, removedAt);
        }
      : undefined;

    const result = await this.repository.removeMemberAtomically(familyId, targetAccountId, removedAt, releaseParentMemberSeat);
    switch (result.outcome) {
      case 'REMOVED': {
        const auditRecord = await this.auditService.record({
          familyId,
          actionType: 'REMOVE_NON_OWNER_PARENT',
          actorDeviceId,
          actorMemberId: null,
          targetScope: { kind: 'MEMBER', id: targetAccountId },
          authorizationRole: null,
          trustSetEpoch: 0,
          policyRevision: null,
          clientMonotonicSequence: null,
          resultStatus: 'SUCCESS',
          targetAcknowledgementCount: 0,
          reasonCategory: null,
          correlationId: targetAccountId,
          actionId: null,
        });
        return { auditEventId: auditRecord.eventId };
      }
      case 'NOT_FOUND':
      case 'NOT_A_MEMBER':
        // Collapsed to the same NOT_FOUND a caller sees for a nonexistent
        // or foreign-family invitation elsewhere in this file -- an
        // already-removed member and a member who never existed in this
        // family are indistinguishable to the caller, same IDOR-avoidance
        // posture as the rest of this repository.
        throw new FamilyMemberInvitationError('NOT_FOUND');
      case 'CANNOT_REMOVE_OWNER':
        throw new FamilyMemberInvitationError('CANNOT_REMOVE_OWNER');
    }
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
   * this invitation's own row to ACCEPTED -- only ever for the account whose
   * own registered email the invitation was addressed to, enforced inside
   * the atomic UPDATE itself (see
   * FamilyMemberInvitationRepository.acceptAtomically's IDENTITY BINDING
   * contract), (b) consumes one parent-member seat in the SAME transaction
   * as that transition, and (c) best-effort binds the accepting account to
   * the family via the injected FamilyMemberAccountBinder, so the family_id
   * assignment happens atomically with acceptance from this service's point
   * of view, without this domain importing parentaccount/ directly.
   *
   * SEAT CONSUMPTION: createInvitation's capacity check counts
   * `parentMemberUsed + still-PENDING invitations`, but nothing ever raised
   * the used counter (EntitlementRepository.adjustParentMemberUsedCount had
   * no caller anywhere in the backend), so an accepted member consumed no
   * seat and the limit was unenforceable once invitations left PENDING. The
   * increment runs on the acceptance transaction's OWN connection, after the
   * invitation row has flipped and before it commits, so the counter can
   * never drift from the lifecycle: if the adjustment throws, the whole
   * acceptance rolls back. The family's row is locked first
   * (lockForFamily), as that repository's contract requires. A family with
   * no account_entitlements row yet has no seat ledger to charge and is
   * left alone, matching createInvitation's own "no row = no capacity
   * check" behaviour.
   */
  async acceptInvitation(invitationId: FamilyMemberInvitationId, acceptingAccountId: OpaqueAccountId): Promise<FamilyMemberInvitationRecord> {
    const acceptedAt = this.now();
    const entitlementRepository = this.entitlementRepository;
    const consumeParentMemberSeat = entitlementRepository
      ? async (conn: PoolConnection, record: FamilyMemberInvitationRecord): Promise<void> => {
          const locked = await entitlementRepository.lockForFamily(conn, record.familyId);
          if (!locked) return;
          await entitlementRepository.adjustParentMemberUsedCount(conn, record.familyId, 1, acceptedAt);
        }
      : undefined;
    const result = await this.repository.acceptAtomically(invitationId, acceptingAccountId, acceptedAt, consumeParentMemberSeat);
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
