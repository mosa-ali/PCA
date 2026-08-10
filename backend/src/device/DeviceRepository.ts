import type { DeviceId, DeviceKeyId, DeviceKeyRecord, DeviceRecord, OpaqueFamilyId } from './types.js';

export type CreateDeviceResult =
  | { outcome: 'CREATED'; device: DeviceRecord; key: DeviceKeyRecord }
  | { outcome: 'DUPLICATE_KEY' };

export type AddKeyResult =
  | { outcome: 'ADDED'; key: DeviceKeyRecord }
  | { outcome: 'DUPLICATE_KEY' }
  | { outcome: 'DEVICE_NOT_FOUND' }
  | { outcome: 'DEVICE_REVOKED' };

export type RevokeDeviceResult =
  | { outcome: 'REVOKED'; device: DeviceRecord; keys: DeviceKeyRecord[] }
  | { outcome: 'DEVICE_NOT_FOUND' };

export type RevokeKeyResult =
  | { outcome: 'REVOKED'; key: DeviceKeyRecord }
  | { outcome: 'DEVICE_NOT_FOUND' }
  | { outcome: 'KEY_NOT_FOUND' };

export type ConfirmPairingResult =
  | { outcome: 'CONFIRMED'; device: DeviceRecord }
  | { outcome: 'DEVICE_NOT_FOUND' }
  | { outcome: 'INVALID_STATE' };

/**
 * Persistence port for the device identity/key directory. Only a
 * deterministic in-memory implementation exists today (test support). The
 * PostgreSQL implementation is a separate, later slice and must not be
 * assumed here.
 *
 * A given public key must never be registrable against more than one
 * device -- createDeviceWithKey/addKeyAtomically enforce this atomically to
 * close the check-then-act window a naive find-then-insert would leave open.
 *
 * Every read/mutation below except creation is scoped by an authorized
 * familyId. A device that exists but belongs to a different family must be
 * indistinguishable from a device that does not exist at all (DEVICE_NOT_FOUND
 * in both cases) -- this is a deliberate IDOR defense: it must not be
 * possible to learn "this deviceId exists, just not in your family" from the
 * response shape.
 */
export interface DeviceRepository {
  createDeviceWithKey(device: DeviceRecord, key: DeviceKeyRecord): Promise<CreateDeviceResult>;
  findDeviceForFamily(familyId: OpaqueFamilyId, deviceId: DeviceId): Promise<DeviceRecord | null>;
  /**
   * Deliberately NOT family-scoped -- for the one caller allowed to use it,
   * device-authentication challenge issuance/verification (src/deviceauth),
   * where the device itself is the caller and proves identity by signing a
   * challenge with its own DSK, not by presenting an externally-authorized
   * familyId. Knowing another device's opaque deviceId alone can never
   * produce a valid SIGNATURE over that device's challenge nonce, so an
   * unscoped lookup here does not let an attacker impersonate another
   * device.
   *
   * IMPORTANT, NOT YET CLOSED: `verifyChallenge`'s use of this method is
   * safe because it's gated by a signature. `issueChallenge`'s use is NOT
   * signature-gated -- by construction, proof of possession happens later,
   * so issuance itself currently accepts any caller-supplied deviceId and
   * answers DEVICE_NOT_FOUND / DEVICE_REVOKED / success based purely on
   * this unscoped lookup. Today that's inert because nothing calls
   * issueChallenge except this domain's own tests. The FIRST HTTP-wiring
   * slice that exposes challenge issuance MUST NOT let an arbitrary caller
   * supply an arbitrary deviceId to it -- that would reopen exactly the
   * cross-family existence/revocation-status oracle every other method in
   * this repository is designed to prevent (e.g. require the caller to
   * already be the device itself over an authenticated transport, or bind
   * issuance to a value only the legitimate device could present). Do not
   * call findDeviceUnscoped from any other HTTP-authenticated-caller code
   * path -- those must keep using the family-scoped methods above.
   */
  findDeviceUnscoped(deviceId: DeviceId): Promise<DeviceRecord | null>;
  revokeDeviceAndKeysAtomically(
    familyId: OpaqueFamilyId,
    deviceId: DeviceId,
    revokedAt: Date,
  ): Promise<RevokeDeviceResult>;

  addKeyAtomically(familyId: OpaqueFamilyId, record: DeviceKeyRecord): Promise<AddKeyResult>;
  findKeysByDeviceForFamily(familyId: OpaqueFamilyId, deviceId: DeviceId): Promise<DeviceKeyRecord[]>;
  revokeKeyForFamily(
    familyId: OpaqueFamilyId,
    deviceId: DeviceId,
    keyId: DeviceKeyId,
    revokedAt: Date,
  ): Promise<RevokeKeyResult>;

  /**
   * PAIRING_PENDING -> PAIRED only, per doc 08 Section 4 (parent
   * fingerprint confirmation, PCA-FR-141). Idempotent: confirming an
   * already-PAIRED device returns success with the original pairedAt
   * unchanged. Any other status (REVOKED, or already ACTIVE) is
   * INVALID_STATE -- confirmation is not a general-purpose status setter.
   */
  confirmPairing(
    familyId: OpaqueFamilyId,
    deviceId: DeviceId,
    confirmedByAccountId: string,
    confirmedAt: Date,
  ): Promise<ConfirmPairingResult>;
}
