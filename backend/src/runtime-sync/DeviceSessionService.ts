import { randomUUID } from 'node:crypto';
import { DeviceAuthError, DeviceAuthService, type IssuedChallenge, type VerifiedDeviceIdentity } from '../deviceauth/DeviceAuthService.js';
import { generateChallengeNonce } from '../deviceauth/nonce.js';
import { computeExpiryInstant as computeChallengeExpiry, DEVICE_CHALLENGE_TTL_MS,
  isSupportedChallengeTime } from '../deviceauth/policy.js';
import { generateSessionToken, hashSessionToken, isPlausibleSessionToken } from '../auth/token.js';
import { DEVICE_SESSION_TTL_MS, PAIRED_BOOTSTRAP_SESSION_TTL_MS } from './policy.js';
import type { DeviceSessionRepository } from './DeviceSessionRepository.js';
import type { DeviceSessionRecord } from './types.js';
import { FamilyAuditService, InMemoryFamilyAuditRepository } from '../familyrbac/FamilyAuditStore.js';

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
  dskKeyId: string;
  purpose: 'ACTIVE' | 'PAIRED_BOOTSTRAP';
  activationTargetGeneration: number | null;
  bootstrapChallengeId: string | null;
}

export type DeviceSessionPurpose = DeviceSessionIdentity['purpose'];

export interface IssuedDeviceSession {
  rawToken: string;
  expiresAt: Date;
}

export interface DeviceSessionRevocationAuditFailure {
  event: 'device_session_revocation_audit_append_failed';
  occurrences: number;
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
  private auditAppendFailureCount = 0;

  constructor(
    private readonly deviceAuthService: DeviceAuthService,
    private readonly sessionRepository: DeviceSessionRepository,
    private readonly now: () => Date = () => new Date(),
    private readonly auditService: FamilyAuditService = new FamilyAuditService(new InMemoryFamilyAuditRepository()),
    private readonly observeRevocationAuditFailure: (failure: DeviceSessionRevocationAuditFailure) => void = () => {},
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
        const clockValue = this.now();
        if (!isSupportedChallengeTime(clockValue)) {
          throw new RangeError('Challenge creation time is outside the supported persistence range.');
        }
        const createdAt = new Date(clockValue.getTime());
        const expiresAt = computeChallengeExpiry(createdAt, DEVICE_CHALLENGE_TTL_MS);
        if (!isSupportedChallengeTime(expiresAt)) {
          throw new RangeError('Challenge expiry is outside the supported persistence range.');
        }
        return {
          challengeId: randomUUID(),
          nonce: generateChallengeNonce(),
          expiresAt,
        };
      }
      throw error;
    }
  }

  /** Verifies proof of possession, binds the verified challenge device to the request path, then mints a session pinned to that exact DSK. Failures collapse to UNAUTHORIZED. */
  async completeChallenge(expectedDeviceId: string, challengeId: string, signature: string): Promise<IssuedDeviceSession> {
    let identity: VerifiedDeviceIdentity;
    try {
      identity = await this.deviceAuthService.verifyChallenge(challengeId, signature);
    } catch (error) {
      if (error instanceof DeviceAuthError) throw new RuntimeSyncAuthError('UNAUTHORIZED');
      throw error;
    }
    // The session route is device-scoped. Never let a challenge issued for
    // one device mint a bearer through another device's URL, even though the
    // token itself remains bound to the signer returned by DeviceAuthService.
    if (identity.deviceId !== expectedDeviceId) throw new RuntimeSyncAuthError('UNAUTHORIZED');
    const familySessionEpoch = await this.deviceAuthService.activeSessionFamilyEpoch(identity);
    if (!isValidFamilySessionEpoch(familySessionEpoch)) {
      throw new RuntimeSyncAuthError('UNAUTHORIZED');
    }

    return this.createSession(identity, familySessionEpoch, 'ACTIVE', null, null, DEVICE_SESSION_TTL_MS);
  }

  /** Issues an opaque, non-refreshable session after the activation store verifies current PAIRED DSK proof and target authority. */
  async issuePairedBootstrapSession(identity: VerifiedDeviceIdentity, activationTargetGeneration: number,
                                    bootstrapChallengeId: string): Promise<IssuedDeviceSession> {
    if (!Number.isSafeInteger(activationTargetGeneration) || activationTargetGeneration < 1 ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(bootstrapChallengeId)) {
      throw new RuntimeSyncAuthError('UNAUTHORIZED');
    }
    const familySessionEpoch = await this.deviceAuthService.pairedBootstrapSessionFamilyEpoch(identity);
    if (!isValidFamilySessionEpoch(familySessionEpoch)) throw new RuntimeSyncAuthError('UNAUTHORIZED');
    return this.createSession(identity, familySessionEpoch, 'PAIRED_BOOTSTRAP', activationTargetGeneration, bootstrapChallengeId,
      PAIRED_BOOTSTRAP_SESSION_TTL_MS);
  }

  private async createSession(identity: VerifiedDeviceIdentity, familySessionEpoch: number,
                              purpose: DeviceSessionPurpose, activationTargetGeneration: number | null,
                              bootstrapChallengeId: string | null, ttlMs: number): Promise<IssuedDeviceSession> {
    const { rawToken, tokenHash } = generateSessionToken();
    const clockValue: unknown = this.now();
    if (!isSupportedChallengeTime(clockValue)) {
      throw new RuntimeSyncAuthError('UNAUTHORIZED');
    }
    const issuedAt = new Date(clockValue.getTime());
    const expiresAt = new Date(issuedAt.getTime() + ttlMs);
    if (!isSupportedChallengeTime(expiresAt)) {
      throw new RuntimeSyncAuthError('UNAUTHORIZED');
    }
    const record: DeviceSessionRecord = {
      sessionId: randomUUID(),
      tokenHash,
      deviceId: identity.deviceId,
      familyId: identity.familyId,
      dskKeyId: identity.dskKeyId,
      dskPublicKey: identity.dskPublicKey,
      familySessionEpoch,
      purpose,
      activationTargetGeneration,
      bootstrapChallengeId,
      issuedAt,
      expiresAt,
      revokedAt: null,
    };
    await this.sessionRepository.create(record);
    return { rawToken, expiresAt: record.expiresAt };
  }

  /** Returns the authenticated device, family, and exact DSK key id; every failure remains generic UNAUTHORIZED. */
  async validateSession(rawToken: string, requiredPurpose: DeviceSessionPurpose = 'ACTIVE'): Promise<DeviceSessionIdentity> {
    if (!isPlausibleSessionToken(rawToken)) throw new RuntimeSyncAuthError('UNAUTHORIZED');
    const clockValue: unknown = this.now();
    if (!isSupportedChallengeTime(clockValue)) throw new RuntimeSyncAuthError('UNAUTHORIZED');
    const now = new Date(clockValue.getTime());
    const tokenHash = hashSessionToken(rawToken);
    const result = await this.sessionRepository.validate(tokenHash, now);
    if (result.outcome !== 'VALID') throw new RuntimeSyncAuthError('UNAUTHORIZED');
    if (!isValidSessionSnapshot(result.session, tokenHash) || result.session.purpose !== requiredPurpose ||
        now.getTime() < result.session.issuedAt.getTime() ||
        now.getTime() >= result.session.expiresAt.getTime()) {
      throw new RuntimeSyncAuthError('UNAUTHORIZED');
    }
    const verifiedKey = {
      deviceId: result.session.deviceId,
      familyId: result.session.familyId,
      dskKeyId: result.session.dskKeyId,
      dskPublicKey: result.session.dskPublicKey,
    };
    const activeFamilySessionEpoch = requiredPurpose === 'PAIRED_BOOTSTRAP'
      ? await this.deviceAuthService.pairedBootstrapSessionFamilyEpoch(verifiedKey)
      : await this.deviceAuthService.activeSessionFamilyEpoch(verifiedKey);
    if (!isValidFamilySessionEpoch(activeFamilySessionEpoch) || activeFamilySessionEpoch !== result.session.familySessionEpoch) {
      throw new RuntimeSyncAuthError('UNAUTHORIZED');
    }
    return { deviceId: verifiedKey.deviceId, familyId: verifiedKey.familyId, dskKeyId: verifiedKey.dskKeyId,
      purpose: result.session.purpose, activationTargetGeneration: result.session.activationTargetGeneration,
      bootstrapChallengeId: result.session.bootstrapChallengeId };
  }

  /**
   * Composition helper for HTTP layers that already know which family
   * they're operating in from a SEPARATE, already-authenticated context
   * (e.g. parentAccountRoutes.ts's `pca_family_session` cookie) and need to
   * bind a caller-asserted "acting device" claim to a REAL, verified
   * device identity before trusting it for anything (see
   * parentAccountRoutes.ts's `authorizeSafeZoneRequest` doc comment for the
   * vulnerability this closes -- a client-supplied
   * `x-pca-actor-device-id` header, alone, is never sufficient because it
   * has no cryptographic or session binding to the actual caller).
   *
   * This does not introduce a new trust boundary: it is `validateSession`
   * (proof-of-possession-derived identity, unchanged) plus one additional
   * check that the verified device's OWN familyId -- not any
   * caller-supplied value -- matches the caller's already-established
   * family scope. A validly-authenticated device session from a DIFFERENT
   * family must never satisfy a binding for THIS family, so that mismatch
   * collapses into the exact same generic UNAUTHORIZED as every other
   * failure mode here (invalid/expired/unknown token) -- never a distinct
   * error -- to avoid leaking cross-family session-validity information to
   * the caller.
   */
  async requireActorDeviceInFamily(rawToken: string, expectedFamilyId: string): Promise<DeviceSessionIdentity> {
    const identity = await this.validateSession(rawToken);
    if (identity.familyId !== expectedFamilyId) throw new RuntimeSyncAuthError('UNAUTHORIZED');
    return identity;
  }

  /**
   * Idempotent: revoking an unknown/already-revoked/expired token is never
   * an error. Best-effort audits the transition when the session was still
   * identifiable just before revocation -- an unknown/already-revoked
   * token produces no identity to audit, which is fine: nothing actually
   * transitioned.
   */
  async revokeSession(rawToken: string): Promise<void> {
    if (!isPlausibleSessionToken(rawToken)) throw new RuntimeSyncAuthError('UNAUTHORIZED');
    const clockValue: unknown = this.now();
    if (!isSupportedChallengeTime(clockValue)) throw new RuntimeSyncAuthError('UNAUTHORIZED');
    // Use one validated server timestamp for both the audit pre-read and the
    // repository mutation. A second clock sample could move behind issuedAt,
    // making revoke() a no-op after validate() observed a live session.
    const revokedAt = new Date(clockValue.getTime());
    const tokenHash = hashSessionToken(rawToken);
    const priorState = await this.sessionRepository.validate(tokenHash, revokedAt);
    const revoked = await this.sessionRepository.revoke(tokenHash, revokedAt);
    if (priorState.outcome === 'VALID' && revoked) {
      try {
        await this.auditService.record({
          familyId: priorState.session.familyId,
          actionType: 'DEVICE_LIFECYCLE_TRANSITION',
          actorDeviceId: priorState.session.deviceId,
          actorMemberId: null,
          targetScope: { kind: 'DEVICE', id: priorState.session.deviceId },
          authorizationRole: null,
          trustSetEpoch: 0,
          policyRevision: null,
          clientMonotonicSequence: null,
          resultStatus: 'SUCCESS',
          targetAcknowledgementCount: 0,
          reasonCategory: null,
          correlationId: null,
          actionId: null,
          freeTextNote: 'DEVICE_SESSION_REVOKED',
        });
        this.auditAppendFailureCount = 0;
      } catch {
        // The session repository already revoked the bearer. Reporting
        // failure would misstate committed state and a retry cannot recreate
        // this one-shot transition audit. Keep operational visibility without
        // including session, device, family, or token identifiers.
        this.auditAppendFailureCount += 1;
        if (this.auditAppendFailureCount === 1 || this.auditAppendFailureCount % 100 === 0) {
          try {
            this.observeRevocationAuditFailure({
              event: 'device_session_revocation_audit_append_failed',
              occurrences: this.auditAppendFailureCount,
            });
          } catch {
            // Operational reporting is best-effort too; revocation committed.
          }
        }
      }
    }
  }
}

function isValidFamilySessionEpoch(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= 0xffff_ffff;
}

function isValidSessionSnapshot(value: unknown, expectedTokenHash: string): value is DeviceSessionRecord {
  if (!value || typeof value !== 'object') return false;
  const session = value as DeviceSessionRecord;
  return typeof session.sessionId === 'string' && session.sessionId.length > 0 &&
    session.tokenHash === expectedTokenHash &&
    typeof session.deviceId === 'string' && session.deviceId.length > 0 &&
    typeof session.familyId === 'string' && session.familyId.length > 0 &&
    typeof session.dskKeyId === 'string' && session.dskKeyId.length > 0 &&
    typeof session.dskPublicKey === 'string' && session.dskPublicKey.length > 0 &&
    (session.purpose === 'ACTIVE' && session.activationTargetGeneration === null && session.bootstrapChallengeId === null ||
      session.purpose === 'PAIRED_BOOTSTRAP' && Number.isSafeInteger(session.activationTargetGeneration) &&
        (session.activationTargetGeneration as number) >= 1 && typeof session.bootstrapChallengeId === 'string' &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(session.bootstrapChallengeId)) &&
    isValidFamilySessionEpoch(session.familySessionEpoch) &&
    isSupportedChallengeTime(session.issuedAt) && isSupportedChallengeTime(session.expiresAt) &&
    session.expiresAt.getTime() > session.issuedAt.getTime() &&
    session.revokedAt === null;
}
