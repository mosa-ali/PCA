// WAVE 6B shared fixtures for the first-device trust-root bootstrap unit
// tests. NOT a test file itself (no *.test.mjs suffix): it is imported by
// firstDeviceBootstrapService.test.mjs and attestationBoundary.test.mjs so
// the two files exercise the SAME perfect-input pipeline instead of two
// drifting copies of the crypto plumbing.
//
// Everything here builds REAL P-256 material with the exact acceptance
// surface production uses: SEC1 uncompressed public points, low-S IEEE-P1363
// signatures re-canonicalized via the deviceauth helper, unpadded base64url
// (identical to backend/test/familytrustset/trustSetEpochAcceptance.test.mjs
// and backend/test/db/familyTrustSetEpochAcceptance.mysql.test.mjs -- no
// shared signing helper exists under backend/test, so this module is that
// helper for the Wave 6B files).
import { generateKeyPairSync, randomBytes, randomUUID, sign as cryptoSign } from 'node:crypto';
import { canonicalizeP256Signature } from '../../dist/deviceauth/P256DeviceSignatureVerifier.js';
import { canonicalizeTrustSetEpoch } from '../../dist/familytrustset/canonicalize.js';
import { canonicalizeFirstDeviceBootstrapProof, sha256Hex } from '../../dist/familytrustset/FirstDeviceBootstrapProof.js';

export { sha256Hex };

/** SEC1 uncompressed point (0x04 || x || y), unpadded base64url. */
export function publicPointFromJwk(jwk) {
  const decode = (value) => Buffer.from(value, 'base64url');
  return Buffer.concat([Buffer.from([0x04]), decode(jwk.x), decode(jwk.y)]).toString('base64url');
}

export function makeP256Device(label = 'dsk') {
  const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  return {
    label,
    deviceId: randomUUID(),
    dskKeyId: randomUUID(),
    dskPublicKey: publicPointFromJwk(pair.publicKey.export({ format: 'jwk' })),
    dskPrivateKey: pair.privateKey,
    dekKeyId: `${label}-dek-${randomUUID()}`,
    dekPublicKey: randomBytes(32).toString('base64url'),
  };
}

/** Low-S IEEE-P1363, unpadded base64url — the exact form every strict P-256 verifier here accepts. */
export function signCanonical(privateKey, canonicalBytes) {
  const signature = cryptoSign('sha256', Buffer.from(canonicalBytes, 'utf8'), {
    key: privateKey,
    dsaEncoding: 'ieee-p1363',
  });
  return canonicalizeP256Signature(signature).toString('base64url');
}

/** Whole-second instant, so ISO round-trips are exact fixtures. */
export function stamp(offsetMs = 0) {
  const value = new Date(Date.now() + offsetMs);
  value.setUTCMilliseconds(0);
  return value;
}

export function makeAttempt(device, overrides = {}) {
  const rawRecoveryToken = randomBytes(32).toString('base64url');
  const attemptId = randomBytes(24).toString('base64url');
  return {
    attemptId,
    rawRecoveryToken,
    attempt: {
      attemptId,
      deviceId: device.deviceId,
      familyId: `family-${randomUUID()}`,
      platform: 'ANDROID',
      recoveryTokenHash: sha256Hex(rawRecoveryToken),
      signingKeyId: device.dskKeyId,
      signingPublicKey: device.dskPublicKey,
      ...overrides,
    },
  };
}

export function buildCeremonyRecord(attempt, overrides = {}) {
  return {
    ceremonyId: randomUUID(),
    familyId: attempt.familyId,
    deviceId: attempt.deviceId,
    dskKeyId: attempt.signingKeyId,
    dskPublicKey: attempt.signingPublicKey,
    dskAlgorithm: 'ECDSA_P256_SHA256',
    purpose: 'PCA_FIRST_DEVICE_BOOTSTRAP_V1',
    challengeId: randomUUID(),
    nonce: randomBytes(32).toString('base64url'),
    expiresAt: stamp(10 * 60_000),
    status: 'APPROVED',
    approvedByAccountId: randomUUID(),
    approvedAt: stamp(),
    payloadDigest: null,
    bootstrapProofSha256: null,
    attestationEvidenceSha256: null,
    outcome: null,
    consumedAt: null,
    createdAt: stamp(),
    updatedAt: stamp(),
    ...overrides,
  };
}

/** The canonical epoch-1 (statement B) for one OWNER device, signed by its DSK. */
export function buildEpoch1(familyId, device, overrides = {}) {
  const fields = {
    familyId,
    trustSetEpoch: 1,
    keyEpoch: 1,
    supersedesEpoch: null,
    issuedAt: stamp(),
    entries: [
      {
        deviceId: device.deviceId,
        role: 'OWNER',
        dskKeyId: device.dskKeyId,
        dskPublicKey: device.dskPublicKey,
        dekKeyId: device.dekKeyId,
        dekPublicKey: device.dekPublicKey,
        status: 'ACTIVE',
      },
    ],
    ...overrides,
  };
  const bytes = canonicalizeTrustSetEpoch(fields);
  return { fields, bytes, signature: signCanonical(device.dskPrivateKey, bytes) };
}

/**
 * A byte-perfect submission: proof + epoch-1 bound to the SAME ceremony,
 * attempt and DSK, with both statements signed by the device key. Tests
 * mutate one aspect at a time from this base to isolate each rejection.
 */
export function buildPerfectSubmission({ attempt, ceremony, device, attestationEvidence = null, epochOverrides = {}, proofOverrides = {} }) {
  const epoch = buildEpoch1(attempt.familyId, device, epochOverrides);
  const proofFields = {
    familyId: ceremony.familyId,
    deviceId: ceremony.deviceId,
    ceremonyId: ceremony.ceremonyId,
    challengeId: ceremony.challengeId,
    nonce: ceremony.nonce,
    expiresAt: ceremony.expiresAt,
    dskKeyId: ceremony.dskKeyId,
    dskPublicKey: ceremony.dskPublicKey,
    epoch1Sha256Hex: sha256Hex(Buffer.from(epoch.bytes, 'utf8')),
    attestationEvidenceDigest: attestationEvidence === null ? null : sha256Hex(attestationEvidence),
    ...proofOverrides,
  };
  const proofBytes = canonicalizeFirstDeviceBootstrapProof(proofFields);
  return {
    epoch,
    proofFields,
    proofBytes,
    proofSignature: signCanonical(device.dskPrivateKey, proofBytes),
    epoch1Bytes: epoch.bytes,
    epoch1Signature: epoch.signature,
    attestationEvidence,
  };
}

export function submissionInput(attempt, rawRecoveryToken, ceremony, submission, overrides = {}) {
  return {
    attemptId: attempt.attemptId,
    attemptRecoveryToken: rawRecoveryToken,
    ceremonyId: ceremony.ceremonyId,
    proofBytes: submission.proofBytes,
    proofSignature: submission.proofSignature,
    epoch1Bytes: submission.epoch1Bytes,
    epoch1Signature: submission.epoch1Signature,
    attestationEvidence: submission.attestationEvidence,
    ...overrides,
  };
}

/** Scripted store: the service's six-method contract with mutable state. */
export class FakeFirstDeviceBootstrapStore {
  constructor({ attempt = null, ceremony = null } = {}) {
    this.attempt = attempt;
    this.ceremony = ceremony;
    this.ceremonies = ceremony ? [ceremony] : [];
    this.eligibility = true;
    this.createOutcome = null;
    this.approveOutcome = null;
    this.commitOutcome = { outcome: 'ACCEPTED' };
    this.commitCalls = [];
    this.createCalls = [];
    this.approveCalls = [];
    this.listCalls = [];
    /** When true, a successful commit transitions the fake ceremony to COMMITTED (durable replay semantics). */
    this.commitTransitions = true;
  }

  async readAttemptContext(attemptId) {
    return this.attempt && this.attempt.attemptId === attemptId ? { ...this.attempt } : null;
  }

  async readCeremony(ceremonyId) {
    return this.ceremony && this.ceremony.ceremonyId === ceremonyId ? { ...this.ceremony } : null;
  }

  async readOwnerEligibility(familyId, accountId) {
    return this.eligibility && typeof familyId === 'string' && typeof accountId === 'string';
  }

  async listApprovalCeremonies(familyId, now, limit) {
    this.listCalls.push({ familyId, now, limit });
    return this.ceremonies
      .filter((ceremony) => ceremony.familyId === familyId && ['PENDING', 'APPROVED'].includes(ceremony.status) && ceremony.expiresAt > now)
      .sort((left, right) => right.createdAt - left.createdAt)
      .slice(0, limit)
      .map((ceremony) => ({ ...ceremony }));
  }

  async createOrReuseCeremony(input) {
    this.createCalls.push(input);
    if (this.createOutcome) return this.createOutcome;
    const ceremony = {
      ceremonyId: randomUUID(),
      familyId: input.familyId,
      deviceId: input.deviceId,
      dskKeyId: input.dskKeyId,
      dskPublicKey: input.dskPublicKey,
      dskAlgorithm: input.dskAlgorithm,
      purpose: input.purpose,
      challengeId: input.challengeId,
      nonce: input.nonce,
      expiresAt: input.expiresAt,
      status: 'PENDING',
      approvedByAccountId: null,
      approvedAt: null,
      payloadDigest: null,
      outcome: null,
      consumedAt: null,
      createdAt: input.now,
      updatedAt: input.now,
    };
    this.ceremony = ceremony;
    return { outcome: 'CREATED', ceremony };
  }

  async approveCeremony(input) {
    this.approveCalls.push(input);
    if (this.approveOutcome) return this.approveOutcome;
    if (!this.ceremony || this.ceremony.ceremonyId !== input.ceremonyId || this.ceremony.familyId !== input.familyId) {
      return { outcome: 'NOT_FOUND' };
    }
    if (this.ceremony.status !== 'PENDING') return { outcome: 'NOT_PENDING' };
    if (this.ceremony.expiresAt.getTime() <= input.now.getTime()) return { outcome: 'EXPIRED' };
    if (!(await this.readOwnerEligibility(input.familyId, input.accountId))) return { outcome: 'NOT_ELIGIBLE' };
    this.ceremony = { ...this.ceremony, status: 'APPROVED', approvedByAccountId: input.accountId, approvedAt: input.now };
    return { outcome: 'APPROVED', ceremony: this.ceremony };
  }

  async commitBootstrap(input) {
    this.commitCalls.push(input);
    if (this.commitOutcome.outcome === 'ACCEPTED' && this.commitTransitions && this.ceremony) {
      this.ceremony = {
        ...this.ceremony,
        status: 'COMMITTED',
        outcome: 'ACCEPTED',
        payloadDigest: input.payloadDigest,
        bootstrapProofSha256: input.bootstrapProofSha256,
        attestationEvidenceSha256: input.attestationEvidenceSha256,
        consumedAt: input.now,
      };
    }
    return this.commitOutcome;
  }
}

/** Records every call. With no scripted verdict (the default), answers VERIFIED by ECHOING the
 * expected DSK triple and the null-safe evidence digest -- the exact shape a correct 6C/6D verifier
 * must produce after independently validating evidence. Scripted verdicts (see verifiedVerdict)
 * override that behavior; mismatch cases use MismatchedAttestationVerifier. */
export class ScriptedAttestationVerifier {
  constructor(verdict = null) {
    this.verdict = verdict;
    this.calls = [];
  }

  async verifyFirstDeviceAttestation(input) {
    this.calls.push(input);
    return this.verdict ?? verifiedVerdict(input);
  }
}

/** A correct-shape VERIFIED verdict for the given input, with optional field overrides. */
export function verifiedVerdict(input, overrides = {}) {
  return {
    status: 'VERIFIED',
    evidenceDigest: input.attestationEvidence === null ? null : sha256Hex(input.attestationEvidence),
    attestedDskKeyId: input.expectedDskKeyId,
    attestedDskPublicKey: input.expectedDskPublicKey,
    attestedDskAlgorithm: input.expectedDskAlgorithm,
    ...overrides,
  };
}

/** Answers VERIFIED but with one or more attested fields deliberately wrong (R1-04/05/06 mismatch tests). */
export class MismatchedAttestationVerifier {
  constructor(overrides = {}) {
    this.overrides = overrides;
    this.calls = [];
  }

  async verifyFirstDeviceAttestation(input) {
    this.calls.push(input);
    return verifiedVerdict(input, this.overrides);
  }
}

/** Throws if invoked — proves a code path never re-runs attestation. */
export class ExplodingAttestationVerifier {
  async verifyFirstDeviceAttestation() {
    throw new Error('attestation verifier must NOT be called on this path');
  }
}
