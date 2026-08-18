import type { OpaqueFamilyId, SlotReleaseReason, SlotReservationRecord } from '../types.js';
import type { NewCapacityAcquisitionPolicy } from '../../parentaccount/freeaccess/FreeAccessAcquisitionPolicy.js';
import type { SlotReservationRepository } from './SlotReservationRepository.js';

export type SlotReservationErrorCode = 'NO_AVAILABLE_SLOT' | 'ENTITLEMENT_NOT_FOUND';

export class SlotReservationError extends Error {
  readonly code: SlotReservationErrorCode;
  constructor(code: SlotReservationErrorCode) {
    super(code === 'NO_AVAILABLE_SLOT' ? 'No managed-device slot is currently available for this family.' : 'No entitlement record exists for this family.');
    this.name = 'SlotReservationError';
    this.code = code;
  }
}

/**
 * PCA-ADD-PA-022: "slot reservation must happen before a usable enrollment
 * invitation/token becomes available" -- callers (InvitationService) MUST
 * call reserveForInvitation and receive success BEFORE persisting a usable
 * invitation, never the reverse.
 */
export class SlotReservationService {
  private readonly repository: SlotReservationRepository;
  private readonly now: () => Date;
  private readonly newCapacityAcquisitionPolicy: NewCapacityAcquisitionPolicy | null;

  constructor(repository: SlotReservationRepository, now: () => Date = () => new Date(), newCapacityAcquisitionPolicy: NewCapacityAcquisitionPolicy | null = null) {
    this.repository = repository;
    this.now = now;
    this.newCapacityAcquisitionPolicy = newCapacityAcquisitionPolicy;
  }

  async reserveForInvitation(familyId: OpaqueFamilyId, invitationId: string, expiresAt: Date): Promise<SlotReservationRecord> {
    // A retry of an already-created reservation is not a new acquisition and
    // must remain idempotent even if FREE_ACCESS expired between attempts.
    const existing = await this.repository.findByInvitationId(invitationId);
    if (!existing) await this.newCapacityAcquisitionPolicy?.assertAllowed(familyId, this.now());
    const result = await this.repository.reserve(familyId, invitationId, this.now(), expiresAt);
    switch (result.outcome) {
      case 'RESERVED':
      case 'ALREADY_RESERVED_FOR_INVITATION':
        return result.record;
      case 'NO_AVAILABLE_SLOT':
        throw new SlotReservationError('NO_AVAILABLE_SLOT');
      case 'ENTITLEMENT_NOT_FOUND':
        throw new SlotReservationError('ENTITLEMENT_NOT_FOUND');
    }
  }

  /** Idempotent -- see MySqlSlotReservationRepository.releaseByInvitationId. Never throws for an unknown/already-released invitation. */
  async releaseForInvitation(invitationId: string, reason: SlotReleaseReason): Promise<void> {
    await this.repository.releaseByInvitationId(invitationId, reason, this.now());
  }

  async listForFamily(familyId: OpaqueFamilyId): Promise<SlotReservationRecord[]> {
    return this.repository.listForFamily(familyId);
  }
}
