import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { canonicalizeTrustSetEpoch } from './canonicalize.js';
import { decodeCanonicalTrustSetEpoch, MAX_CANONICAL_TRUST_SET_LENGTH } from './decode.js';
import { activeOwnerCount, findActiveOwner, findDuplicateIdentity } from './FamilyTrustSetEngine.js';
import { isDistinctKeyPair } from './policy.js';
import { P256TrustSetSignatureVerifier } from './P256TrustSetSignatureVerifier.js';
import {
  BOOTSTRAP_CHALLENGE_TTL_MS,
  BOOTSTRAP_PROOF_DOMAIN,
  BOOTSTRAP_PROTOCOL_VERSION,
  DSK_ALGORITHM,
  decodeFirstDeviceBootstrapProof,
  sha256Hex,
  verifyFirstDeviceBootstrapProofSignature,
} from './FirstDeviceBootstrapProof.js';
import { computeFirstDeviceBootstrapCommitDigest } from './FirstDeviceBootstrapCommit.js';
import type { FirstDeviceAttemptContext, FirstDeviceBootstrapCeremonyRecord, FirstDeviceBootstrapStore } from './FirstDeviceBootstrapStore.js';
import type { AttestationVerifier } from './AttestationVerifier.js';
import type { TrustSetEpochRecord } from './TrustSetEpochStore.js';

/**
 * Wave 6B first-device trust-root bootstrap service.
 *
 * Initiator model (§2): ONLY the unique provisioned owner (an ACTIVE
 * Administrator of a non-suspended family, with a VERIFIED, enabled account)
 * may approve a ceremony. Ambiguity fails closed -- a NULL or mismatched
 * provisioned owner can never approve.
 *
 * Candidate model (§4): the candidate device must already exist in the
 * canonical device lifecycle for the family (pre-active: PAIRING_PENDING or
 * PAIRED); no new lifecycle, no new device states. Its DSK -- the exact key
 * registered at enrollment -- is the ONLY key any ceremony may claim
 * (amendment M1).
 *
 * Dual-signature model (§3, ruling F4): a committed root requires BOTH
 *  (A) the domain-separated PCA_FIRST_DEVICE_BOOTSTRAP_V1 proof, binding the
 *      complete ceremony context and sha256 of the exact canonical epoch-1
 *      bytes, signed by the DSK; and
 *  (B) the ordinary Wave-5B epoch-1 signature over the unchanged certified
 *      canonical epoch bytes, verified by the certified verifier.
 * Neither statement may stand in for the other: the proof grammar is
 * domain-led and structurally disjoint from the epoch grammar, and BOTH
 * signatures are verified independently over their own exact byte strings.
 *
 * Challenge model (§5): a durable, short-lived, one-time challenge bound to
 * family + device + ceremony + purpose + expiry + DSK key id. Every failed
 * submission rolls back completely, so the challenge is consumed ONLY by a
 * successful atomic commit; a committed ceremony then replays idempotently
 * by payload digest (amendment M3) and any different payload is rejected.
 *
 * Wire vocabulary is enumeration-safe (§13): device-facing failures collapse
 * into a single 'UNAVAILABLE' / 'REJECTED' answer with no oracle for family
 * existence, attempt state, ceremony state or verification cause.
 */

export interface IssueChallengeInput {
  attemptId: string;
  attemptRecoveryToken: string;
  dskKeyId: string;
  dskPublicKey: string;
}

export type IssueChallengeOutcome =
  | {
      status: 'PENDING';
      ceremonyId: string;
      challengeId: string;
      nonce: string;
      expiresAt: string;
      familyId: string;
      deviceId: string;
    }
  | { status: 'UNAVAILABLE' };

export interface SubmitBootstrapInput {
  attemptId: string;
  attemptRecoveryToken: string;
  ceremonyId: string;
  proofBytes: string;
  proofSignature: string;
  epoch1Bytes: string;
  epoch1Signature: string;
  attestationEvidence: string | null;
}

export type SubmitBootstrapOutcome = { status: 'ACCEPTED' } | { status: 'REJECTED' } | { status: 'UNAVAILABLE' };

export interface ReadStatusInput {
  attemptId: string;
  attemptRecoveryToken: string;
  ceremonyId: string;
}

export type ReadStatusOutcome =
  | { status: 'PENDING' | 'APPROVED' | 'COMMITTED' | 'EXPIRED'; outcome: 'ACCEPTED' | null }
  | { status: 'UNAVAILABLE' };

export type ApproveCeremonyServiceOutcome =
  | { status: 'APPROVED'; ceremony: FirstDeviceBootstrapCeremonyRecord }
  | { status: 'NOT_FOUND' }
  | { status: 'NOT_APPROVABLE' }
  | { status: 'NOT_ELIGIBLE' };

export interface FirstDeviceBootstrapServiceDeps {
  store: FirstDeviceBootstrapStore;
  attestationVerifier: AttestationVerifier;
  now?: () => Date;
}

const MAX_ATTEMPT_CREDENTIAL_LENGTH = 512;
const MAX_ATTESTATION_EVIDENCE_BYTES = 16_384;
const MAX_APPROVAL_CEREMONIES = 25;

export class FirstDeviceBootstrapService {
  private readonly store: FirstDeviceBootstrapStore;
  private readonly attestationVerifier: AttestationVerifier;
  private readonly now: () => Date;
  private readonly epochVerifier = new P256TrustSetSignatureVerifier();

  constructor(deps: FirstDeviceBootstrapServiceDeps) {
    this.store = deps.store;
    this.attestationVerifier = deps.attestationVerifier;
    this.now = deps.now ?? (() => new Date());
  }

  /**
   * Owner-facing approval surface helpers. `describeForApproval` is
   * family-scoped (a cross-family ceremony id reads as not found), and the
   * raw key material is returned so the route can present a fingerprint of
   * the key that will become the root (amendment M1's approval UX).
   */
  async describeForApproval(familyId: string, ceremonyId: string): Promise<FirstDeviceBootstrapCeremonyRecord | null> {
    if (typeof familyId !== 'string' || typeof ceremonyId !== 'string') return null;
    const ceremony = await this.store.readCeremony(ceremonyId);
    if (!ceremony || ceremony.familyId !== familyId) return null;
    return ceremony;
  }

  async checkApprovalEligibility(familyId: string, accountId: string): Promise<boolean> {
    if (typeof familyId !== 'string' || typeof accountId !== 'string') return false;
    return this.store.readOwnerEligibility(familyId, accountId);
  }

  /** Owner-only discovery surface; never query another family's ceremony rows. */
  async listForApproval(
    familyId: string,
    accountId: string,
  ): Promise<FirstDeviceBootstrapCeremonyRecord[] | null> {
    if (typeof familyId !== 'string' || typeof accountId !== 'string') return null;
    if (!(await this.store.readOwnerEligibility(familyId, accountId))) return null;
    return this.store.listApprovalCeremonies(familyId, this.now(), MAX_APPROVAL_CEREMONIES);
  }

  async approve(input: {
    ceremonyId: string;
    familyId: string;
    accountId: string;
  }): Promise<ApproveCeremonyServiceOutcome> {
    const now = this.now();
    const result = await this.store.approveCeremony({
      ceremonyId: input.ceremonyId,
      familyId: input.familyId,
      accountId: input.accountId,
      now,
    });
    switch (result.outcome) {
      case 'APPROVED':
        return { status: 'APPROVED', ceremony: result.ceremony };
      case 'NOT_FOUND':
        return { status: 'NOT_FOUND' };
      case 'NOT_ELIGIBLE':
        return { status: 'NOT_ELIGIBLE' };
      default:
        return { status: 'NOT_APPROVABLE' };
    }
  }

  /** Device-facing: mint/reuse the durable one-time challenge (ceremony A). */
  async issueChallenge(input: IssueChallengeInput): Promise<IssueChallengeOutcome> {
    if (
      typeof input.attemptId !== 'string' ||
      typeof input.attemptRecoveryToken !== 'string' ||
      typeof input.dskKeyId !== 'string' ||
      typeof input.dskPublicKey !== 'string'
    ) {
      return { status: 'UNAVAILABLE' };
    }

    const attempt = await this.store.readAttemptContext(input.attemptId);
    if (!attempt || !this.verifyAttemptToken(attempt, input.attemptRecoveryToken)) {
      return { status: 'UNAVAILABLE' };
    }
    // M1: the ceremony may ONLY ever carry the enrollment attempt's DSK.
    if (input.dskKeyId !== attempt.signingKeyId || input.dskPublicKey !== attempt.signingPublicKey) {
      return { status: 'UNAVAILABLE' };
    }

    const now = this.now();
    const created = await this.store.createOrReuseCeremony({
      familyId: attempt.familyId,
      deviceId: attempt.deviceId,
      dskKeyId: attempt.signingKeyId,
      dskPublicKey: attempt.signingPublicKey,
      dskAlgorithm: DSK_ALGORITHM,
      purpose: BOOTSTRAP_PROOF_DOMAIN,
      nonce: randomBytes(32).toString('base64url'),
      challengeId: randomUUID(),
      expiresAt: new Date(now.getTime() + BOOTSTRAP_CHALLENGE_TTL_MS),
      now,
    });
    if (created.outcome === 'CONFLICT' || created.outcome === 'DEVICE_NOT_ELIGIBLE') {
      return { status: 'UNAVAILABLE' };
    }

    const ceremony = created.ceremony;
    return {
      status: 'PENDING',
      ceremonyId: ceremony.ceremonyId,
      challengeId: ceremony.challengeId,
      nonce: ceremony.nonce,
      expiresAt: ceremony.expiresAt.toISOString(),
      familyId: ceremony.familyId,
      deviceId: ceremony.deviceId,
    };
  }

  /** Device-facing: the ceremony's stable status/outcome (ceremony C). */
  async readStatus(input: ReadStatusInput): Promise<ReadStatusOutcome> {
    if (typeof input.attemptId !== 'string' || typeof input.attemptRecoveryToken !== 'string' || typeof input.ceremonyId !== 'string') {
      return { status: 'UNAVAILABLE' };
    }
    const attempt = await this.store.readAttemptContext(input.attemptId);
    if (!attempt || !this.verifyAttemptToken(attempt, input.attemptRecoveryToken)) {
      return { status: 'UNAVAILABLE' };
    }
    const ceremony = await this.store.readCeremony(input.ceremonyId);
    if (!ceremony || ceremony.familyId !== attempt.familyId || ceremony.deviceId !== attempt.deviceId) {
      return { status: 'UNAVAILABLE' };
    }
    if (ceremony.status === 'COMMITTED') {
      return { status: 'COMMITTED', outcome: ceremony.outcome === 'ACCEPTED' ? 'ACCEPTED' : null };
    }
    if (ceremony.expiresAt.getTime() <= this.now().getTime()) {
      return { status: 'EXPIRED', outcome: null };
    }
    return { status: ceremony.status, outcome: null };
  }

  /**
   * Device-facing: submit the dual-signed bootstrap (ceremony B). Ordering
   * here is itself a security property:
   *   1. attempt credential (constant-time) -> family/device binding;
   *   2. REPLAY FIRST: a committed ceremony answers by payload digest with NO
   *      re-verification, so response-loss retries recover idempotently and a
   *      different payload can never re-enter verification (M3);
   *   3. state gates (APPROVED, unexpired);
   *   4. proof decode (strict, bounded) and total field-equality against the
   *      durable ceremony + attempt (H4) -- the ceremony, not the caller, is
   *      the authority for every challenge field;
   *   5. statement (A) signature over the exact proof bytes;
   *   6. epoch-1: size, strict decode, byte identity, family binding,
   *      exactly-one-ACTIVE-OWNER, cross-entry key uniqueness, exact epoch
   *      numbers (1/1, supersedes null), owner triple equality, sha256
   *      binding to the proof, statement (B) signature via the certified
   *      verifier;
   *   7. attestation last: fail-closed verifier MUST return VERIFIED and its
   *      evidence digest MUST equal both the caller's evidence digest and
   *      the digest bound inside the proof;
   *   8. one atomic store commit (challenge consumed only on success).
   */
  async submit(input: SubmitBootstrapInput): Promise<SubmitBootstrapOutcome> {
    const rejected: SubmitBootstrapOutcome = { status: 'REJECTED' };
    const unavailable: SubmitBootstrapOutcome = { status: 'UNAVAILABLE' };
    if (
      typeof input.attemptId !== 'string' ||
      typeof input.attemptRecoveryToken !== 'string' ||
      typeof input.ceremonyId !== 'string' ||
      typeof input.proofBytes !== 'string' ||
      typeof input.proofSignature !== 'string' ||
      typeof input.epoch1Bytes !== 'string' ||
      typeof input.epoch1Signature !== 'string' ||
      (input.attestationEvidence !== null && typeof input.attestationEvidence !== 'string')
    ) {
      return unavailable;
    }
    if (input.attestationEvidence !== null && Buffer.byteLength(input.attestationEvidence, 'utf8') > MAX_ATTESTATION_EVIDENCE_BYTES) {
      return unavailable;
    }

    // ---- 1. Attempt credential + family/device binding ----
    const attempt = await this.store.readAttemptContext(input.attemptId);
    if (!attempt || !this.verifyAttemptToken(attempt, input.attemptRecoveryToken)) return unavailable;
    const ceremony = await this.store.readCeremony(input.ceremonyId);
    if (!ceremony || ceremony.familyId !== attempt.familyId || ceremony.deviceId !== attempt.deviceId) return unavailable;

    const payloadDigest = computeFirstDeviceBootstrapCommitDigest(input);

    // ---- 2. Replay classification FIRST (M3) ----
    if (ceremony.status === 'COMMITTED') {
      return ceremony.payloadDigest === payloadDigest ? { status: 'ACCEPTED' } : rejected;
    }
    if (ceremony.status !== 'APPROVED') return unavailable;
    const now = this.now();
    if (ceremony.expiresAt.getTime() <= now.getTime()) return unavailable;

    // ---- 4. Proof decode + total field-equality against the durable ceremony ----
    let proof;
    try {
      proof = decodeFirstDeviceBootstrapProof(input.proofBytes);
    } catch {
      return rejected;
    }
    if (
      proof.familyId !== ceremony.familyId ||
      proof.familyId !== attempt.familyId ||
      proof.deviceId !== ceremony.deviceId ||
      proof.deviceId !== attempt.deviceId ||
      proof.ceremonyId !== ceremony.ceremonyId ||
      proof.challengeId !== ceremony.challengeId ||
      proof.nonce !== ceremony.nonce ||
      proof.expiresAt.getTime() !== ceremony.expiresAt.getTime() ||
      proof.dskKeyId !== ceremony.dskKeyId ||
      proof.dskKeyId !== attempt.signingKeyId ||
      proof.dskPublicKey !== ceremony.dskPublicKey ||
      proof.dskPublicKey !== attempt.signingPublicKey
    ) {
      return rejected;
    }

    // ---- 5. Statement (A): the bootstrap proof signature ----
    if (!verifyFirstDeviceBootstrapProofSignature(proof.dskPublicKey, input.proofBytes, input.proofSignature)) {
      return rejected;
    }

    // ---- 6. Epoch-1 (statement B) under the unchanged certified format ----
    if (Buffer.byteLength(input.epoch1Bytes, 'utf8') > MAX_CANONICAL_TRUST_SET_LENGTH) return rejected;
    let epoch;
    try {
      epoch = decodeCanonicalTrustSetEpoch(input.epoch1Bytes);
    } catch {
      return rejected;
    }
    if (canonicalizeTrustSetEpoch(epoch) !== input.epoch1Bytes) return rejected;
    if (epoch.familyId !== ceremony.familyId) return rejected;
    if (
      activeOwnerCount(epoch.entries) !== 1 ||
      findDuplicateIdentity(epoch.entries) ||
      !epoch.entries.every((entry) => isDistinctKeyPair(entry.dskPublicKey, entry.dekPublicKey))
    ) {
      return rejected;
    }
    const owner = findActiveOwner(epoch);
    if (!owner) return rejected;
    if (epoch.trustSetEpoch !== 1 || epoch.keyEpoch !== 1 || epoch.supersedesEpoch !== null) return rejected;
    if (
      owner.deviceId !== proof.deviceId ||
      owner.dskKeyId !== proof.dskKeyId ||
      owner.dskPublicKey !== proof.dskPublicKey
    ) {
      return rejected;
    }
    if (sha256Hex(Buffer.from(input.epoch1Bytes, 'utf8')) !== proof.epoch1Sha256Hex) return rejected;
    if (!(await this.epochVerifier.verify(proof.dskPublicKey, input.epoch1Bytes, input.epoch1Signature))) {
      return rejected;
    }

    // ---- 7. Attestation: fail closed; evidence digest-bound in both directions; the
    //         attested key identity must equal the exact DSK the ceremony anchors (R1-02) ----
    const evidenceDigest = input.attestationEvidence === null ? null : sha256Hex(input.attestationEvidence);
    const attestation = await this.attestationVerifier.verifyFirstDeviceAttestation({
      familyId: attempt.familyId,
      deviceId: attempt.deviceId,
      ceremonyId: ceremony.ceremonyId,
      challengeId: ceremony.challengeId,
      nonce: ceremony.nonce,
      platform: attempt.platform,
      attestationEvidence: input.attestationEvidence,
      expectedDskKeyId: ceremony.dskKeyId,
      expectedDskPublicKey: ceremony.dskPublicKey,
      expectedDskAlgorithm: ceremony.dskAlgorithm,
      now,
    });
    if (attestation.status !== 'VERIFIED') return rejected;
    if (attestation.evidenceDigest !== evidenceDigest) return rejected;
    if (proof.attestationEvidenceDigest !== evidenceDigest) return rejected;
    if (attestation.attestedDskKeyId !== ceremony.dskKeyId) return rejected;
    if (attestation.attestedDskPublicKey !== ceremony.dskPublicKey) return rejected;
    if (attestation.attestedDskAlgorithm !== ceremony.dskAlgorithm) return rejected;

    // ---- 8. One atomic commit (or full rollback; challenge consumed only on success) ----
    const epochRecord: TrustSetEpochRecord = {
      familyId: ceremony.familyId,
      trustSetEpoch: 1,
      keyEpoch: 1,
      supersedesEpoch: null,
      signedEpochBytes: Buffer.from(input.epoch1Bytes, 'utf8'),
      signature: input.epoch1Signature,
      signerKeyId: proof.dskKeyId,
      signerDeviceId: proof.deviceId,
      issuedAt: epoch.issuedAt,
      receivedAt: now,
    };
    const commit = await this.store.commitBootstrap({
      ceremonyId: ceremony.ceremonyId,
      payloadDigest,
      bootstrapProofSha256: sha256Hex(input.proofBytes),
      attestationEvidenceSha256: evidenceDigest,
      anchor: {
        deviceId: proof.deviceId,
        dskKeyId: proof.dskKeyId,
        dskPublicKey: proof.dskPublicKey,
        signature: input.proofSignature,
        createdAt: now,
      },
      epochRecord,
      now,
    });
    return commit.outcome === 'ACCEPTED' || commit.outcome === 'IDEMPOTENT_ACCEPTED' ? { status: 'ACCEPTED' } : rejected;
  }

  /**
   * Constant-time check of the attempt recovery credential, mirroring
   * EnrollmentCoordinator.recoverAttempt: hash the presented token (sha256
   * hex) and timingSafeEqual against the stored hash. Shape errors and
   * mismatches are indistinguishable to the caller.
   */
  private verifyAttemptToken(attempt: FirstDeviceAttemptContext, token: string): boolean {
    if (typeof token !== 'string' || token.length === 0 || token.length > MAX_ATTEMPT_CREDENTIAL_LENGTH) return false;
    const presented = Buffer.from(sha256Hex(token), 'hex');
    let stored: Buffer;
    try {
      stored = Buffer.from(attempt.recoveryTokenHash, 'hex');
    } catch {
      return false;
    }
    if (stored.length !== presented.length) return false;
    return timingSafeEqual(stored, presented);
  }
}

export { BOOTSTRAP_PROTOCOL_VERSION };
