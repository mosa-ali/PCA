import { randomUUID } from 'node:crypto';
import { isPlausiblePublicKey } from './publicKey.js';
import type { AddKeyResult, CreateDeviceResult, DeviceRepository } from './DeviceRepository.js';
import type {
  DeviceId,
  DeviceKeyId,
  DeviceKeyPurpose,
  DeviceKeyRecord,
  DeviceRecord,
  OpaqueFamilyId,
  Platform,
} from './types.js';
import { FamilyAuditService, InMemoryFamilyAuditRepository } from '../familyrbac/FamilyAuditStore.js';

export type DeviceDirectoryErrorCode =
  | 'INVALID_PUBLIC_KEY'
  | 'DUPLICATE_KEY'
  | 'DEVICE_NOT_FOUND'
  | 'DEVICE_REVOKED'
  | 'KEY_NOT_FOUND'
  | 'INVALID_STATE'
  | 'SELF_APPROVAL_DENIED';

/** Fixed, generic messages per code -- never interpolates key material or family data. */
export class DeviceDirectoryError extends Error {
  readonly code: DeviceDirectoryErrorCode;
  constructor(code: DeviceDirectoryErrorCode) {
    super(DEVICE_ERROR_MESSAGES[code]);
    this.name = 'DeviceDirectoryError';
    this.code = code;
  }
}

const DEVICE_ERROR_MESSAGES: Record<DeviceDirectoryErrorCode, string> = {
  INVALID_PUBLIC_KEY: 'Public key is malformed.',
  DUPLICATE_KEY: 'This public key is already registered to a device.',
  // Intentionally identical wording/code for "does not exist" and "exists in
  // a different family" -- callers must not be able to distinguish the two.
  DEVICE_NOT_FOUND: 'Device was not found.',
  DEVICE_REVOKED: 'Device has been revoked.',
  KEY_NOT_FOUND: 'Device key was not found.',
  INVALID_STATE: 'Device is not in a state that permits this operation.',
  SELF_APPROVAL_DENIED: 'This account registered this endpoint and cannot also confirm it.',
};

export interface RegisterDeviceInput {
  familyId: OpaqueFamilyId;
  platform: Platform;
  publicKey: string;
  keyPurpose: DeviceKeyPurpose;
}

export interface RegisteredDevice {
  device: DeviceRecord;
  key: DeviceKeyRecord;
}

export class DeviceDirectoryService {
  private readonly repository: DeviceRepository;
  private readonly now: () => Date;
  private readonly auditService: FamilyAuditService;

  constructor(
    repository: DeviceRepository,
    now: () => Date = () => new Date(),
    auditService: FamilyAuditService = new FamilyAuditService(new InMemoryFamilyAuditRepository()),
  ) {
    this.repository = repository;
    this.now = now;
    this.auditService = auditService;
  }

  /**
   * Registration is the family-establishing action itself: the caller
   * asserts the family a new device joins. A freshly registered device is
   * PAIRING_PENDING, never ACTIVE -- see types.ts's DeviceStatus doc
   * comment for the full lifecycle reasoning.
   */
  async registerDevice(input: RegisterDeviceInput): Promise<RegisteredDevice> {
    if (!isPlausiblePublicKey(input.publicKey)) throw new DeviceDirectoryError('INVALID_PUBLIC_KEY');
    const createdAt = this.now();
    const device: DeviceRecord = {
      deviceId: randomUUID(),
      familyId: input.familyId,
      platform: input.platform,
      status: 'PAIRING_PENDING',
      createdAt,
      revokedAt: null,
      pairedAt: null,
      pairedByAccountId: null,
      registeredByAccountId: null,
    };
    const key: DeviceKeyRecord = {
      deviceId: device.deviceId,
      keyId: randomUUID(),
      keyPurpose: input.keyPurpose,
      publicKey: input.publicKey,
      status: 'ACTIVE',
      createdAt,
      revokedAt: null,
    };
    const result: CreateDeviceResult = await this.repository.createDeviceWithKey(device, key);
    if (result.outcome === 'DUPLICATE_KEY') throw new DeviceDirectoryError('DUPLICATE_KEY');
    return { device: result.device, key: result.key };
  }

  async addDeviceKey(
    authorizedFamilyId: OpaqueFamilyId,
    deviceId: DeviceId,
    publicKey: string,
    keyPurpose: DeviceKeyPurpose,
  ): Promise<DeviceKeyRecord> {
    if (!isPlausiblePublicKey(publicKey)) throw new DeviceDirectoryError('INVALID_PUBLIC_KEY');
    const record: DeviceKeyRecord = {
      deviceId,
      keyId: randomUUID(),
      keyPurpose,
      publicKey,
      status: 'ACTIVE',
      createdAt: this.now(),
      revokedAt: null,
    };
    const result: AddKeyResult = await this.repository.addKeyAtomically(authorizedFamilyId, record);
    switch (result.outcome) {
      case 'ADDED':
        return result.key;
      case 'DUPLICATE_KEY':
        throw new DeviceDirectoryError('DUPLICATE_KEY');
      case 'DEVICE_NOT_FOUND':
        throw new DeviceDirectoryError('DEVICE_NOT_FOUND');
      case 'DEVICE_REVOKED':
        throw new DeviceDirectoryError('DEVICE_REVOKED');
    }
  }

  async revokeKey(authorizedFamilyId: OpaqueFamilyId, deviceId: DeviceId, keyId: DeviceKeyId): Promise<DeviceKeyRecord> {
    const result = await this.repository.revokeKeyForFamily(authorizedFamilyId, deviceId, keyId, this.now());
    switch (result.outcome) {
      case 'REVOKED':
        return result.key;
      case 'DEVICE_NOT_FOUND':
        throw new DeviceDirectoryError('DEVICE_NOT_FOUND');
      case 'KEY_NOT_FOUND':
        throw new DeviceDirectoryError('KEY_NOT_FOUND');
    }
  }

  /** Device revocation and cascading key revocation are ONE atomic repository operation -- never a service-level loop. */
  async revokeDevice(authorizedFamilyId: OpaqueFamilyId, deviceId: DeviceId): Promise<DeviceRecord> {
    const result = await this.repository.revokeDeviceAndKeysAtomically(authorizedFamilyId, deviceId, this.now());
    if (result.outcome === 'DEVICE_NOT_FOUND') throw new DeviceDirectoryError('DEVICE_NOT_FOUND');
    await this.auditService.record({
      familyId: authorizedFamilyId,
      actionType: 'DEVICE_LIFECYCLE_TRANSITION',
      actorDeviceId: deviceId,
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
      freeTextNote: 'DEVICE_REVOKED',
    });
    return result.device;
  }

  async listActiveKeys(authorizedFamilyId: OpaqueFamilyId, deviceId: DeviceId): Promise<DeviceKeyRecord[]> {
    const device = await this.repository.findDeviceForFamily(authorizedFamilyId, deviceId);
    if (!device) throw new DeviceDirectoryError('DEVICE_NOT_FOUND');
    const keys = await this.repository.findKeysByDeviceForFamily(authorizedFamilyId, deviceId);
    return keys.filter((k) => k.status === 'ACTIVE');
  }

  /** PAIRING_PENDING -> PAIRED, per doc 08 PCA-FR-141 (parent fingerprint confirmation). Idempotent. */
  async confirmPairing(authorizedFamilyId: OpaqueFamilyId, deviceId: DeviceId, confirmedByAccountId: string): Promise<DeviceRecord> {
    const result = await this.repository.confirmPairing(authorizedFamilyId, deviceId, confirmedByAccountId, this.now());
    switch (result.outcome) {
      case 'CONFIRMED':
        return result.device;
      case 'DEVICE_NOT_FOUND':
        throw new DeviceDirectoryError('DEVICE_NOT_FOUND');
      case 'SELF_APPROVAL_DENIED':
        throw new DeviceDirectoryError('SELF_APPROVAL_DENIED');
      case 'INVALID_STATE':
        throw new DeviceDirectoryError('INVALID_STATE');
    }
  }
}
