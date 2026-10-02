import type { TrustSetEpochRecord } from './TrustSetEpochStore.js';
import type { PoolConnection } from 'mysql2/promise';

/**
 * Wave 6B first-device trust-root bootstrap: durable ceremony store contract.
 *
 * The ceremony row is the durable one-time challenge + committed-result
 * record. Statuses are deliberately only PENDING -> APPROVED -> COMMITTED:
 * every verification failure leaves NO durable mutation (the whole attempt
 * transaction rolls back), so a failed attempt neither consumes the challenge
 * nor records a partial result. The challenge is consumed exactly when the
 * atomic commit succeeds, and a committed ceremony replays idempotently by
 * payload digest.
 */
export type FirstDeviceBootstrapCeremonyStatus = 'PENDING' | 'APPROVED' | 'COMMITTED';

export interface FirstDeviceBootstrapCeremonyRecord {
  ceremonyId: string;
  familyId: string;
  deviceId: string;
  dskKeyId: string;
  dskPublicKey: string;
  dskAlgorithm: string;
  purpose: string;
  challengeId: string;
  nonce: string;
  expiresAt: Date;
  status: FirstDeviceBootstrapCeremonyStatus;
  approvedByAccountId: string | null;
  approvedAt: Date | null;
  payloadDigest: string | null;
  outcome: string | null;
  consumedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Everything a device-facing request may prove about itself: the enrollment
 * bootstrap attempt record. The attempt's registered DSK is the ONLY key the
 * ceremony may ever anchor -- the ceremony's claimed dskKeyId/dskPublicKey
 * must equal these values exactly (smoke-gate amendment M1), so a stolen
 * attempt-recovery token can never substitute an attacker key.
 */
export interface FirstDeviceAttemptContext {
  attemptId: string;
  deviceId: string;
  familyId: string;
  platform: 'ANDROID' | 'IOS';
  recoveryTokenHash: string;
  signingKeyId: string;
  signingPublicKey: string;
}

export interface CreateOrReuseCeremonyInput {
  familyId: string;
  deviceId: string;
  dskKeyId: string;
  dskPublicKey: string;
  dskAlgorithm: string;
  purpose: string;
  nonce: string;
  challengeId: string;
  expiresAt: Date;
  now: Date;
}

export type CreateOrReuseCeremonyOutcome =
  | { outcome: 'CREATED'; ceremony: FirstDeviceBootstrapCeremonyRecord }
  /** A live (unexpired PENDING/APPROVED) ceremony for this device already exists with the SAME DSK claim. */
  | { outcome: 'REUSED'; ceremony: FirstDeviceBootstrapCeremonyRecord }
  /** A live ceremony exists for this device but with a DIFFERENT DSK claim. */
  | { outcome: 'CONFLICT' }
  /** Device row missing, wrong family, or not in a pre-active lifecycle state. */
  | { outcome: 'DEVICE_NOT_ELIGIBLE' };

export type ApproveCeremonyOutcome =
  | { outcome: 'APPROVED'; ceremony: FirstDeviceBootstrapCeremonyRecord }
  | { outcome: 'NOT_FOUND' }
  | { outcome: 'NOT_PENDING' }
  | { outcome: 'EXPIRED' }
  | { outcome: 'NOT_ELIGIBLE' };

export interface CommitBootstrapInput {
  ceremonyId: string;
  payloadDigest: string;
  anchor: {
    deviceId: string;
    dskKeyId: string;
    dskPublicKey: string;
    /** DSK signature over the canonical PCA_FIRST_DEVICE_BOOTSTRAP_V1 proof tuple. */
    signature: string;
    createdAt: Date;
  };
  epochRecord: TrustSetEpochRecord;
  now: Date;
}

export type CommitBootstrapOutcome =
  | { outcome: 'ACCEPTED' }
  | { outcome: 'IDEMPOTENT_ACCEPTED' }
  | { outcome: 'DIGEST_CONFLICT' }
  | { outcome: 'CEREMONY_NOT_FOUND' }
  | { outcome: 'NOT_APPROVED' }
  | { outcome: 'EXPIRED' }
  | { outcome: 'NOT_ELIGIBLE' }
  | { outcome: 'DEVICE_NOT_ELIGIBLE' }
  | { outcome: 'ALREADY_BOOTSTRAPPED' }
  /** The shared epoch append refused inside the commit transaction; nothing was persisted. */
  | { outcome: 'EPOCH_REJECTED' };

export interface FirstDeviceBootstrapStore {
  readAttemptContext(attemptId: string): Promise<FirstDeviceAttemptContext | null>;
  readCeremony(ceremonyId: string): Promise<FirstDeviceBootstrapCeremonyRecord | null>;
  /** The owner-eligibility predicate: unique provisioned owner + ACTIVE Administrator + verified/enabled account + unsuspended family. */
  readOwnerEligibility(familyId: string, accountId: string): Promise<boolean>;
  createOrReuseCeremony(input: CreateOrReuseCeremonyInput): Promise<CreateOrReuseCeremonyOutcome>;
  approveCeremony(input: { ceremonyId: string; accountId: string; familyId: string; now: Date }): Promise<ApproveCeremonyOutcome>;
  commitBootstrap(input: CommitBootstrapInput): Promise<CommitBootstrapOutcome>;
}

export type FirstDeviceBootstrapCommitHooks = {
  /** Test-only seam proving the commit is one atomic transaction (a throw here must roll back everything). Never wired in production. */
  afterAnchorInsert?: (conn: PoolConnection) => void | Promise<void>;
};
