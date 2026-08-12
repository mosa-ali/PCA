import { randomUUID } from 'node:crypto';
import { DeviceAuthError, DeviceAuthService, type IssuedChallenge } from '../deviceauth/DeviceAuthService.js';
import { generateChallengeNonce } from '../deviceauth/nonce.js';
import { computeExpiryInstant as computeChallengeExpiry, DEVICE_CHALLENGE_TTL_MS } from '../deviceauth/policy.js';
import { generateSessionToken, hashSessionToken, isPlausibleSessionToken } from '../auth/token.js';
import { DEVICE_SESSION_TTL_MS } from './policy.js';
import type { DeviceSessionRepository } from './DeviceSessionRepository.js';
import type { DeviceSessionRecord } from './types.js';

export type RuntimeSyncAuthErrorCode = 'INVALID_INPUT' | 'UNAUTHORIZED';

/** Deliberately one generic code/message for every failure mode -- same posture as AuthError/DeviceAuthError; see class doc below for why. */
export class RuntimeSyncAuthError extends Error {
  readonly code: RuntimeSyncAuthErrorCode;
  constructor(code: RuntimeSyncAuthErrorCode) {
    super(RUNTIME_SYNC_AUTH_ERROR_MESSAGES[code]);
    this.name = 'RuntimeSyncAuthError';
    this.code = code;
  }
}

const RUNTIME_SYNC_AUTH_ERROR_MESSAGES: Record<RuntimeSyncAuthErrorCode, string> = {
  INVALID_INPUT: 'Request input is malformed.',
  UNAUTHORIZED: 'Authentication failed.',
};

export interface DeviceSessionIdentity {
  deviceId: string;
  familyId: string;
}

export interface IssuedDeviceSession {
  rawToken: string;
  expiresAt: Date;
}

/**
 * Composes -- never reimplements -- DeviceAuthService's proof-of-possession
 * challenge/response, and adds exactly the missing piece its own doc
 * comment defers: a short-lived opaque device session usable as an HTTP
 * bearer credential for the runtime-sync routes, built with the SAME
 * token generate/hash primitives AuthService's service sessions already
 * use (auth/token.ts, reused not duplicated/reimplemented).
 */
export class DeviceSessionService {
  constructor(
    private readonly deviceAuthService: DeviceAuthService,
    private readonly sessionRepository: DeviceSessionRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * See DeviceRepository.findDeviceUnscoped's doc comment and
   * DeviceAuthService.issueChallenge's own warning: an HTTP-exposed
   * issuance keyed by an arbitrary caller-supplied deviceId must not let a
   * caller distinguish "this device doesn't exist" / "this device is
   * revoked" / "this device exists and is fine" from the issuance
   * response alone. Every one of those cases here returns an
   * indistinguishable, well-formed, syntactically valid challenge --
   * DEVICE_NOT_FOUND/DEVICE_REVOKED synthesize a nonce that was never
   * persisted, so it can never subsequently succeed at completeChallenge,
   * but the failure only ever surfaces THERE, collapsed into the same
   * single generic RuntimeSyncAuthError('UNAUTHORIZED') as every other
   * completion failure (wrong signature, expired challenge, unknown
   * challenge id) -- this closes the enumeration oracle the underlying
   * method's own doc comment flags as unresolved.
   */
  async issueChallengeSafely(deviceId: string): Promise<IssuedChallenge> {
    try {
      return await this.deviceAuthService.issueChallenge(deviceId);
    } catch (error) {
      if (error instanceof DeviceAuthError && (error.code === 'DEVICE_NOT_FOUND' || error.code === 'DEVICE_REVOKED')) {
        const createdAt = this.now();
        return {
          challengeId: randomUUID(),
          nonce: generateChallengeNonce(),
          expiresAt: computeChallengeExpiry(createdAt, DEVICE_CHALLENGE_TTL_MS),
        };
      }
      throw error;
    }
  }

  /** Verifies proof of possession via DeviceAuthService, then mints a device session. Every failure mode collapses to one generic UNAUTHORIZED. */
  async completeChallenge(challengeId: string, signature: string): Promise<IssuedDeviceSession> {
    let identity: DeviceSessionIdentity;
    try {
      identity = await this.deviceAuthService.verifyChallenge(challengeId, signature);
    } catch (error) {
      if (error instanceof DeviceAuthError) throw new RuntimeSyncAuthError('UNAUTHORIZED');
      throw error;
    }

    const { rawToken, tokenHash } = generateSessionToken();
    const issuedAt = this.now();
    const record: DeviceSessionRecord = {
      sessionId: randomUUID(),
      tokenHash,
      deviceId: identity.deviceId,
      familyId: identity.familyId,
      issuedAt,
      expiresAt: new Date(issuedAt.getTime() + DEVICE_SESSION_TTL_MS),
      revokedAt: null,
    };
    await this.sessionRepository.create(record);
    return { rawToken, expiresAt: record.expiresAt };
  }

  /** Returns the authenticated (deviceId, familyId), or throws a single generic RuntimeSyncAuthError('UNAUTHORIZED') for any failure whatsoever. */
  async validateSession(rawToken: string): Promise<DeviceSessionIdentity> {
    if (!isPlausibleSessionToken(rawToken)) throw new RuntimeSyncAuthError('UNAUTHORIZED');
    const result = await this.sessionRepository.validate(hashSessionToken(rawToken), this.now());
    if (result.outcome !== 'VALID') throw new RuntimeSyncAuthError('UNAUTHORIZED');
    return { deviceId: result.session.deviceId, familyId: result.session.familyId };
  }

  /** Idempotent: revoking an unknown/already-revoked/expired token is never an error. */
  async revokeSession(rawToken: string): Promise<void> {
    if (!isPlausibleSessionToken(rawToken)) throw new RuntimeSyncAuthError('UNAUTHORIZED');
    await this.sessionRepository.revoke(hashSessionToken(rawToken), this.now());
  }
}
