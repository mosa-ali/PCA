// Shared types for the trusted-browser E2EE family-data architecture.
// This package holds NO real cryptography and NO backend transport -- it is
// pure, browser-neutral logic (state machines + verification predicates)
// that the parent-web app wires up to real WebCrypto and real HTTP.

/**
 * Local endpoint trust state, mirrored from parent-web's
 * src/domain/trustedBrowser.ts TrustedBrowserState so this package can
 * reason about it without a circular dependency on the app. Keep these two
 * lists in sync by construction (see test/familyTrustSet.test.mjs, which
 * asserts every state used by this package's logic is one of these).
 */
export type TrustedEndpointState =
  | 'BROWSER_NOT_TRUSTED'
  | 'PAIRING_REQUIRED'
  | 'PAIRING_PENDING'
  | 'TRUSTED'
  | 'EPOCH_STALE'
  | 'REVOKED';

/**
 * A Family Trust Set (FTS) -- the signed, epoch-bound list of endpoints
 * authorized to hold family decryption/signing keys. The actual signature
 * verification (was this FTS genuinely signed by the family owner's root
 * authority) is part of the not-yet-reviewed crypto suite and is NOT
 * performed here -- this module only checks the *local, non-cryptographic*
 * facts a browser can and must check before it would ever attempt to trust
 * an FTS: is it the epoch we expect, has it expired, is our own endpoint
 * listed and not revoked.
 */
export interface FamilyTrustSet {
  familyId: string;
  epoch: number;
  issuedAtUtc: string;
  /** ISO timestamp after which this FTS must no longer be treated as current. */
  expiresAtUtc: string;
  /** Endpoint ids explicitly revoked as of this epoch. */
  revokedEndpointIds: string[];
  /** Endpoint ids currently authorized to hold family keys as of this epoch. */
  authorizedEndpointIds: string[];
}

export type FtsVerificationResultCode =
  | 'CURRENT'
  | 'STALE_EPOCH'
  | 'EXPIRED'
  | 'ENDPOINT_REVOKED'
  | 'ENDPOINT_NOT_AUTHORIZED';

export interface FtsVerificationResult {
  ok: boolean;
  code: FtsVerificationResultCode;
  reason: string;
}

/** Opaque, still-encrypted family data envelope as received from the sync relay. This package never inspects `payloadCiphertextBase64`. */
export interface EncryptedFamilyEnvelope {
  envelopeId: string;
  familyId: string;
  targetEndpointId: string;
  /** The FTS epoch the envelope was encrypted under -- must match (or be covered by) the locally-verified current epoch before decrypt is even attempted. */
  ftsEpoch: number;
  payloadCiphertextBase64: string;
  createdAtUtc: string;
}

export type EnvelopeReceiptState =
  | 'RECEIVED'
  | 'PENDING_DECRYPT'
  | 'DECRYPT_BLOCKED_CRYPTO_REVIEW'
  | 'DECRYPT_BLOCKED_UNTRUSTED_ENDPOINT'
  | 'DECRYPT_BLOCKED_STALE_FTS'
  | 'DECRYPTED';

export interface EnvelopeReceipt {
  envelope: EncryptedFamilyEnvelope;
  state: EnvelopeReceiptState;
  receivedAtUtc: string;
  lastAttemptAtUtc: string | null;
  /** Present only once state === 'DECRYPTED'. This package never produces this value itself (see decryptEnvelope in envelopeReceipt.ts) -- a caller-supplied decryptor would. */
  decryptedPayload: unknown | null;
}

export type CryptoGateStatus = 'NOT_READY_CRYPTO_REVIEW' | 'READY';

export interface CryptoGateDecision {
  status: CryptoGateStatus;
  reason: string;
}
