/** Minimum validity window enforced on any submitted attestation's (issuedAt, expiresAt) pair -- rejects a signed-but-backdated-to-never-expire artifact. */
export const MIN_ATTESTATION_TTL_MS = 1000;

/** Maximum validity window -- bounds WHAT AN ATTESTATION MAY AUTHORIZE: how long a single cached proof can authorize Owner-only commercial mutations before a fresh transfer/re-attestation is required (mission Section 14: a stolen historical proof must not function forever). It does NOT bound who may re-attest: a same-owner renewal is a fresh proof by the still-ACTIVE owner key (PCA-DEC-025 Option A cache semantics). */
export const MAX_ATTESTATION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Maximum tolerated client/server clock skew for signed authority artifacts. */
export const ATTESTATION_CLOCK_SKEW_MS = 5 * 60 * 1000;

/** An artifact issued this far in the past is stale even if its expiry is still future-dated. */
export const MAX_ATTESTATION_AGE_MS = MAX_ATTESTATION_TTL_MS;

export function hasSaneAttestationTemporalPolicy(issuedAt: Date, expiresAt: Date, now: Date): boolean {
  const issuedMs = issuedAt.getTime();
  const expiresMs = expiresAt.getTime();
  const nowMs = now.getTime();
  if (![issuedMs, expiresMs, nowMs].every(Number.isFinite)) return false;
  const ttl = expiresMs - issuedMs;
  return (
    ttl >= MIN_ATTESTATION_TTL_MS &&
    ttl <= MAX_ATTESTATION_TTL_MS &&
    issuedMs <= nowMs + ATTESTATION_CLOCK_SKEW_MS &&
    issuedMs >= nowMs - MAX_ATTESTATION_AGE_MS &&
    expiresMs > nowMs
  );
}
