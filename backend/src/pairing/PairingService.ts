import { computeKeyFingerprint } from './fingerprint.js';
import type { DeviceRepository } from '../device/DeviceRepository.js';
import type { DeviceId, OpaqueFamilyId } from '../device/types.js';
import type { PairingRequestView } from './types.js';
import { FamilyAuditService, InMemoryFamilyAuditRepository } from '../familyrbac/FamilyAuditStore.js';

export type PairingErrorCode = 'NOT_FOUND' | 'INVALID_STATE' | 'SELF_APPROVAL_DENIED';

/** Fixed, generic messages -- identical for "no such device" and "device belongs to a different family" (IDOR defense, matching the device domain's own pattern). */
export class PairingError extends Error {
  readonly code: PairingErrorCode;
  constructor(code: PairingErrorCode) {
    super(PAIRING_ERROR_MESSAGES[code]);
    this.name = 'PairingError';
    this.code = code;
  }
}

const PAIRING_ERROR_MESSAGES: Record<PairingErrorCode, string> = {
  NOT_FOUND: 'Pairing request was not found.',
  INVALID_STATE: 'Pairing request is not in a state that permits this operation.',
  SELF_APPROVAL_DENIED: 'This account registered this endpoint and cannot also confirm it.',
};

/**
 * Thin, family-scoped facade over the device directory: exposes pairing
 * request state and public-key fingerprints to an ALREADY-authorized
 * parent (the caller's authorizedFamilyId must already be established by
 * AuthzService before reaching here -- this service does not itself check
 * account-to-family scope). Confirmation is service-side bookkeeping only,
 * never family E2EE trust authority (doc 09 Section 3.2).
 */
export class PairingService {
  private readonly deviceRepository: DeviceRepository;
  private readonly now: () => Date;
  private readonly auditService: FamilyAuditService;

  constructor(
    deviceRepository: DeviceRepository,
    now: () => Date = () => new Date(),
    auditService: FamilyAuditService = new FamilyAuditService(new InMemoryFamilyAuditRepository()),
  ) {
    this.deviceRepository = deviceRepository;
    this.now = now;
    this.auditService = auditService;
  }

  async getPairingRequest(authorizedFamilyId: OpaqueFamilyId, deviceId: DeviceId): Promise<PairingRequestView> {
    const device = await this.deviceRepository.findDeviceForFamily(authorizedFamilyId, deviceId);
    if (!device) throw new PairingError('NOT_FOUND');
    const keys = await this.deviceRepository.findKeysByDeviceForFamily(authorizedFamilyId, deviceId);
    const dsk = keys.find((k) => k.keyPurpose === 'DSK' && k.status === 'ACTIVE');
    const dek = keys.find((k) => k.keyPurpose === 'DEK' && k.status === 'ACTIVE');
    return {
      deviceId: device.deviceId,
      familyId: device.familyId,
      platform: device.platform,
      status: device.status,
      dskFingerprint: dsk ? computeKeyFingerprint(dsk.publicKey) : null,
      dekFingerprint: dek ? computeKeyFingerprint(dek.publicKey) : null,
    };
  }

  /** PAIRING_PENDING -> PAIRED only; idempotent; REVOKED/ACTIVE targets are INVALID_STATE. */
  async confirmPairing(
    authorizedFamilyId: OpaqueFamilyId,
    deviceId: DeviceId,
    confirmedByAccountId: string,
  ): Promise<PairingRequestView> {
    const result = await this.deviceRepository.confirmPairing(authorizedFamilyId, deviceId, confirmedByAccountId, this.now());
    if (result.outcome === 'DEVICE_NOT_FOUND') throw new PairingError('NOT_FOUND');
    if (result.outcome === 'SELF_APPROVAL_DENIED') throw new PairingError('SELF_APPROVAL_DENIED');
    if (result.outcome === 'INVALID_STATE') throw new PairingError('INVALID_STATE');
    await this.auditService.record({
      familyId: authorizedFamilyId,
      actionType: 'DEVICE_LIFECYCLE_TRANSITION',
      actorDeviceId: confirmedByAccountId,
      actorMemberId: null,
      targetScope: { kind: 'DEVICE', id: deviceId },
      authorizationRole: null,
      trustSetEpoch: 0,
      policyRevision: null,
      clientMonotonicSequence: null,
      resultStatus: 'SUCCESS',
      targetAcknowledgementCount: 0,
      reasonCategory: null,
      correlationId: null,
      actionId: null,
      freeTextNote: 'PAIRING_PENDING -> PAIRED',
    });
    return this.getPairingRequest(authorizedFamilyId, deviceId);
  }
}
