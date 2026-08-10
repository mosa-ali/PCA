/**
 * Structural bounds for the envelope wrapper fields, independent of
 * whatever the encrypted payload contains. These exist so a malformed or
 * abusive envelope is rejected cheaply, before any signature verification
 * (the expensive check) is attempted.
 */
export const MAX_OPAQUE_ID_LENGTH = 128;
export const MAX_SEQUENCE_OR_NONCE_LENGTH = 128;
export const MAX_SIGNATURE_LENGTH = 512;
export const MAX_PAYLOAD_BYTES = 64 * 1024; // matches src/relay/policy.ts's control/policy-envelope ceiling
export const MIN_PROTOCOL_VERSION = 1;

/** Per doc 09 Section 4: "receivers maintain a BOUNDED per-sender replay ledger." */
export const REPLAY_LEDGER_CAPACITY_PER_SENDER = 4096;

const MESSAGE_TYPES = new Set([
  'POLICY_PUSH',
  'ACTIVITY_SUMMARY',
  'REVOCATION_COMMAND',
  'STATUS_RECEIPT',
  'TAMPER_EVENT',
  'ROLLBACK',
]);

export function isPlausibleOpaqueId(candidate: unknown): candidate is string {
  return typeof candidate === 'string' && candidate.length > 0 && candidate.length <= MAX_OPAQUE_ID_LENGTH;
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

export function isPlausibleMessageType(candidate: unknown): candidate is string {
  return typeof candidate === 'string' && MESSAGE_TYPES.has(candidate);
}

export function isPlausibleProtocolVersion(candidate: unknown): candidate is number {
  return typeof candidate === 'number' && Number.isInteger(candidate) && candidate >= MIN_PROTOCOL_VERSION;
}

export function isPlausibleEpoch(candidate: unknown): candidate is number {
  return typeof candidate === 'number' && Number.isInteger(candidate) && candidate >= 0;
}

export function isPlausibleDataVersion(candidate: unknown): candidate is number {
  return typeof candidate === 'number' && Number.isInteger(candidate) && candidate >= 0;
}
