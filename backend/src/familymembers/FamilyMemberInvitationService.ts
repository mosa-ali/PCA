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

export type FamilyMemberInvitationErrorCode =
  | 'INVALID_INPUT'
  | 'NOT_FOUND'
  | 'EXPIRED'
  | 'REVOKED'
  | 'ALREADY_ACCEPTED'
  /** A PENDING invitation already exists for this exact (family, email) pair -- revoke it first rather than issuing a duplicate. */
  | 'DUPLICATE_PENDING_INVITATION';

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
};

const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days -- a person-invitation is not a one-time device bootstrap link, longer-lived than enrollment_invitations' short TTL is appropriate.
const TERMINAL_STATUSES: ReadonlySet<FamilyMemberInvitationStatus> = new Set(['ACCEPTED', 'EXPIRED', 'REVOKED']);

export interface CreateFamilyMemberInvitationInput {
  familyId: OpaqueFamilyId;
  invitedEmail: string;
  role: InvitedFamilyRole;
  invitedByAccountId: OpaqueAccountId;
  ttlMs?: number;
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
  private readonly now: () => Date;
  private readonly auditService: FamilyAuditService;
  private readonly accountBinder: FamilyMemberAccountBinder;

  /**
   * `auditService` defaults to a private, per-instance in-memory reference
   * store when not supplied -- production wiring should inject a SHARED
   * FamilyAuditService instance so records from every family-rbac event
   * source land in one place, exactly like InvitationService's own
   * constructor doc comment.
   */
  constructor(
    repository: FamilyMemberInvitationRepository,
    now: () => Date = () => new Date(),
    auditService: FamilyAuditService = new FamilyAuditService(new InMemoryFamilyAuditRepository()),
    accountBinder: FamilyMemberAccountBinder = new NoopFamilyMemberAccountBinder(),
  ) {
    this.repository = repository;
    this.now = now;
    this.auditService = auditService;
    this.accountBinder = accountBinder;
  }

  async createInvitation(input: CreateFamilyMemberInvitationInput): Promise<FamilyMemberInvitationRecord> {
    if (!isPlausibleInvitedEmail(input.invitedEmail)) throw new FamilyMemberInvitationError('INVALID_INPUT');
    if (!isInvitedFamilyRole(input.role)) throw new FamilyMemberInvitationError('INVALID_INPUT');
    const invitedEmailHash = hashInvitedEmail(input.invitedEmail);

    const existingPending = await this.repository.findPendingByFamilyAndEmailHash(input.familyId, invitedEmailHash);
    if (existingPending && !(await this.isExpiredNow(existingPending))) {
      throw new FamilyMemberInvitationError('DUPLICATE_PENDING_INVITATION');
    }

    const createdAt = this.now();
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
      actorDeviceId: 'SERVICE_SESSION',
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

  /** Family-scoped revoke: the UPDATE itself is filtered by family_id (see revokeForFamily), so a caller can never revoke another family's invitation by guessing an id. */
  async revokeInvitationForFamily(familyId: OpaqueFamilyId, invitationId: FamilyMemberInvitationId): Promise<FamilyMemberInvitationRecord> {
    const record = await this.repository.revokeForFamily(familyId, invitationId, this.now());
    if (!record) throw new FamilyMemberInvitationError('NOT_FOUND');
    await this.auditService.record({
      familyId,
      actionType: 'ROLE_REVOKE',
      actorDeviceId: 'SERVICE_SESSION',
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
