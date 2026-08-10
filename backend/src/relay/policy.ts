/**
 * Server-side bounds for the opaque relay. These exist so a caller cannot
 * force unbounded resource consumption or turn relay storage into permanent
 * family-data retention -- relay TTL is operational delivery availability,
 * never family activity retention (see architecture doc 09/11).
 */
export const DEFAULT_RELAY_TTL_MS = 24 * 60 * 60 * 1000; // 1 day
export const MAX_RELAY_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days, per architecture ceiling

export const MAX_CIPHERTEXT_BYTES = 64 * 1024; // 64 KiB -- control/policy envelopes, not bulk media
export const MIN_CIPHERTEXT_BYTES = 1;

export const MAX_OPAQUE_ID_LENGTH = 128;

export function resolveRelayTtlMs(requestedTtlMs: number | undefined): number {
  if (requestedTtlMs === undefined) return DEFAULT_RELAY_TTL_MS;
  if (!Number.isFinite(requestedTtlMs) || requestedTtlMs <= 0) {
    throw new RangeError('ttlMs must be a positive finite duration in milliseconds.');
  }
  if (requestedTtlMs > MAX_RELAY_TTL_MS) {
    throw new RangeError('ttlMs exceeds the maximum permitted relay queueing duration.');
  }
  return requestedTtlMs;
}

export function computeExpiryInstant(createdAt: Date, ttlMs: number): Date {
  const expiresAtMs = createdAt.getTime() + ttlMs;
  if (!Number.isSafeInteger(expiresAtMs)) {
    throw new RangeError('Computed relay expiry is out of range.');
  }
  return new Date(expiresAtMs);
}

export function isPlausibleOpaqueId(candidate: unknown): candidate is string {
  return typeof candidate === 'string' && candidate.length > 0 && candidate.length <= MAX_OPAQUE_ID_LENGTH;
}

export function isPlausibleCiphertext(candidate: unknown): candidate is Buffer {
  return (
    Buffer.isBuffer(candidate) &&
    candidate.length >= MIN_CIPHERTEXT_BYTES &&
    candidate.length <= MAX_CIPHERTEXT_BYTES
  );
}
