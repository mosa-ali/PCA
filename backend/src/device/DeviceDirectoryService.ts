import { randomUUID } from 'node:crypto';
import { isPlausiblePublicKey } from './publicKey.js';
import type { AddKeyResult, CreateDeviceResult, DeviceRepository } from './DeviceRepository.js';
import type { DeviceId, DeviceKeyRecord, DeviceRecord, OpaqueFamilyId, Platform } from './types.js';

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

  async addDeviceKey(deviceId: DeviceId, publicKey: string): Promise<DeviceKeyRecord> {
    if (!isPlausiblePublicKey(publicKey)) throw new DeviceDirectoryError('INVALID_PUBLIC_KEY');
    const record: DeviceKeyRecord = {
      deviceId,
      keyId: randomUUID(),
      publicKey,
      status: 'ACTIVE',
      createdAt: this.now(),
      revokedAt: null,
    };
    const result: AddKeyResult = await this.repository.addKeyAtomically(record);
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

  async revokeKey(deviceId: DeviceId, keyId: string): Promise<DeviceKeyRecord> {
    const device = await this.repository.findDevice(deviceId);
    if (!device) throw new DeviceDirectoryError('DEVICE_NOT_FOUND');
    const keys = await this.repository.findKeysByDevice(deviceId);
    if (!keys.some((k) => k.keyId === keyId)) throw new DeviceDirectoryError('KEY_NOT_FOUND');
    return this.repository.revokeKey(deviceId, keyId, this.now());
  }

  async revokeDevice(deviceId: DeviceId): Promise<DeviceRecord> {
    const device = await this.repository.findDevice(deviceId);
    if (!device) throw new DeviceDirectoryError('DEVICE_NOT_FOUND');
    const revoked = await this.repository.revokeDevice(deviceId, this.now());
    const keys = await this.repository.findKeysByDevice(deviceId);
    for (const key of keys) {
      if (key.status === 'ACTIVE') {
        await this.repository.revokeKey(deviceId, key.keyId, this.now());
      }
    }
    return revoked;
  }

  async listActiveKeys(deviceId: DeviceId): Promise<DeviceKeyRecord[]> {
    const device = await this.repository.findDevice(deviceId);
    if (!device) throw new DeviceDirectoryError('DEVICE_NOT_FOUND');
    const keys = await this.repository.findKeysByDevice(deviceId);
    return keys.filter((k) => k.status === 'ACTIVE');
  }
}
