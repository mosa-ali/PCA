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
    if (device.status === 'REVOKED') throw new DeviceAuthError('DEVICE_REVOKED');

    const keys = await this.deviceRepository.findKeysByDeviceForFamily(device.familyId, device.deviceId);
    const dsk = keys.find((key) => key.keyPurpose === 'DSK' && key.status === 'ACTIVE');
    if (!dsk) throw new DeviceAuthError('DEVICE_NOT_FOUND');

    const valid = await this.signatureVerifier.verify(dsk.publicKey, challenge.nonce, signature);
    if (!valid) throw new DeviceAuthError('INVALID_SIGNATURE');

    const result: ConsumeChallengeResult = await this.challengeRepository.consumeAtomically(challengeId, this.now());
    if (result.outcome !== 'CONSUMED') {
      throw new DeviceAuthError(result.outcome === 'EXPIRED' ? 'EXPIRED' : 'ALREADY_CONSUMED');
    }

    return { deviceId: device.deviceId, familyId: device.familyId };
  }
}
