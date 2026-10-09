import { randomUUID } from 'node:crypto';
import { generateChallengeNonce } from './nonce.js';
import { computeExpiryInstant, DEVICE_CHALLENGE_TTL_MS } from './policy.js';
import type { DeviceChallengeRepository, ConsumeChallengeResult } from './DeviceChallengeRepository.js';
import type { DeviceSignatureVerifier } from './DeviceSignatureVerifier.js';
import type { DeviceChallengeRecord, DeviceId } from './types.js';
import type { DeviceRepository } from '../device/DeviceRepository.js';

export type DeviceAuthErrorCode =
  | 'DEVICE_NOT_FOUND'
  | 'DEVICE_REVOKED'
  | 'NOT_FOUND'
  | 'EXPIRED'
  | 'ALREADY_CONSUMED'
  | 'INVALID_SIGNATURE';

/** Fixed, generic messages per code -- never interpolates the nonce, signature, or key material. */
export class DeviceAuthError extends Error {
  readonly code: DeviceAuthErrorCode;
  constructor(code: DeviceAuthErrorCode) {
    super(DEVICE_AUTH_ERROR_MESSAGES[code]);
    this.name = 'DeviceAuthError';
    this.code = code;
  }
}

const DEVICE_AUTH_ERROR_MESSAGES: Record<DeviceAuthErrorCode, string> = {
  DEVICE_NOT_FOUND: 'Device was not found.',
  DEVICE_REVOKED: 'Device has been revoked.',
  NOT_FOUND: 'Challenge was not found.',
  EXPIRED: 'Challenge has expired.',
  ALREADY_CONSUMED: 'Challenge has already been used.',
  INVALID_SIGNATURE: 'Signature verification failed.',
};

export interface IssuedChallenge {
  challengeId: string;
  nonce: string;
  expiresAt: Date;
}

export interface VerifiedDeviceIdentity {
  deviceId: DeviceId;
  familyId: string;
  /** Exact DSK that verified and atomically consumed this challenge. */
  dskKeyId: string;
  /** Public-key bytes are public, and pin this process-local session to the verified key material. */
  dskPublicKey: string;
}

/**
 * Orchestrates device proof-of-possession: issue a single-use nonce for a
 * known, non-revoked device; later, verify a signature over that nonce
 * against the device's registered DSK (never its DEK -- doc 09 Section
 * 3.1), and atomically consume the challenge so it can never be verified
 * a second time even by a legitimately-valid, replayed signature.
 *
 * This service proves ONLY "this caller currently holds the private key
 * matching this device's registered DSK." It issues no session, token, or
 * family authority of any kind -- composing that on top (e.g. a scoped
 * device session, analogous to AuthService's service session) is a
 * separate, later concern.
 */
export class DeviceAuthService {
  private readonly challengeRepository: DeviceChallengeRepository;
  private readonly deviceRepository: DeviceRepository;
  private readonly signatureVerifier: DeviceSignatureVerifier;
  private readonly now: () => Date;

  constructor(
    challengeRepository: DeviceChallengeRepository,
    deviceRepository: DeviceRepository,
    signatureVerifier: DeviceSignatureVerifier,
    now: () => Date = () => new Date(),
  ) {
    this.challengeRepository = challengeRepository;
    this.deviceRepository = deviceRepository;
    this.signatureVerifier = signatureVerifier;
    this.now = now;
  }

  /** Reads the live lifecycle generation and confirms the exact proof key remains active. */
  async activeSessionFamilyEpoch(identity: VerifiedDeviceIdentity): Promise<number | null> {
    const familySessionEpoch = await this.deviceRepository.getActiveDeviceSessionEpoch(identity.familyId, identity.deviceId);
    if (familySessionEpoch === null) return null;

    const matchingKeys = (await this.deviceRepository.findKeysByDeviceForFamily(identity.familyId, identity.deviceId))
      .filter((key) => key.keyId === identity.dskKeyId && key.keyPurpose === 'DSK');
    if (matchingKeys.length !== 1 || matchingKeys[0].status !== 'ACTIVE' ||
        matchingKeys[0].publicKey !== identity.dskPublicKey) return null;
    return familySessionEpoch;
  }

  /**
   * NOT itself an authentication check -- issuance is unauthenticated by
   * design (proof of possession happens at verifyChallenge). The caller of
   * THIS method is therefore trusted to have already legitimately learned
   * `deviceId` (e.g. it is the device itself, over its own connection).
   * See DeviceRepository.findDeviceUnscoped's doc comment: an HTTP layer
   * that lets an arbitrary caller supply an arbitrary deviceId here would
   * reopen a cross-family existence/revocation-status oracle. No such
   * caller exists yet in this codebase.
   */
  async issueChallenge(deviceId: DeviceId): Promise<IssuedChallenge> {
    const device = await this.deviceRepository.findDeviceUnscoped(deviceId);
    if (!device) throw new DeviceAuthError('DEVICE_NOT_FOUND');
    if (device.status === 'REVOKED') throw new DeviceAuthError('DEVICE_REVOKED');

    const createdAt = this.now();
    const record: DeviceChallengeRecord = {
      challengeId: randomUUID(),
      deviceId: device.deviceId,
      familyId: device.familyId,
      nonce: generateChallengeNonce(),
      createdAt,
      expiresAt: computeExpiryInstant(createdAt, DEVICE_CHALLENGE_TTL_MS),
      consumedAt: null,
    };
    await this.challengeRepository.create(record);
    return { challengeId: record.challengeId, nonce: record.nonce, expiresAt: record.expiresAt };
  }

  /**
   * Verifies the signature, THEN atomically consumes the challenge.
   * Ordering matters only for the replay-protection guarantee: two
   * concurrent calls presenting the identical (stolen/replayed) valid
   * signature both pass verification, but consumeAtomically ensures only
   * the first is ever reported as CONSUMED -- the second observes
   * ALREADY_CONSUMED, closing the replay window even against a signature
   * that is genuinely, cryptographically valid.
   */
  async verifyChallenge(challengeId: string, signature: string): Promise<VerifiedDeviceIdentity> {
    const challenge = await this.challengeRepository.findById(challengeId);
    if (!challenge) throw new DeviceAuthError('NOT_FOUND');
    if (challenge.consumedAt) throw new DeviceAuthError('ALREADY_CONSUMED');
    if (this.now().getTime() >= challenge.expiresAt.getTime()) throw new DeviceAuthError('EXPIRED');

    const device = await this.deviceRepository.findDeviceUnscoped(challenge.deviceId);
    if (!device) throw new DeviceAuthError('DEVICE_NOT_FOUND');
    // The challenge carries the family scope captured at issuance. Re-check
    // it against the current durable device row before accepting its proof:
    // a stale or corrupted challenge must not authenticate a device under a
    // different family than the one for which this nonce was issued.
    if (device.familyId !== challenge.familyId) throw new DeviceAuthError('DEVICE_NOT_FOUND');
    if (device.status === 'REVOKED') throw new DeviceAuthError('DEVICE_REVOKED');

    const keys = await this.deviceRepository.findKeysByDeviceForFamily(device.familyId, device.deviceId);
    const activeDsks = keys.filter((key) => key.keyPurpose === 'DSK' && key.status === 'ACTIVE');
    if (activeDsks.length === 0) throw new DeviceAuthError('DEVICE_NOT_FOUND');

    // A device can temporarily have more than one ACTIVE DSK during an
    // accepted key transition. The request carries a signature, not a
    // caller-asserted key id, so identify the signer cryptographically and
    // require exactly one matching directory entry. Choosing the first match
    // would make authentication depend on unordered database row order when
    // two key IDs share the same verifying key or a verifier accepts both.
    const matchingDsks: (typeof activeDsks) = [];
    for (const candidate of activeDsks) {
      if (await this.signatureVerifier.verify(candidate.publicKey, challenge.nonce, signature)) {
        matchingDsks.push(candidate);
      }
    }
    if (matchingDsks.length !== 1) throw new DeviceAuthError('INVALID_SIGNATURE');
    const [dsk] = matchingDsks;
    if (!dsk) throw new DeviceAuthError('INVALID_SIGNATURE');

    const result: ConsumeChallengeResult = await this.challengeRepository.consumeAtomically(challengeId, this.now(), {
      familyId: device.familyId,
      deviceId: device.deviceId,
      keyId: dsk.keyId,
      publicKey: dsk.publicKey,
    });
    if (result.outcome !== 'CONSUMED') {
      if (result.outcome === 'SIGNER_KEY_INACTIVE') throw new DeviceAuthError('INVALID_SIGNATURE');
      throw new DeviceAuthError(result.outcome === 'EXPIRED' ? 'EXPIRED' : 'ALREADY_CONSUMED');
    }

    return { deviceId: device.deviceId, familyId: device.familyId, dskKeyId: dsk.keyId, dskPublicKey: dsk.publicKey };
  }
}
