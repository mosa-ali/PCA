export type DeviceId = string;
export type DeviceKeyId = string;
export type OpaqueFamilyId = string;
export type Platform = 'ANDROID' | 'IOS';
export type DeviceStatus = 'ACTIVE' | 'REVOKED';
export type DeviceKeyStatus = 'ACTIVE' | 'REVOKED';

/**
 * Device identity record. Carries only opaque references and public-key
 * material -- public keys are not secret, but this record must never gain a
 * field for private keys, PINs, or family activity data.
 */
export interface DeviceRecord {
  deviceId: DeviceId;
  familyId: OpaqueFamilyId;
  platform: Platform;
  status: DeviceStatus;
  createdAt: Date;
  revokedAt: Date | null;
}

export interface DeviceKeyRecord {
  deviceId: DeviceId;
  keyId: DeviceKeyId;
  publicKey: string;
  status: DeviceKeyStatus;
  createdAt: Date;
  revokedAt: Date | null;
}
