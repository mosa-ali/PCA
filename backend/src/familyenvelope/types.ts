export type ProtocolMajor = number;
export type ProtocolMinor = number;
export type MessageId = string;
export type OpaqueFamilyId = string;
export type OpaqueDeviceId = string;
export type SenderKeyId = string;
export type CorrelationId = string;

/**
 * The canonical family-control message vocabulary per doc 22 Section 4
 * (which reconciles/supersedes doc 05 Section 6's earlier informal list).
 * This is the ONE production vocabulary -- no competing synonymous set
 * (e.g. a prior, now-removed POLICY_PUSH/REVOCATION_COMMAND/STATUS_RECEIPT/
 * TAMPER_EVENT/ROLLBACK naming) may coexist with this one.
 */
export type FamilyEnvelopeMessageType =
  | 'POLICY_UPDATE'
  | 'POLICY_RECEIPT'
  | 'STATUS_SNAPSHOT'
  | 'ACTIVITY_SUMMARY'
  | 'LOCATION_RESPONSE'
  | 'CHILD_REQUEST'
  | 'PARENT_DECISION'
  | 'TAMPER_ALERT'
  | 'RETENTION_DELETION_INSTRUCTION'
  | 'RETENTION_RECEIPT'
  | 'FTS_UPDATE'
  | 'KEY_ROTATION'
  | 'DEVICE_REVOKE'
  | 'RECOVERY_TRANSACTION'
  | 'SIGNED_ROLLBACK';

/**
 * doc 22 Section 3: the envelope binds EXACTLY ONE recipient form, never
 * both, never neither. Modeled as a discriminated union (not two optional
 * fields) so "both supplied" and "neither supplied" are structurally
 * impossible for any caller constructing a FamilyEnvelope in-process --
 * parse.ts separately enforces the same exclusivity when reconstructing
 * one from untrusted wire input, where the type system can't help.
 */
export type RecipientBinding =
  | { kind: 'DEVICE'; recipientDeviceId: OpaqueDeviceId }
  | { kind: 'GROUP'; recipientGroup: string };

/**
 * Protocol-neutral structure for "every family-control message" per doc 09
 * Section 4 and the full accepted wire shape in doc 22 Section 3. This
 * module NEVER decrypts, generates, or inspects `payload` beyond treating
 * it as opaque bytes -- exactly the same ciphertext-blind posture as the
 * existing Relay domain (src/relay). It also performs no signature MATH
 * (see EnvelopeSignatureVerifier) and no Family Trust Set lookups (a
 * separate workstream, src/familytrustset) -- this module implements the
 * envelope's STRUCTURE and the receiver-side acceptance checks doc 22
 * PCA-API-002 lists as this layer's responsibility (protocol
 * compatibility, message-id idempotency, anti-replay, expiry, trust/key
 * epoch, semantic ordering, signature verification against a
 * caller-supplied key) -- never sender-role authorization or payload
 * decrypt/authorization, which doc 22 also lists but which require FTS
 * role data and payload crypto this module deliberately does not own
 * (see ReceiverPipeline.ts for the full pipeline's shape, including the
 * stages this module does not implement).
 *
 * `sequenceOrNonce`: doc 22 Section 3 names this `senderSequence |
 * replayNonce` -- "a monotonic sequence number OR a replay-resistant
 * nonce" per sender-key. Both are modeled as one opaque string field here
 * so the replay ledger (below) works identically regardless of which a
 * given sender implementation chooses.
 *
 * `messageId`: doc 22 Section 3 -- "globally unique for idempotency,"
 * "stable across relay retransmission." Distinct from `sequenceOrNonce`:
 * the sequence/nonce is a SECURITY anti-replay control (a captured old
 * envelope must never be re-applied); `messageId` is an APPLICATION-level
 * exactly-once-effect key so a legitimate at-least-once redelivery of the
 * SAME already-accepted envelope produces the SAME stable outcome (doc 22
 * Section 7's "valid signed policy delivered twice -> exactly one
 * application and stable receipt") rather than an error.
 *
 * `semanticVersion`: doc 22 Section 4's per-type "semantic version /
 * idempotent effect" column -- ordering/idempotency semantics DIFFER by
 * messageType (see policy.ts's requiresStrictVersionIncrease). This is
 * NOT a single global monotonic counter for every message type; only
 * POLICY_UPDATE is strictly-increasing-version-checked by this module.
 * SIGNED_ROLLBACK is its own distinct message type (doc 22 Section 6:
 * "a rollback is a message type, not a relaxed monotonicity check"),
 * never inferred from an ordinary lower-version POLICY_UPDATE.
 */
export interface FamilyEnvelope {
  protocolMajor: ProtocolMajor;
  protocolMinor: ProtocolMinor;
  messageId: MessageId;
  familyId: OpaqueFamilyId;
  senderDeviceId: OpaqueDeviceId;
  recipient: RecipientBinding;
  senderKeyId: SenderKeyId;
  messageType: FamilyEnvelopeMessageType;
  trustSetEpoch: number;
  keyEpoch: number;
  sequenceOrNonce: string;
  issuedAt: Date;
  expiresAt: Date;
  /** Format left to policy.ts's isPlausibleSemanticVersion -- doc 22 does not pin a specific scheme (e.g. dotted-integer vs. opaque monotonic token) beyond "semantic version." */
  semanticVersion: string;
  /**
   * Optional opaque workflow correlation value (doc 22 Section 3), e.g.
   * tying a CHILD_REQUEST to its PARENT_DECISION. Never readable family
   * content -- an opaque bounded identifier only, same posture as every
   * other opaque id in this module.
   */
  correlationId: CorrelationId | null;
  /** Authenticated-encrypted payload. Opaque to this module -- never parsed, decrypted, or logged here. */
  payload: Buffer;
  /** Signature over the ENTIRE envelope (see canonicalize.ts), not just `payload` -- so metadata cannot be stripped/altered without invalidating the signature. Opaque; verified only via an injected EnvelopeSignatureVerifier, never interpreted here. */
  signature: string;
}
