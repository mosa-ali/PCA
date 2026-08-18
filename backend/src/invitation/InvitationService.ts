import { randomUUID } from 'node:crypto';
import { generateInvitationToken, hashInvitationToken, isPlausibleInvitationToken } from './token.js';
import { computeExpiryInstant, resolveInvitationTtlMs } from './policy.js';
import type { InvitationRepository, RedemptionResult, TransitionResult } from './InvitationRepository.js';
import type {
  InvitationRecord,
  InvitationId,
  OpaqueFamilyId,
  Platform,
  RequestedProtectionMode,
  AgeUxTier,
  InitialPolicyProfile,
} from './types.js';
import { FamilyAuditService, InMemoryFamilyAuditRepository } from '../familyrbac/FamilyAuditStore.js';
import type { SlotReservationService } from '../entitlements/slots/SlotReservationService.js';
import { FreeAccessEnforcementError } from '../parentaccount/freeaccess/types.js';

export type InvitationErrorCode =
  | 'INVALID_TOKEN'
  | 'NOT_FOUND'
  | 'EXPIRED'
  | 'REVOKED'
  | 'ALREADY_REDEEMED'
  /** PCA-ADD-ENR-005: an INSTALL_REQUIRED/APP_INSTALLED/AUTHORIZATION_REQUIRED transition was requested out of order (e.g. requesting an earlier state than the invitation has already reached). Never leaks the current status beyond this generic code. */
  | 'INVALID_STATE'
  | 'FREE_ACCESS_EXPIRED_NEW_CAPACITY_DENIED';

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
  INVALID_STATE: 'Invitation is not in a state that allows this action.',
  FREE_ACCESS_EXPIRED_NEW_CAPACITY_DENIED: 'New managed-device capacity is unavailable after free access expires.',
};

export interface CreateInvitationInput {
  familyId: OpaqueFamilyId;
  platform: Platform;
  requestedProtectionMode: RequestedProtectionMode;
  childProfileId?: string | null;
  ageUxTier?: AgeUxTier;
  initialPolicyProfile?: InitialPolicyProfile;
  /** Optional; omit to use the server default. Server rejects anything above the policy maximum -- see policy.ts. */
  ttlMs?: number;
}

export interface CreateInvitationResult {
  record: InvitationRecord;
  /** Returned exactly once, to construct the one-time link/QR. Never persisted or logged. */
  rawToken: string;
}

const TERMINAL_STATUSES: ReadonlySet<InvitationStatusLike> = new Set(['REDEEMED', 'REVOKED', 'EXPIRED']);
type InvitationStatusLike = InvitationRecord['status'];

export class InvitationService {
  private readonly repository: InvitationRepository;
  private readonly now: () => Date;
  private readonly auditService: FamilyAuditService;
  private readonly slotReservationService: SlotReservationService | null;

  /**
   * `auditService` defaults to a private, per-instance in-memory reference
   * store when not supplied -- production wiring (main.ts) should inject a
   * SHARED FamilyAuditService instance so records from every family-rbac
   * event source land in one place. See FamilyAuditStore.ts's own doc
   * comment: this is never a PCA server audit log or a durable store, only
   * the in-memory reference implementation the audit domain itself ships.
   *
   * `slotReservationService` (PCA-PA-2, optional -- defaults to null so
   * every existing caller/test that constructs InvitationService without
   * it keeps working unchanged) implements PCA-ADD-PA-022: when supplied,
   * a managed-device slot is reserved BEFORE the invitation record is
   * persisted, and createInvitation throws (creating no invitation at all)
   * if no slot is available -- never the reverse order. See
   * SlotReservationService/managed_device_slot_reservations.
   */
  constructor(
    repository: InvitationRepository,
    now: () => Date = () => new Date(),
    auditService: FamilyAuditService = new FamilyAuditService(new InMemoryFamilyAuditRepository()),
    slotReservationService: SlotReservationService | null = null,
  ) {
    this.repository = repository;
    this.now = now;
    this.auditService = auditService;
    this.slotReservationService = slotReservationService;
  }

  async createInvitation(input: CreateInvitationInput): Promise<CreateInvitationResult> {
    if (!isPlatformProtectionModeCompatible(input.platform, input.requestedProtectionMode)) throw new RangeError('invalid protection mode');
    const childProfileId = normalizeChildProfileId(input.childProfileId);
    const ageUxTier = input.ageUxTier ?? 'YOUNG_CHILD';
    const initialPolicyProfile = input.initialPolicyProfile ?? 'BALANCED';
    if (!isAgeUxTier(ageUxTier) || !isInitialPolicyProfile(initialPolicyProfile)) throw new RangeError('invalid enrollment profile');
    const ttlMs = resolveInvitationTtlMs(input.ttlMs);
    const { rawToken, tokenHash } = generateInvitationToken();
    const createdAt = this.now();
    const invitationId = randomUUID();
    const expiresAt = computeExpiryInstant(createdAt, ttlMs);

    // PCA-ADD-PA-022/038: reservation happens first, and must succeed,
    // before any usable invitation token is ever persisted. A device
    // platform is always a managed-device enrollment invitation in this
    // codebase (Platform is ANDROID/IOS -- see types.ts); parent-member
    // invitations are a separate, not-yet-implemented family-RBAC flow
    // this service does not own.
    if (this.slotReservationService) {
      try {
        await this.slotReservationService.reserveForInvitation(input.familyId, invitationId, expiresAt);
      } catch (error) {
        if (error instanceof FreeAccessEnforcementError) throw new InvitationError('FREE_ACCESS_EXPIRED_NEW_CAPACITY_DENIED');
        throw error;
      }
    }

    const record: InvitationRecord = {
      invitationId,
      familyId: input.familyId,
      tokenHash,
      platform: input.platform,
      requestedProtectionMode: input.requestedProtectionMode,
      childProfileId,
      ageUxTier,
      initialPolicyProfile,
      status: 'CREATED',
      createdAt,
      expiresAt,
      openedAt: null,
      installRequiredAt: null,
      appInstalledAt: null,
      authorizationRequiredAt: null,
      redeemedAt: null,
      expiredAt: null,
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
   * PCA-ADD-ENR-005/008: the child device calls this when it determines the
   * app is not yet installed, immediately before handing off to the
   * platform store. Idempotent -- calling it again (e.g. the device retries
   * after a network blip) while still in a valid pre-transition state simply
   * re-confirms the same INSTALL_REQUIRED status rather than erroring.
   */
  async markInstallRequired(rawToken: string): Promise<InvitationRecord> {
    return this.applyForwardTransition(rawToken, (invitationId, at) =>
      this.repository.markInstallRequired(invitationId, at),
    );
  }

  /** PCA-ADD-ENR-005/008: the device calls this on resuming enrollment via the App Link/store-install continuation. */
  async markAppInstalled(rawToken: string): Promise<InvitationRecord> {
    return this.applyForwardTransition(rawToken, (invitationId, at) =>
      this.repository.markAppInstalled(invitationId, at),
    );
  }

  /** PCA-ADD-ENR-005: the device calls this once its bootstrap key material is prepared and it is awaiting parent-side authorization before redemption completes. */
  async markAuthorizationRequired(rawToken: string): Promise<InvitationRecord> {
    return this.applyForwardTransition(rawToken, (invitationId, at) =>
      this.repository.markAuthorizationRequired(invitationId, at),
    );
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
    const record = await this.repository.revoke(invitationId, this.now());
    if (this.slotReservationService) await this.slotReservationService.releaseForInvitation(invitationId, 'REVOKED');
    return record;
  }

  /** Family-scoped read: wrong family is indistinguishable from nonexistent (IDOR defense, matching the device/pairing domains' pattern). */
  async getInvitationForFamily(familyId: OpaqueFamilyId, invitationId: InvitationId): Promise<InvitationRecord> {
    const record = await this.repository.findByIdForFamily(familyId, invitationId);
    if (!record) throw new InvitationError('NOT_FOUND');
    return this.persistExpiryIfDue(record);
  }

  async listInvitationsForFamily(familyId: OpaqueFamilyId): Promise<InvitationRecord[]> {
    const records = await this.repository.listForFamily(familyId);
    return Promise.all(records.map((record) => this.persistExpiryIfDue(record)));
  }

  /** Family-scoped revoke: the UPDATE itself is filtered by family_id (see revokeForFamily), so a caller can never revoke another family's invitation by guessing an id. */
  async revokeInvitationForFamily(familyId: OpaqueFamilyId, invitationId: InvitationId): Promise<InvitationRecord> {
    const record = await this.repository.revokeForFamily(familyId, invitationId, this.now());
    if (!record) throw new InvitationError('NOT_FOUND');
    if (this.slotReservationService) await this.slotReservationService.releaseForInvitation(invitationId, 'REVOKED');
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
    return (await this.persistExpiryIfDue(record)).status;
  }

  /**
   * Shared plumbing for the three INSTALL_REQUIRED/APP_INSTALLED/
   * AUTHORIZATION_REQUIRED forward-progress transitions: resolves the
   * bearer token (persisting an EXPIRED transition first if the record is
   * past due), rejects the already-terminal cases with the SAME generic
   * error codes redemption uses, then delegates to the given repository
   * transition call and maps its TransitionResult back to a record or a
   * thrown InvitationError.
   */
  private async applyForwardTransition(
    rawToken: string,
    repositoryCall: (invitationId: InvitationId, at: Date) => Promise<TransitionResult>,
  ): Promise<InvitationRecord> {
    const found = await this.findByToken(rawToken);
    if (!found) throw new InvitationError('NOT_FOUND');
    const record = await this.persistExpiryIfDue(found);
    if (record.status === 'REVOKED') throw new InvitationError('REVOKED');
    if (record.status === 'REDEEMED') throw new InvitationError('ALREADY_REDEEMED');
    if (record.status === 'EXPIRED') throw new InvitationError('EXPIRED');

    const result = await repositoryCall(record.invitationId, this.now());
    switch (result.outcome) {
      case 'TRANSITIONED':
        return result.record;
      case 'ALREADY_IN_STATE':
        return result.record;
      case 'ALREADY_REDEEMED':
        throw new InvitationError('ALREADY_REDEEMED');
      case 'REVOKED':
        throw new InvitationError('REVOKED');
      case 'EXPIRED':
        throw new InvitationError('EXPIRED');
      case 'NOT_FOUND':
        throw new InvitationError('NOT_FOUND');
      case 'INVALID_STATE':
        throw new InvitationError('INVALID_STATE');
    }
  }

  private async loadRedeemable(rawToken: string): Promise<InvitationRecord> {
    const found = await this.findByToken(rawToken);
    if (!found) throw new InvitationError('NOT_FOUND');
    const record = await this.persistExpiryIfDue(found);
    if (record.status === 'REVOKED') throw new InvitationError('REVOKED');
    if (record.status === 'REDEEMED') throw new InvitationError('ALREADY_REDEEMED');
    if (record.status === 'EXPIRED') throw new InvitationError('EXPIRED');
    return record;
  }

  private async findByToken(rawToken: string): Promise<InvitationRecord | null> {
    if (!isPlausibleInvitationToken(rawToken)) throw new InvitationError('INVALID_TOKEN');
    return this.repository.findByTokenHash(hashInvitationToken(rawToken));
  }

  private isExpired(record: InvitationRecord): boolean {
    return this.now().getTime() >= record.expiresAt.getTime();
  }

  /**
   * PCA-ADD-ENR-005: EXPIRED is now a real, audited, persisted transition
   * rather than a value computed only on read. Any code path that observes
   * a non-terminal record past its expiresAt calls this, which writes the
   * transition via InvitationRepository.expireIfDue (itself idempotent and
   * a no-op for records that are not yet due or already terminal) and
   * returns the now-authoritative persisted record.
   */
  private async persistExpiryIfDue(record: InvitationRecord): Promise<InvitationRecord> {
    if (TERMINAL_STATUSES.has(record.status) || !this.isExpired(record)) return record;
    return this.repository.expireIfDue(record.invitationId, this.now());
  }
}

const CHILD_PROFILE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const VALID_AGE_UX_TIERS: ReadonlySet<string> = new Set(['YOUNG_CHILD', 'TEEN']);
const VALID_INITIAL_POLICY_PROFILES: ReadonlySet<string> = new Set(['BALANCED', 'STRICT']);

function normalizeChildProfileId(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  if (!CHILD_PROFILE_ID_PATTERN.test(value)) throw new RangeError('invalid child profile id');
  return value;
}

function isAgeUxTier(value: string): value is AgeUxTier {
  return VALID_AGE_UX_TIERS.has(value);
}

function isInitialPolicyProfile(value: string): value is InitialPolicyProfile {
  return VALID_INITIAL_POLICY_PROFILES.has(value);
}

function isPlatformProtectionModeCompatible(platform: Platform, mode: RequestedProtectionMode): boolean {
  return platform === 'IOS' ? mode === 'IOS_STANDARD' : mode === 'ANDROID_STANDARD' || mode === 'ANDROID_PROTECTED';
}
