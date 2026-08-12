import { createHash } from 'node:crypto';

// bootstrapAttemptId: client-generated, high-entropy, NOT secret. It only
// correlates retries of one logical enrollment attempt -- it must never by
// itself be treated as authority to redeem an invitation or read state (see
// EnrollmentCoordinator.recoverAttempt). Shape mirrors the invitation
// token's own base64url grammar without pinning to one canonical length --
// the client is free to choose its own entropy source/length within these
// bounds (unlike the invitation token, which this server itself generates).
const ATTEMPT_ID_MIN_LENGTH = 16;
const ATTEMPT_ID_MAX_LENGTH = 64;

// attemptRecoveryToken: a SECOND client-generated high-entropy secret,
// distinct from the invitation token, generated once per attempt and
// persisted durably by the client BEFORE the original request is sent (so
// it survives a lost response / process death). The server never returns
// it -- the client already has it -- and stores only its SHA-256 hash,
// exactly mirroring how enrollment_invitations.token_hash never retains the
// raw invitation token. Possessing this secret is the ONLY thing that
// authorizes reading a completed attempt's result via the recovery
// endpoint; bootstrapAttemptId alone is not sufficient (it is not secret).
const RECOVERY_TOKEN_MIN_LENGTH = 32;
const RECOVERY_TOKEN_MAX_LENGTH = 88;

const BASE64URL_SHAPE = /^[A-Za-z0-9_-]+$/;

export function isPlausibleAttemptId(candidate: unknown): candidate is string {
  return (
    typeof candidate === 'string' &&
    candidate.length >= ATTEMPT_ID_MIN_LENGTH &&
    candidate.length <= ATTEMPT_ID_MAX_LENGTH &&
    BASE64URL_SHAPE.test(candidate)
  );
}

export function isPlausibleAttemptRecoveryToken(candidate: unknown): candidate is string {
  return (
    typeof candidate === 'string' &&
    candidate.length >= RECOVERY_TOKEN_MIN_LENGTH &&
    candidate.length <= RECOVERY_TOKEN_MAX_LENGTH &&
    BASE64URL_SHAPE.test(candidate)
  );
}

/** One-way reference for persistence/lookup -- the raw secret is never stored. */
export function hashAttemptRecoveryToken(rawToken: string): string {
  return createHash('sha256').update(rawToken, 'utf8').digest('hex');
}
