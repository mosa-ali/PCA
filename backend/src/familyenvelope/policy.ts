import type { FamilyEnvelopeMessageType } from './types.js';

/**
 * Structural bounds for the envelope wrapper fields, independent of
 * whatever the encrypted payload contains. These exist so a malformed or
 * abusive envelope is rejected cheaply, before any signature verification
 * (the expensive check) is attempted.
 */
export const MAX_OPAQUE_ID_LENGTH = 128;
export const MAX_MESSAGE_ID_LENGTH = 128;
export const MAX_CORRELATION_ID_LENGTH = 128;
export const MAX_SEQUENCE_OR_NONCE_LENGTH = 128;
export const MAX_SIGNATURE_LENGTH = 512;
export const MAX_SEMANTIC_VERSION_LENGTH = 32;
export const MAX_PAYLOAD_BYTES = 64 * 1024; // matches src/relay/policy.ts's control/policy-envelope ceiling
export const MIN_PROTOCOL_MAJOR = 1;
export const MIN_PROTOCOL_MINOR = 0;

/**
 * doc 22 Section 6: "protocolMajor incompatibility: reject without
 * decrypting/applying." This module (a device-side receiver) currently
 * understands exactly one major version. A future minor-version bump adds
 * fields/semantics this receiver already knows how to ignore safely; a
 * major-version bump means the WIRE SHAPE itself may have changed in a
 * way this parser cannot safely assume compatibility with, so it is
 * rejected outright rather than guessed at.
 */
export const SUPPORTED_PROTOCOL_MAJOR = 1;

/** Per doc 09 Section 4: "receivers maintain a BOUNDED per-sender replay ledger." */
export const REPLAY_LEDGER_CAPACITY_PER_SENDER = 4096;

/** Bounds how many distinct messageId idempotency records this receiver retains -- same rationale as the replay ledger: a resource-abuse ceiling, not a security control on its own. */
export const MESSAGE_IDEMPOTENCY_LEDGER_CAPACITY = 4096;

const MESSAGE_TYPES = new Set<FamilyEnvelopeMessageType>([
  'POLICY_UPDATE',
  'POLICY_RECEIPT',
  'STATUS_SNAPSHOT',
  'ACTIVITY_SUMMARY',
  'LOCATION_RESPONSE',
  'CHILD_REQUEST',
  'PARENT_DECISION',
  'TAMPER_ALERT',
  'RETENTION_DELETION_INSTRUCTION',
  'RETENTION_RECEIPT',
  'FTS_UPDATE',
  'KEY_ROTATION',
  'DEVICE_REVOKE',
  'RECOVERY_TRANSACTION',
  'SIGNED_ROLLBACK',
]);

/**
 * doc 22 Section 4's per-type "semantic version / idempotent effect"
 * column: ONLY POLICY_UPDATE is described as "strictly increasing...
 * child applies once." Every other type's exactly-once/ordering
 * guarantee is provided by messageId idempotency (see
 * MessageIdempotencyLedger) or epoch advancement (FTS_UPDATE/
 * KEY_ROTATION/DEVICE_REVOKE), not by semanticVersion monotonicity.
 * SIGNED_ROLLBACK is deliberately excluded here too -- per doc 22
 * Section 6, "a rollback is a message type, not a relaxed monotonicity
 * check," so it is never subject to (or exempted from) this check; it is
 * its own acceptance path (see FamilyEnvelopeVerifier).
 */
export function requiresStrictVersionIncrease(messageType: FamilyEnvelopeMessageType): boolean {
  return messageType === 'POLICY_UPDATE';
}

export function isPlausibleOpaqueId(candidate: unknown): candidate is string {
  return typeof candidate === 'string' && candidate.length > 0 && candidate.length <= MAX_OPAQUE_ID_LENGTH;
}

export function isPlausibleMessageId(candidate: unknown): candidate is string {
  return typeof candidate === 'string' && candidate.length > 0 && candidate.length <= MAX_MESSAGE_ID_LENGTH;
}

export function isPlausibleCorrelationId(candidate: unknown): candidate is string {
  return typeof candidate === 'string' && candidate.length > 0 && candidate.length <= MAX_CORRELATION_ID_LENGTH;
}

export function isPlausibleSequenceOrNonce(candidate: unknown): candidate is string {
  return typeof candidate === 'string' && candidate.length > 0 && candidate.length <= MAX_SEQUENCE_OR_NONCE_LENGTH;
}

export function isPlausibleSignature(candidate: unknown): candidate is string {
  return typeof candidate === 'string' && candidate.length > 0 && candidate.length <= MAX_SIGNATURE_LENGTH;
}

export function isPlausiblePayload(candidate: unknown): candidate is Buffer {
  return Buffer.isBuffer(candidate) && candidate.length >= 1 && candidate.length <= MAX_PAYLOAD_BYTES;
}

export function isPlausibleMessageType(candidate: unknown): candidate is FamilyEnvelopeMessageType {
  return typeof candidate === 'string' && MESSAGE_TYPES.has(candidate as FamilyEnvelopeMessageType);
}

export function isPlausibleProtocolMajor(candidate: unknown): candidate is number {
  return typeof candidate === 'number' && Number.isInteger(candidate) && candidate >= MIN_PROTOCOL_MAJOR;
}

export function isPlausibleProtocolMinor(candidate: unknown): candidate is number {
  return typeof candidate === 'number' && Number.isInteger(candidate) && candidate >= MIN_PROTOCOL_MINOR;
}

export function isPlausibleEpoch(candidate: unknown): candidate is number {
  return typeof candidate === 'number' && Number.isInteger(candidate) && candidate >= 0;
}

const SEMANTIC_VERSION_SHAPE = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;

export function isPlausibleSemanticVersion(candidate: unknown): candidate is string {
  return (
    typeof candidate === 'string' &&
    candidate.length <= MAX_SEMANTIC_VERSION_LENGTH &&
    SEMANTIC_VERSION_SHAPE.test(candidate)
  );
}

/** Numeric (never lexicographic) dotted-triple comparison, mirroring src/release/version.ts's established convention for this codebase. */
export function compareSemanticVersions(a: string, b: string): number {
  const [aMajor, aMinor, aPatch] = a.split('.').map(Number);
  const [bMajor, bMinor, bPatch] = b.split('.').map(Number);
  if (aMajor !== bMajor) return aMajor - bMajor;
  if (aMinor !== bMinor) return aMinor - bMinor;
  return aPatch - bPatch;
}

export function isPlausibleRecipientGroup(candidate: unknown): candidate is string {
  return typeof candidate === 'string' && candidate.length > 0 && candidate.length <= MAX_OPAQUE_ID_LENGTH;
}
