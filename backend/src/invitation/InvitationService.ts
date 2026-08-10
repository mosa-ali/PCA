import { randomUUID } from 'node:crypto';
import { generateInvitationToken, hashInvitationToken, isPlausibleInvitationToken } from './token.js';
import type { InvitationRepository, RedemptionResult } from './InvitationRepository.js';
import type {
  InvitationRecord,
  InvitationId,
  OpaqueFamilyId,
  Platform,
  RequestedProtectionMode,
} from './types.js';

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
  ttlMs: number;
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

  constructor(repository: InvitationRepository, now: () => Date = () => new Date()) {
    this.repository = repository;
    this.now = now;
  }

  async createInvitation(input: CreateInvitationInput): Promise<CreateInvitationResult> {
    if (!Number.isFinite(input.ttlMs) || input.ttlMs <= 0) {
      throw new RangeError('ttlMs must be a positive duration in milliseconds.');
    }
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
      expiresAt: new Date(createdAt.getTime() + input.ttlMs),
      openedAt: null,
      redeemedAt: null,
      revokedAt: null,
    };
    await this.repository.create(record);
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
