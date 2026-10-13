import { randomUUID } from 'node:crypto';
import { isPlausiblePublicKey } from './publicKey.js';
import type { DeviceRepository } from './DeviceRepository.js';
import type { DeviceId, OpaqueFamilyId } from './types.js';
import { FamilyAuditService, InMemoryFamilyAuditRepository } from '../familyrbac/FamilyAuditStore.js';

export type BrowserEndpointErrorCode = 'INVALID_PUBLIC_KEY' | 'DUPLICATE_KEY';

export class BrowserEndpointError extends Error {
  readonly code: BrowserEndpointErrorCode;
  constructor(code: BrowserEndpointErrorCode) {
    super({
      INVALID_PUBLIC_KEY: 'Endpoint public key is malformed.',
      DUPLICATE_KEY: 'This public key is already registered to a device.',
    }[code]);
    this.name = 'BrowserEndpointError';
    this.code = code;
  }
}

export interface RegisterEndpointResult {
  deviceId: DeviceId;
  status: 'PAIRING_PENDING';
}

// Match MySQL DATETIME(3)'s supported year range and DeviceDirectoryService's
// persistence guard so a broken injected/system clock fails before a device
// or key is created.
const MIN_DEVICE_TIMESTAMP_MS = Date.UTC(1000, 0, 1, 0, 0, 0, 0);
const MAX_DEVICE_TIMESTAMP_MS = Date.UTC(9999, 11, 31, 23, 59, 59, 999);

/**
 * PCA-FR-063 / doc 08 Section 8-style ceremony: registers a
 * service-authenticated browser's own non-extractable DSK (generated
 * client-side by parent-web's trustedEndpointKeyStore.ts, never exported)
 * as a new BROWSER-platform device. Deliberately bypasses
 * EnrollmentCoordinator's invitation-claim flow entirely -- that pipeline
 * exists for a CHILD device with no prior identity, gated by a one-time
 * invitation token and carrying child-specific fields (requestedProtectionMode,
 * childProfileId) that don't apply to a parent's own trusted-browser
 * endpoint. A browser endpoint instead registers directly via the SAME
 * generic DeviceRepository.createDeviceWithKey every other device
 * eventually lands in, starting at the SAME PAIRING_PENDING status
 * (doc 08 Section 4) -- it still requires the SAME explicit
 * parent-confirmation step (PairingService.confirmPairing, the existing
 * pairing-requests/:deviceId/confirm route, completely unchanged) before
 * it is PAIRED. registeredByAccountId is recorded so that confirmation
 * step can reject the SAME account confirming its own registration --
 * see DeviceRecord's own doc comment for why that risk is specific to this
 * ceremony and does not apply to invitation-based mobile enrollment.
 *
 * A BROWSER endpoint registers exactly one DSK, matching what
 * trustedEndpointKeyStore.generateEndpointSigningKey() actually produces
 * (ECDSA P-256 sign/verify only) -- never a DEK, and never claims one.
 */
export class BrowserEndpointService {
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
    if (!(timestamp instanceof Date)) throw new TypeError('Device directory clock must return a valid persistence timestamp.');
    const milliseconds = timestamp.getTime();
    if (!Number.isFinite(milliseconds) || milliseconds < MIN_DEVICE_TIMESTAMP_MS || milliseconds > MAX_DEVICE_TIMESTAMP_MS) {
      throw new TypeError('Device directory clock must return a valid persistence timestamp.');
    }
    return new Date(milliseconds);
  }

  async registerEndpoint(familyId: OpaqueFamilyId, registeredByAccountId: string, dskPublicKey: string): Promise<RegisterEndpointResult> {
    if (!isPlausiblePublicKey(dskPublicKey)) throw new BrowserEndpointError('INVALID_PUBLIC_KEY');

    const deviceId = randomUUID();
    const createdAt = this.persistenceTimestamp();
    const result = await this.deviceRepository.createDeviceWithKey(
      {
        deviceId,
        familyId,
        platform: 'BROWSER',
        status: 'PAIRING_PENDING',
        createdAt,
        revokedAt: null,
        pairedAt: null,
        pairedByAccountId: null,
        registeredByAccountId,
      },
      {
        deviceId,
        keyId: randomUUID(),
        keyPurpose: 'DSK',
        publicKey: dskPublicKey,
        status: 'ACTIVE',
        createdAt,
        revokedAt: null,
      },
    );
    if (result.outcome === 'DUPLICATE_KEY') throw new BrowserEndpointError('DUPLICATE_KEY');

    try {
      await this.auditService.record({
        familyId,
        actionType: 'DEVICE_LIFECYCLE_TRANSITION',
        // This registration is authorized by a Parent account session, not a
        // device proof. Keep the device-actor field truthful; the account id
        // is deliberately not serialized into it as if it were a device id.
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
        freeTextNote: 'BROWSER endpoint registered -> PAIRING_PENDING',
      });
      this.auditAppendFailureCount = 0;
    } catch {
      // The device and DSK have already committed atomically. Returning an
      // error would hide the only deviceId the browser needs to continue,
      // and retrying with its key would only report DUPLICATE_KEY. Keep the
      // committed result truthful and expose audit-storage failure through a
      // bounded warning without including identifiers or private errors.
      this.auditAppendFailureCount += 1;
      if (this.auditAppendFailureCount === 1 || this.auditAppendFailureCount % 100 === 0) {
        // eslint-disable-next-line no-console -- structured warning is bounded and contains no identifiers or private payload.
        console.warn(JSON.stringify({
          event: 'browser_endpoint_registration_audit_append_failed',
          occurrences: this.auditAppendFailureCount,
        }));
      }
    }

    return { deviceId, status: 'PAIRING_PENDING' };
  }
}
