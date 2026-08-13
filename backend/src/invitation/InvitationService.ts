import { randomUUID } from 'node:crypto';
import { generateInvitationToken, hashInvitationToken, isPlausibleInvitationToken } from './token.js';
import { computeExpiryInstant, resolveInvitationTtlMs } from './policy.js';
import type { InvitationRepository, RedemptionResult } from './InvitationRepository.js';
import type {
  InvitationRecord,
  InvitationId,
  OpaqueFamilyId,
  Platform,
  RequestedProtectionMode,
} from './types.js';
import { FamilyAuditService, InMemoryFamilyAuditRepository } from '../familyrbac/FamilyAuditStore.js';

export type InvitationErrorCode =
  | 'INVALID_TOKEN'
  | 'NOT_FOUND'
  | 'EXPIRED'
  | 'REVOKED'
  | 'ALREADY_REDEEMED';

/** Message text is always a fixed, generic string per code — never interpolates the raw token or family data. */
export class InvitationError extends Error {
  readonly code: InvitationErrorCode;
  constructor(code: InvitationErrorCode) {
    super(INVITATION_ERROR_MESSAGES[code]);
    this.name = 'InvitationError';
    this.code = code;
  }
}

const INVITATION_ERROR_MESSAGES: Record<InvitationErrorCode, string> = {
  INVALID_TOKEN: 'Invitation token is malformed.',
  NOT_FOUND: 'Invitation was not found.',
  EXPIRED: 'Invitation has expired.',
  REVOKED: 'Invitation was revoked.',
  ALREADY_REDEEMED: 'Invitation was already redeemed.',
};

export interface CreateInvitationInput {
  familyId: OpaqueFamilyId;
  platform: Platform;
  requestedProtectionMode: RequestedProtectionMode;
  /** Optional; omit to use the server default. Server rejects anything above the policy maximum -- see policy.ts. */
  ttlMs?: number;
}

export interface CreateInvitationResult {
  record: InvitationRecord;
  /** Returned exactly once, to construct the one-time link/QR. Never persisted or logged. */
  rawToken: string;
}

const TERMINAL_STATUSES: ReadonlySet<InvitationStatusLike> = new Set(['REDEEMED', 'REVOKED']);
type InvitationStatusLike = InvitationRecord['status'];

export class InvitationService {
  private readonly repository: InvitationRepository;
  private readonly now: () => Date;
  private readonly auditService: FamilyAuditService;

  /**
   * `auditService` defaults to a private, per-instance in-memory reference
   * store when not supplied -- production wiring (main.ts) should inject a
   * SHARED FamilyAuditService instance so records from every family-rbac
   * event source land in one place. See FamilyAuditStore.ts's own doc
   * comment: this is never a PCA server audit log or a durable store, only
   * the in-memory reference implementation the audit domain itself ships.
   */
  constructor(
    repository: InvitationRepository,
    now: () => Date = () => new Date(),
    auditService: FamilyAuditService = new FamilyAuditService(new InMemoryFamilyAuditRepository()),
  ) {
    this.repository = repository;
    this.now = now;
    this.auditService = auditService;
  }

  async createInvitation(input: CreateInvitationInput): Promise<CreateInvitationResult> {
    const ttlMs = resolveInvitationTtlMs(input.ttlMs);
    const { rawToken, tokenHash } = generateInvitationToken();
    const createdAt = this.now();
    const record: InvitationRecord = {
      invitationId: randomUUID(),
      familyId: input.familyId,
      tokenHash,
      platform: input.platform,
      requestedProtectionMode: input.requestedProtectionMode,
      status: 'CREATED',
      createdAt,
      expiresAt: computeExpiryInstant(createdAt, ttlMs),
      openedAt: null,
      redeemedAt: null,
      revokedAt: null,
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
    return { record, rawToken };
  }

  async markOpened(rawToken: string): Promise<InvitationRecord> {
    const record = await this.loadRedeemable(rawToken);
    if (record.status === 'CREATED') {
      return this.repository.markOpened(record.invitationId, this.now());
    }
    return record;
  }

  /**
   * The bearer token alone authorizes only this narrow transition. It never
   * accepts a caller-supplied familyId, policy, or PIN — the resulting
   * record's familyId is authoritative and comes solely from creation time.
   */
  async redeemInvitation(rawToken: string): Promise<InvitationRecord> {
    const record = await this.loadRedeemable(rawToken);
    const result: RedemptionResult = await this.repository.redeemAtomically(record.invitationId, this.now());
    switch (result.outcome) {
      case 'REDEEMED':
        return result.record;
      case 'ALREADY_REDEEMED':
        throw new InvitationError('ALREADY_REDEEMED');
      case 'REVOKED':
        throw new InvitationError('REVOKED');
      case 'EXPIRED':
        throw new InvitationError('EXPIRED');
      case 'NOT_FOUND':
        throw new InvitationError('NOT_FOUND');
    }
  }

  async revokeInvitation(invitationId: InvitationId): Promise<InvitationRecord> {
    return this.repository.revoke(invitationId, this.now());
  }

  /** Family-scoped read: wrong family is indistinguishable from nonexistent (IDOR defense, matching the device/pairing domains' pattern). */
  async getInvitationForFamily(familyId: OpaqueFamilyId, invitationId: InvitationId): Promise<InvitationRecord> {
    const record = await this.repository.findByIdForFamily(familyId, invitationId);
    if (!record) throw new InvitationError('NOT_FOUND');
    return { ...record, status: this.effectiveStatus(record) };
  }

  async listInvitationsForFamily(familyId: OpaqueFamilyId): Promise<InvitationRecord[]> {
    const records = await this.repository.listForFamily(familyId);
    return records.map((record) => ({ ...record, status: this.effectiveStatus(record) }));
  }

  /** Family-scoped revoke: the UPDATE itself is filtered by family_id (see revokeForFamily), so a caller can never revoke another family's invitation by guessing an id. */
  async revokeInvitationForFamily(familyId: OpaqueFamilyId, invitationId: InvitationId): Promise<InvitationRecord> {
    const record = await this.repository.revokeForFamily(familyId, invitationId, this.now());
    if (!record) throw new InvitationError('NOT_FOUND');
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

  async resolveInvitationState(rawToken: string): Promise<InvitationStatusLike> {
    const record = await this.findByToken(rawToken);
    if (!record) throw new InvitationError('NOT_FOUND');
    return this.effectiveStatus(record);
  }

  private async loadRedeemable(rawToken: string): Promise<InvitationRecord> {
    const record = await this.findByToken(rawToken);
    if (!record) throw new InvitationError('NOT_FOUND');
    if (record.status === 'REVOKED') throw new InvitationError('REVOKED');
    if (record.status === 'REDEEMED') throw new InvitationError('ALREADY_REDEEMED');
    if (this.isExpired(record)) throw new InvitationError('EXPIRED');
    return record;
  }

  private async findByToken(rawToken: string): Promise<InvitationRecord | null> {
    if (!isPlausibleInvitationToken(rawToken)) throw new InvitationError('INVALID_TOKEN');
    return this.repository.findByTokenHash(hashInvitationToken(rawToken));
  }

  private isExpired(record: InvitationRecord): boolean {
    return this.now().getTime() >= record.expiresAt.getTime();
  }

  private effectiveStatus(record: InvitationRecord): InvitationStatusLike {
    if (TERMINAL_STATUSES.has(record.status)) return record.status;
    return this.isExpired(record) ? 'EXPIRED' : record.status;
  }
}
