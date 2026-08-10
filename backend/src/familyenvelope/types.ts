export type ProtocolVersion = number;
export type OpaqueFamilyId = string;
export type OpaqueDeviceId = string;
export type SenderKeyId = string;

/**
 * The family-control message types doc 05 Section 6 / doc 09 Section 4
 * enumerate. Kept as a bounded union here (not a free string) so a typo'd
 * or invented message type is a compile-time/validation error, not a
 * silently-accepted new message class.
 */
export type FamilyEnvelopeMessageType =
  | 'POLICY_PUSH'
  | 'ACTIVITY_SUMMARY'
  | 'REVOCATION_COMMAND'
  | 'STATUS_RECEIPT'
  | 'TAMPER_EVENT'
  | 'ROLLBACK';

/**
 * Protocol-neutral structure for "every family-control message" per doc 09
 * Section 4. This module NEVER decrypts, generates, or inspects `payload`
 * beyond treating it as opaque bytes -- exactly the same ciphertext-blind
 * posture as the existing Relay domain (src/relay). It also performs no
 * signature MATH (see EnvelopeSignatureVerifier) and no Family Trust Set
 * lookups (a separate, later workstream) -- this module only implements
 * the envelope's STRUCTURE and the four independent acceptance checks
 * PCA-SEC-022 requires (signature/replay/expiry/version-monotonicity),
 * plus the trustSetEpoch/keyEpoch staleness check Section 4 also requires.
 *
 * `sequenceOrNonce`: doc 09 Section 4 allows either "a monotonic sequence
 * number OR a replay-resistant nonce" per sender-key. Both are modeled as
 * one opaque string field here so the replay ledger (below) works
 * identically regardless of which a given sender implementation chooses.
 * For a ROLLBACK message it also serves as the doc's "one-time rollback
 * identifier."
 *
 * NOTE on ROLLBACK's other named fields: doc 09 Section 4 says a rollback
 * "names the exact target version, current trustSetEpoch/keyEpoch,
 * reason, and one-time rollback identifier." Target version/epochs map to
 * `dataVersion`/`trustSetEpoch`/`keyEpoch` and the rollback id maps to
 * `sequenceOrNonce` above; this slice deliberately does NOT add a
 * cleartext `reason` field -- a human-readable rollback reason is
 * FAMILY-SENSITIVE content (why a policy was rolled back), so it belongs
 * inside the authenticated-encrypted `payload`, not cleartext envelope
 * metadata that a server-side relay could ever see. This is a deliberate
 * design choice for this module, not an oversight.
 */
export interface FamilyEnvelope {
  protocolVersion: ProtocolVersion;
  familyId: OpaqueFamilyId;
  senderDeviceId: OpaqueDeviceId;
  senderKeyId: SenderKeyId;
  messageType: FamilyEnvelopeMessageType;
  sequenceOrNonce: string;
  issuedAt: Date;
  expiresAt: Date;
  /** Strictly monotonic per sender-key on the receiving device, except for an explicitly signed ROLLBACK message (doc 09 Section 4/doc 05 Section 6). */
  dataVersion: number;
  trustSetEpoch: number;
  keyEpoch: number;
  /** Authenticated-encrypted payload. Opaque to this module -- never parsed, decrypted, or logged here. */
  payload: Buffer;
  /** Signature over the ENTIRE envelope (see canonicalize.ts), not just `payload` -- so metadata cannot be stripped/altered without invalidating the signature. Opaque; verified only via an injected EnvelopeSignatureVerifier, never interpreted here. */
  signature: string;
}
