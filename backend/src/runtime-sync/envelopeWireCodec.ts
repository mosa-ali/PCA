import { parseFamilyEnvelope, type RawFamilyEnvelope } from '../familyenvelope/parse.js';
import type { FamilyEnvelope } from '../familyenvelope/types.js';

/**
 * Runtime adapter around the existing, accepted FamilyEnvelope wire shape
 * (familyenvelope/types.ts + parse.ts) and the existing, accepted opaque
 * Relay transport (relay/types.ts's `RelayEnvelopeRecord.ciphertext:
 * Buffer`). Neither module owns a function that turns a typed
 * `FamilyEnvelope` back into the bytes that travel through Relay --
 * `parseFamilyEnvelope` only goes the other direction. This module supplies
 * exactly that missing inverse, and nothing else: it never inspects or
 * transforms `payload`, which stays opaque ciphertext bytes at every step.
 *
 * "Relay ciphertext" here is the JSON-serialized RawFamilyEnvelope wire
 * form (Dates as ISO-8601 strings, `payload` as base64) -- the same shape
 * `parseFamilyEnvelope` already accepts. This module does not invent a new
 * wire format; it is the mechanical round-trip of the one that already
 * exists.
 */

function serializeRecipient(envelope: FamilyEnvelope): Pick<RawFamilyEnvelope, 'recipientDeviceId' | 'recipientGroup'> {
  if (envelope.recipient.kind === 'DEVICE') {
    return { recipientDeviceId: envelope.recipient.recipientDeviceId };
  }
  return { recipientGroup: envelope.recipient.recipientGroup };
}

export function envelopeToRelayCiphertext(envelope: FamilyEnvelope): Buffer {
  const raw: RawFamilyEnvelope = {
    protocolMajor: envelope.protocolMajor,
    protocolMinor: envelope.protocolMinor,
    messageId: envelope.messageId,
    familyId: envelope.familyId,
    senderDeviceId: envelope.senderDeviceId,
    ...serializeRecipient(envelope),
    senderKeyId: envelope.senderKeyId,
    messageType: envelope.messageType,
    trustSetEpoch: envelope.trustSetEpoch,
    keyEpoch: envelope.keyEpoch,
    sequenceOrNonce: envelope.sequenceOrNonce,
    issuedAt: envelope.issuedAt.toISOString(),
    expiresAt: envelope.expiresAt.toISOString(),
    semanticVersion: envelope.semanticVersion,
    correlationId: envelope.correlationId,
    payload: envelope.payload.toString('base64'),
    signature: envelope.signature,
  };
  return Buffer.from(JSON.stringify(raw), 'utf8');
}

/** Returns null for anything structurally malformed -- same "no granular error" posture as parseFamilyEnvelope itself. */
export function envelopeFromRelayCiphertext(ciphertext: Buffer): FamilyEnvelope | null {
  let raw: unknown;
  try {
    raw = JSON.parse(ciphertext.toString('utf8'));
  } catch {
    return null;
  }
  return parseFamilyEnvelope(raw);
}
