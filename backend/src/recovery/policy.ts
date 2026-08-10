/**
 * Server-side bounds for the opaque recovery envelope. A recovery envelope
 * is a wrapped key/secret bundle, not bulk data -- bounded well below the
 * relay's operational-message ceiling.
 */
export const MAX_ENVELOPE_BYTES = 16 * 1024; // 16 KiB
export const MIN_ENVELOPE_BYTES = 1;
export const MAX_OPAQUE_ID_LENGTH = 128;

export function isPlausibleOpaqueId(candidate: unknown): candidate is string {
  return typeof candidate === 'string' && candidate.length > 0 && candidate.length <= MAX_OPAQUE_ID_LENGTH;
}

export function isPlausibleEnvelopeCiphertext(candidate: unknown): candidate is Buffer {
  return (
    Buffer.isBuffer(candidate) &&
    candidate.length >= MIN_ENVELOPE_BYTES &&
    candidate.length <= MAX_ENVELOPE_BYTES
  );
}
