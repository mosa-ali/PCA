import type { FamilyEnvelope } from './types.js';

/**
 * Builds the deterministic canonical byte representation of an envelope's
 * signable fields (everything except `signature` itself) -- this is what
 * EnvelopeSignatureVerifier.verify checks the signature against, so that
 * "the sender's signature over the ENTIRE envelope" (doc 09 Section 4) is
 * actually true: version, expiry, sequence, epochs, etc. cannot be
 * stripped or altered in transit without invalidating the signature.
 *
 * Fields are netstring-style length-prefixed (`${byteLength}:${value}`,
 * concatenated in a fixed order) rather than joined with a plain
 * delimiter like "\n" or JSON.stringify'd -- length-prefixing means no
 * field value (however it's encoded, whatever bytes it contains) can ever
 * be crafted to make two different logical envelopes canonicalize to the
 * same byte string. JSON key ordering is not a portable guarantee across
 * implementations either, which this format sidesteps entirely.
 *
 * The `Omit<FamilyEnvelope, 'signature'>` parameter type is a readability
 * aid, NOT an enforcement mechanism -- TypeScript's excess-property check
 * only applies to object literals, so a full FamilyEnvelope (signature
 * included) passed as a variable, exactly as FamilyEnvelopeVerifier does,
 * satisfies this type with no compiler error. The actual guarantee that
 * `signature` never enters the canonical bytes is the explicit 12-field
 * whitelist below -- this function must never be rewritten to spread or
 * iterate the input object's own keys, which would silently reintroduce
 * `signature` into what gets signed/verified.
 */
export function canonicalizeEnvelope(envelope: Omit<FamilyEnvelope, 'signature'>): string {
  const fields = [
    String(envelope.protocolVersion),
    envelope.familyId,
    envelope.senderDeviceId,
    envelope.senderKeyId,
    envelope.messageType,
    envelope.sequenceOrNonce,
    envelope.issuedAt.toISOString(),
    envelope.expiresAt.toISOString(),
    String(envelope.dataVersion),
    String(envelope.trustSetEpoch),
    String(envelope.keyEpoch),
    envelope.payload.toString('base64'),
  ];
  return fields.map((field) => `${Buffer.byteLength(field, 'utf8')}:${field}`).join('');
}
