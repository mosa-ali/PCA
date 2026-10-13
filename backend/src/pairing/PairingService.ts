import { computeKeyFingerprint } from './fingerprint.js';
import type { DeviceRepository } from '../device/DeviceRepository.js';
import type { DeviceId, OpaqueFamilyId } from '../device/types.js';
import type { PairingFingerprintExpectation, PairingRequestView } from './types.js';
import { isKeyFingerprint } from './fingerprint.js';
import { FamilyAuditService, InMemoryFamilyAuditRepository } from '../familyrbac/FamilyAuditStore.js';

export type PairingErrorCode = 'NOT_FOUND' | 'INVALID_STATE' | 'SELF_APPROVAL_DENIED' | 'INVALID_FINGERPRINT' | 'FINGERPRINT_MISMATCH';

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
  INVALID_FINGERPRINT: 'The displayed device key fingerprints are required.',
  FINGERPRINT_MISMATCH: 'The device key fingerprints changed; refresh the pairing request.',
};

// Pairing timestamps are persisted to MySQL DATETIME(3), whose supported
// range is 1000-01-01 through 9999-12-31 23:59:59.999 UTC. Validate before
// calling a repository so test doubles and production storage share the same
// failure boundary.
const MIN_PAIRING_TIMESTAMP_MS = Date.UTC(1000, 0, 1, 0, 0, 0, 0);
const MAX_PAIRING_TIMESTAMP_MS = Date.UTC(9999, 11, 31, 23, 59, 59, 999);

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
  private auditAppendFailureCount = 0;

  constructor(
    deviceRepository: DeviceRepository,
    now: () => Date = () => new Date(),
    auditService: FamilyAuditService = new FamilyAuditService(new InMemoryFamilyAuditRepository()),
  ) {
    this.deviceRepository = deviceRepository;
    this.now = now;
    this.auditService = auditService;
  }

  private persistenceTimestamp(): Date {
    const timestamp: unknown = this.now();
    if (!(timestamp instanceof Date)) throw new TypeError('Pairing clock must return a valid persistence timestamp.');
    const milliseconds = timestamp.getTime();
    if (!Number.isFinite(milliseconds) || milliseconds < MIN_PAIRING_TIMESTAMP_MS ||
        milliseconds > MAX_PAIRING_TIMESTAMP_MS) {
      throw new TypeError('Pairing clock must return a valid persistence timestamp.');
    }
    return new Date(milliseconds);
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
    expectedFingerprints: PairingFingerprintExpectation,
  ): Promise<PairingRequestView> {
    if (!expectedFingerprints || !isKeyFingerprint(expectedFingerprints.expectedDskFingerprint) ||
        !(expectedFingerprints.expectedDekFingerprint === null || isKeyFingerprint(expectedFingerprints.expectedDekFingerprint))) {
      throw new PairingError('INVALID_FINGERPRINT');
    }
    const result = await this.deviceRepository.confirmPairing(
      authorizedFamilyId, deviceId, confirmedByAccountId, this.persistenceTimestamp(), { ...expectedFingerprints },
    );
    if (result.outcome === 'DEVICE_NOT_FOUND') throw new PairingError('NOT_FOUND');
    if (result.outcome === 'SELF_APPROVAL_DENIED') throw new PairingError('SELF_APPROVAL_DENIED');
    if (result.outcome === 'FINGERPRINT_MISMATCH') throw new PairingError('FINGERPRINT_MISMATCH');
    if (result.outcome === 'INVALID_STATE') throw new PairingError('INVALID_STATE');
    if (result.transitioned) {
      try {
        await this.auditService.record({
          familyId: authorizedFamilyId,
          actionType: 'DEVICE_LIFECYCLE_TRANSITION',
          // Browser account IDs are not device identities. This established
          // sentinel records the server/session origin without inventing a DSK.
          actorDeviceId: 'SERVICE_SESSION',
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
        this.auditAppendFailureCount = 0;
      } catch {
        // Pairing already committed in the device repository. Reporting an
        // operation failure would be false, and a retry cannot recreate the
        // one-shot transition audit without a shared transactional outbox.
        this.auditAppendFailureCount += 1;
        if (this.auditAppendFailureCount === 1 || this.auditAppendFailureCount % 100 === 0) {
          try {
            console.warn(JSON.stringify({ event: 'pairing_lifecycle_audit_append_failed',
              occurrences: this.auditAppendFailureCount }));
          } catch {
            // Diagnostics are best-effort too; a broken stderr sink cannot
            // turn a committed pairing transition into an apparent failure.
          }
        }
      }
    }
    return this.getPairingRequest(authorizedFamilyId, deviceId);
  }
}
