import type { FamilyEnvelope } from './types.js';
import {
  isPlausibleDataVersion,
  isPlausibleEpoch,
  isPlausibleMessageType,
  isPlausibleOpaqueId,
  isPlausiblePayload,
  isPlausibleProtocolVersion,
  isPlausibleSequenceOrNonce,
  isPlausibleSignature,
} from './policy.js';

/**
 * Wire representation of a FamilyEnvelope: Date fields as ISO-8601
 * strings, `payload` as base64, matching how an envelope actually arrives
 * over the network (e.g. as JSON riding alongside the Relay's opaque
 * ciphertext transport -- see src/relay). This module never assumes the
 * caller already has typed Date/Buffer instances.
 */
export interface RawFamilyEnvelope {
  protocolVersion: unknown;
  familyId: unknown;
  senderDeviceId: unknown;
  senderKeyId: unknown;
  messageType: unknown;
  sequenceOrNonce: unknown;
  issuedAt: unknown;
  expiresAt: unknown;
  dataVersion: unknown;
  trustSetEpoch: unknown;
  keyEpoch: unknown;
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

/**
 * Structurally validates and converts untrusted wire input into a typed
 * FamilyEnvelope. Returns null for ANY structural defect -- this function
 * makes no attempt to distinguish which field was wrong, since a receiver
 * gains nothing from that detail (the envelope is simply not going to be
 * evaluated further either way) and a more granular error could become a
 * probing oracle for a malformed-envelope sender.
 *
 * This function performs NO semantic acceptance checks (signature, replay,
 * expiry, version-monotonicity, epoch staleness) -- see
 * FamilyEnvelopeVerifier.evaluateEnvelope for those, which assumes its
 * input already passed through here.
 */
export function parseFamilyEnvelope(raw: unknown): FamilyEnvelope | null {
  if (!isPlainObject(raw)) return null;
  const candidate = raw as unknown as RawFamilyEnvelope;

  if (!isPlausibleProtocolVersion(candidate.protocolVersion)) return null;
  if (!isPlausibleOpaqueId(candidate.familyId)) return null;
  if (!isPlausibleOpaqueId(candidate.senderDeviceId)) return null;
  if (!isPlausibleOpaqueId(candidate.senderKeyId)) return null;
  if (!isPlausibleMessageType(candidate.messageType)) return null;
  if (!isPlausibleSequenceOrNonce(candidate.sequenceOrNonce)) return null;
  if (!isPlausibleDataVersion(candidate.dataVersion)) return null;
  if (!isPlausibleEpoch(candidate.trustSetEpoch)) return null;
  if (!isPlausibleEpoch(candidate.keyEpoch)) return null;
  if (!isPlausibleSignature(candidate.signature)) return null;

  const issuedAt = parseIsoDate(candidate.issuedAt);
  if (!issuedAt) return null;
  const expiresAt = parseIsoDate(candidate.expiresAt);
  if (!expiresAt) return null;
  if (expiresAt.getTime() <= issuedAt.getTime()) return null;

  const payload = parseBase64Payload(candidate.payload);
  if (!payload) return null;

  return {
    protocolVersion: candidate.protocolVersion as number,
    familyId: candidate.familyId as string,
    senderDeviceId: candidate.senderDeviceId as string,
    senderKeyId: candidate.senderKeyId as string,
    messageType: candidate.messageType as FamilyEnvelope['messageType'],
    sequenceOrNonce: candidate.sequenceOrNonce as string,
    issuedAt,
    expiresAt,
    dataVersion: candidate.dataVersion as number,
    trustSetEpoch: candidate.trustSetEpoch as number,
    keyEpoch: candidate.keyEpoch as number,
    payload,
    signature: candidate.signature as string,
  };
}
