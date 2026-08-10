import type { DeviceId, DeviceKeyId, DeviceKeyRecord, DeviceRecord } from './types.js';

export type CreateDeviceResult =
  | { outcome: 'CREATED'; device: DeviceRecord; key: DeviceKeyRecord }
  | { outcome: 'DUPLICATE_KEY' };

export type AddKeyResult =
  | { outcome: 'ADDED'; key: DeviceKeyRecord }
  | { outcome: 'DUPLICATE_KEY' }
  | { outcome: 'DEVICE_NOT_FOUND' }
  | { outcome: 'DEVICE_REVOKED' };

/**
 * Persistence port for the device identity/key directory. Only a
 * deterministic in-memory implementation exists today (test support). The
 * PostgreSQL implementation is a separate, later slice and must not be
 * assumed here.
 *
 * A given public key must never be registrable against more than one
 * device -- createDeviceWithKey/addKeyAtomically enforce this atomically to
 * close the check-then-act window a naive find-then-insert would leave open.
 */
export interface DeviceRepository {
  createDeviceWithKey(device: DeviceRecord, key: DeviceKeyRecord): Promise<CreateDeviceResult>;
  findDevice(deviceId: DeviceId): Promise<DeviceRecord | null>;
  revokeDevice(deviceId: DeviceId, revokedAt: Date): Promise<DeviceRecord>;

  addKeyAtomically(record: DeviceKeyRecord): Promise<AddKeyResult>;
  findKeysByDevice(deviceId: DeviceId): Promise<DeviceKeyRecord[]>;
  revokeKey(deviceId: DeviceId, keyId: DeviceKeyId, revokedAt: Date): Promise<DeviceKeyRecord>;
}
