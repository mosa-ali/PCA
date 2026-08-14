/** Minimum validity window enforced on any submitted attestation's (issuedAt, expiresAt) pair -- rejects a signed-but-backdated-to-never-expire artifact. */
export const MIN_ATTESTATION_TTL_MS = 1000;

/** Maximum validity window -- bounds how long a single attestation can authorize Owner-only commercial mutations before a fresh transfer/re-attestation is required (mission Section 14: a stolen historical proof must not function forever). */
export const MAX_ATTESTATION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
