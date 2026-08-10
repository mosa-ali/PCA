/** Server-side session lifetime policy -- bounded, not caller-controlled. */
export const DEFAULT_SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
export const MAX_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export function resolveSessionTtlMs(requestedTtlMs: number | undefined): number {
  if (requestedTtlMs === undefined) return DEFAULT_SESSION_TTL_MS;
  if (!Number.isFinite(requestedTtlMs) || requestedTtlMs <= 0) {
    throw new RangeError('ttlMs must be a positive finite duration in milliseconds.');
  }
  if (requestedTtlMs > MAX_SESSION_TTL_MS) {
    throw new RangeError('ttlMs exceeds the maximum permitted session lifetime.');
  }
  return requestedTtlMs;
}

export function computeExpiryInstant(issuedAt: Date, ttlMs: number): Date {
  const expiresAtMs = issuedAt.getTime() + ttlMs;
  if (!Number.isSafeInteger(expiresAtMs)) {
    throw new RangeError('Computed session expiry is out of range.');
  }
  return new Date(expiresAtMs);
}
