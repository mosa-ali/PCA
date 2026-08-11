import type { FamilyEnvelope, RecipientBinding } from './types.js';
import {
  isPlausibleCorrelationId,
  isPlausibleEpoch,
  isPlausibleMessageId,
  isPlausibleMessageType,
  isPlausibleOpaqueId,
  isPlausiblePayload,
  isPlausibleProtocolMajor,
  isPlausibleProtocolMinor,
  isPlausibleRecipientGroup,
  isPlausibleSemanticVersion,
  isPlausibleSequenceOrNonce,
  isPlausibleSignature,
} from './policy.js';

/**
 * Wire representation of a FamilyEnvelope: Date fields as ISO-8601
 * strings, `payload` as base64, matching how an envelope actually arrives
 * over the network (e.g. as JSON riding alongside the Relay's opaque
 * ciphertext transport -- see src/relay). This module never assumes the
 * caller already has typed Date/Buffer/RecipientBinding instances.
 *
 * doc 22 Section 3's shape notation `recipientDeviceOpaqueId |
 * recipientGroup` is modeled on the wire as two separate, both-optional
 * fields -- parseFamilyEnvelope enforces that EXACTLY ONE is present.
 */
export interface RawFamilyEnvelope {
  protocolMajor: unknown;
  protocolMinor: unknown;
  messageId: unknown;
  familyId: unknown;
  senderDeviceId: unknown;
  recipientDeviceId?: unknown;
  recipientGroup?: unknown;
  senderKeyId: unknown;
  messageType: unknown;
  trustSetEpoch: unknown;
  keyEpoch: unknown;
  sequenceOrNonce: unknown;
  issuedAt: unknown;
  expiresAt: unknown;
  semanticVersion: unknown;
  correlationId?: unknown;
  payload: unknown;
  signature: unknown;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseIsoDate(candidate: unknown): Date | null {
  if (typeof candidate !== 'string') return null;
  const parsed = new Date(candidate);
  if (Number.isNaN(parsed.getTime())) return null;
  // Round-trip check: reject any input that isn't itself a canonical ISO
  // string (e.g. a bare date, a non-UTC offset) rather than silently
  // normalizing it -- a receiver must not guess at an ambiguous timestamp.
  return parsed.toISOString() === candidate ? parsed : null;
}

function parseBase64Payload(candidate: unknown): Buffer | null {
  if (typeof candidate !== 'string' || candidate.length === 0) return null;
  let decoded: Buffer;
  try {
    decoded = Buffer.from(candidate, 'base64');
  } catch {
    return null;
  }
  if (decoded.toString('base64') !== candidate) return null;
  return isPlausiblePayload(decoded) ? decoded : null;
}

function parseRecipient(candidate: RawFamilyEnvelope): RecipientBinding | null {
  const hasDevice = candidate.recipientDeviceId !== undefined && candidate.recipientDeviceId !== null;
  const hasGroup = candidate.recipientGroup !== undefined && candidate.recipientGroup !== null;
  if (hasDevice === hasGroup) return null; // both present, or neither -- both are structural violations
  if (hasDevice) {
    return isPlausibleOpaqueId(candidate.recipientDeviceId)
      ? { kind: 'DEVICE', recipientDeviceId: candidate.recipientDeviceId }
      : null;
  }
  return isPlausibleRecipientGroup(candidate.recipientGroup) ? { kind: 'GROUP', recipientGroup: candidate.recipientGroup } : null;
}

function parseCorrelationId(candidate: unknown): { ok: true; value: string | null } | { ok: false } {
  if (candidate === undefined || candidate === null) return { ok: true, value: null };
  return isPlausibleCorrelationId(candidate) ? { ok: true, value: candidate } : { ok: false };
}

/**
 * Structurally validates and converts untrusted wire input into a typed
 * FamilyEnvelope. Returns null for ANY structural defect -- this function
 * makes no attempt to distinguish which field was wrong, since a receiver
 * gains nothing from that detail (the envelope is simply not going to be
 * evaluated further either way) and a more granular error could become a
 * probing oracle for a malformed-envelope sender.
 *
 * This function performs NO semantic acceptance checks (protocol
 * compatibility, signature, replay, expiry, epoch, version, message-id
 * idempotency) -- see FamilyEnvelopeVerifier.evaluateEnvelope for those,
 * which assumes its input already passed through here. This is doc 22
 * PCA-API-002's "parse/schema bounds" check, kept deliberately separate
 * from "protocol compatibility" (also PCA-API-002, but implemented in
 * protocolCompatibility.ts/evaluateEnvelope) -- a structurally malformed
 * envelope and a well-formed-but-unsupported-major-version envelope are
 * different failure classes.
 */
export function parseFamilyEnvelope(raw: unknown): FamilyEnvelope | null {
  if (!isPlainObject(raw)) return null;
  const candidate = raw as unknown as RawFamilyEnvelope;

  if (!isPlausibleProtocolMajor(candidate.protocolMajor)) return null;
  if (!isPlausibleProtocolMinor(candidate.protocolMinor)) return null;
  if (!isPlausibleMessageId(candidate.messageId)) return null;
  if (!isPlausibleOpaqueId(candidate.familyId)) return null;
  if (!isPlausibleOpaqueId(candidate.senderDeviceId)) return null;
  if (!isPlausibleOpaqueId(candidate.senderKeyId)) return null;
  if (!isPlausibleMessageType(candidate.messageType)) return null;
  if (!isPlausibleSequenceOrNonce(candidate.sequenceOrNonce)) return null;
  if (!isPlausibleSemanticVersion(candidate.semanticVersion)) return null;
  if (!isPlausibleEpoch(candidate.trustSetEpoch)) return null;
  if (!isPlausibleEpoch(candidate.keyEpoch)) return null;
  if (!isPlausibleSignature(candidate.signature)) return null;

  const recipient = parseRecipient(candidate);
  if (!recipient) return null;

  const correlation = parseCorrelationId(candidate.correlationId);
  if (!correlation.ok) return null;

  const issuedAt = parseIsoDate(candidate.issuedAt);
  if (!issuedAt) return null;
  const expiresAt = parseIsoDate(candidate.expiresAt);
  if (!expiresAt) return null;
  if (expiresAt.getTime() <= issuedAt.getTime()) return null;

  const payload = parseBase64Payload(candidate.payload);
  if (!payload) return null;

  return {
    protocolMajor: candidate.protocolMajor as number,
    protocolMinor: candidate.protocolMinor as number,
    messageId: candidate.messageId as string,
    familyId: candidate.familyId as string,
    senderDeviceId: candidate.senderDeviceId as string,
    recipient,
    senderKeyId: candidate.senderKeyId as string,
    messageType: candidate.messageType as FamilyEnvelope['messageType'],
    trustSetEpoch: candidate.trustSetEpoch as number,
    keyEpoch: candidate.keyEpoch as number,
    sequenceOrNonce: candidate.sequenceOrNonce as string,
    issuedAt,
    expiresAt,
    semanticVersion: candidate.semanticVersion as string,
    correlationId: correlation.value,
    payload,
    signature: candidate.signature as string,
  };
}
