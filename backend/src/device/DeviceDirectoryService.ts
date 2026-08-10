import { randomUUID } from 'node:crypto';
import { isPlausiblePublicKey } from './publicKey.js';
import type { AddKeyResult, CreateDeviceResult, DeviceRepository } from './DeviceRepository.js';
import type { DeviceId, DeviceKeyId, DeviceKeyRecord, DeviceRecord, OpaqueFamilyId, Platform } from './types.js';

export type DeviceDirectoryErrorCode =
  | 'INVALID_PUBLIC_KEY'
  | 'DUPLICATE_KEY'
  | 'DEVICE_NOT_FOUND'
  | 'DEVICE_REVOKED'
  | 'KEY_NOT_FOUND';

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
};

export interface RegisterDeviceInput {
  familyId: OpaqueFamilyId;
  platform: Platform;
  publicKey: string;
}

export interface RegisteredDevice {
  device: DeviceRecord;
  key: DeviceKeyRecord;
}

export class DeviceDirectoryService {
  private readonly repository: DeviceRepository;
  private readonly now: () => Date;

  constructor(repository: DeviceRepository, now: () => Date = () => new Date()) {
    this.repository = repository;
    this.now = now;
  }

  /** Registration is the family-establishing action itself: the caller asserts the family a new device joins. */
  async registerDevice(input: RegisterDeviceInput): Promise<RegisteredDevice> {
    if (!isPlausiblePublicKey(input.publicKey)) throw new DeviceDirectoryError('INVALID_PUBLIC_KEY');
    const createdAt = this.now();
    const device: DeviceRecord = {
      deviceId: randomUUID(),
      familyId: input.familyId,
      platform: input.platform,
      status: 'ACTIVE',
      createdAt,
      revokedAt: null,
    };
    const key: DeviceKeyRecord = {
      deviceId: device.deviceId,
      keyId: randomUUID(),
      publicKey: input.publicKey,
      status: 'ACTIVE',
      createdAt,
      revokedAt: null,
    };
    const result: CreateDeviceResult = await this.repository.createDeviceWithKey(device, key);
    if (result.outcome === 'DUPLICATE_KEY') throw new DeviceDirectoryError('DUPLICATE_KEY');
    return { device: result.device, key: result.key };
  }

  async addDeviceKey(authorizedFamilyId: OpaqueFamilyId, deviceId: DeviceId, publicKey: string): Promise<DeviceKeyRecord> {
    if (!isPlausiblePublicKey(publicKey)) throw new DeviceDirectoryError('INVALID_PUBLIC_KEY');
    const record: DeviceKeyRecord = {
      deviceId,
      keyId: randomUUID(),
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
    return result.device;
  }

  async listActiveKeys(authorizedFamilyId: OpaqueFamilyId, deviceId: DeviceId): Promise<DeviceKeyRecord[]> {
    const device = await this.repository.findDeviceForFamily(authorizedFamilyId, deviceId);
    if (!device) throw new DeviceDirectoryError('DEVICE_NOT_FOUND');
    const keys = await this.repository.findKeysByDeviceForFamily(authorizedFamilyId, deviceId);
    return keys.filter((k) => k.status === 'ACTIVE');
  }
}
