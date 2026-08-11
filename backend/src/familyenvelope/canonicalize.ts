import type { FamilyEnvelope } from './types.js';

/**
 * Builds the deterministic canonical byte representation of an envelope's
 * signable fields (everything except `signature` itself) -- this is what
 * EnvelopeSignatureVerifier.verify checks the signature against, so that
 * "signature covers all preceding envelope fields, including
 * routing/epoch/expiry/version metadata" (doc 22 Section 3) is actually
 * true: nothing here can be stripped or altered in transit without
 * invalidating the signature.
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
 * `signature` never enters the canonical bytes is the explicit field-by-
 * field whitelist below -- this function must never be rewritten to
 * spread or iterate the input object's own keys, which would silently
 * reintroduce `signature` into what gets signed/verified.
 *
 * `correlationId` (optional) is encoded as an explicit presence flag
 * ("1"/"0") followed by its value (or an empty field when absent) --
 * length-prefixing alone disambiguates field boundaries, but a bare
 * absent-vs-empty-string field would otherwise be indistinguishable.
 * `recipient` (exactly one of DEVICE/GROUP) is encoded as its `kind`
 * discriminant followed by the associated identifier, so the two
 * recipient forms can never canonicalize to overlapping byte sequences.
 */
export function canonicalizeEnvelope(envelope: Omit<FamilyEnvelope, 'signature'>): string {
  const fields = [
    String(envelope.protocolMajor),
    String(envelope.protocolMinor),
    envelope.messageId,
    envelope.familyId,
    envelope.senderDeviceId,
    envelope.recipient.kind,
    envelope.recipient.kind === 'DEVICE' ? envelope.recipient.recipientDeviceId : envelope.recipient.recipientGroup,
    envelope.senderKeyId,
    envelope.messageType,
    envelope.sequenceOrNonce,
    envelope.issuedAt.toISOString(),
    envelope.expiresAt.toISOString(),
    String(envelope.trustSetEpoch),
    String(envelope.keyEpoch),
    envelope.semanticVersion,
    envelope.correlationId !== null ? '1' : '0',
    envelope.correlationId ?? '',
    envelope.payload.toString('base64'),
  ];
  return fields.map((field) => `${Buffer.byteLength(field, 'utf8')}:${field}`).join('');
}
