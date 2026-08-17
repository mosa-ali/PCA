const FALLBACK_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const FALLBACK_CODE_LENGTH = 12;

/**
 * Produces a human-shareable identifier for the one-time invitation reveal.
 * This is deliberately derived from a digest, never contains family data, and
 * is display-only: the backend continues to accept only the full bearer token.
 */
export async function deriveInvitationFallbackCode(rawToken: string): Promise<string> {
  if (!rawToken) throw new Error('raw invitation token is required');
  if (!globalThis.crypto?.subtle) throw new Error('Web Crypto is unavailable');

  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(rawToken));
  let buffer = 0;
  let bitCount = 0;
  let encoded = '';

  for (const byte of new Uint8Array(digest)) {
    buffer = (buffer << 8) | byte;
    bitCount += 8;
    while (bitCount >= 5 && encoded.length < FALLBACK_CODE_LENGTH) {
      bitCount -= 5;
      encoded += FALLBACK_CODE_ALPHABET[(buffer >>> bitCount) & 31];
      buffer &= bitCount === 0 ? 0 : (1 << bitCount) - 1;
    }
    if (encoded.length === FALLBACK_CODE_LENGTH) break;
  }

  if (encoded.length !== FALLBACK_CODE_LENGTH) throw new Error('fallback code derivation failed');
  return `${encoded.slice(0, 4)}-${encoded.slice(4, 8)}-${encoded.slice(8, 12)}`;
}
