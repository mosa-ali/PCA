import { randomUUID } from 'node:crypto';
import { generateSessionToken, hashSessionToken, isPlausibleSessionToken } from './token.js';
import { computeExpiryInstant, resolveSessionTtlMs } from './policy.js';
import type { AuthRepository } from './AuthRepository.js';
import type { ServiceAccountId, ServiceSessionRecord, VerifiedIdentity } from './types.js';

export type AuthErrorCode = 'INVALID_INPUT' | 'UNAUTHORIZED';

/**
 * Deliberately ONE generic code/message for every authentication failure
 * mode (missing/malformed/unknown/expired/revoked token, disabled
 * account). The caller must never be able to distinguish "wrong token
 * format" from "token expired 3 seconds ago" from "this account is
 * disabled" -- any distinction is an oracle an attacker can use to
 * enumerate accounts/sessions/tokens.
 */
export class AuthError extends Error {
  readonly code: AuthErrorCode;
  constructor(code: AuthErrorCode) {
    super(AUTH_ERROR_MESSAGES[code]);
    this.name = 'AuthError';
    this.code = code;
  }
}

const AUTH_ERROR_MESSAGES: Record<AuthErrorCode, string> = {
  INVALID_INPUT: 'Request input is malformed.',
  UNAUTHORIZED: 'Authentication failed.',
};

export interface IssuedSession {
  rawToken: string;
  session: ServiceSessionRecord;
}

export class AuthService {
  private readonly repository: AuthRepository;
  private readonly now: () => Date;

  constructor(repository: AuthRepository, now: () => Date = () => new Date()) {
    this.repository = repository;
    this.now = now;
  }

  /**
   * `identity` must already be the output of a real upstream verification
   * step -- this method performs no credential checking itself. Session
   * issuance is refused generically (UNAUTHORIZED, same as every other
   * auth failure) for a disabled account, so a caller cannot distinguish
   * "wrong identity" from "your account is disabled."
   */
  async issueSession(identity: VerifiedIdentity, ttlMs?: number): Promise<IssuedSession> {
    const resolvedTtlMs = resolveSessionTtlMs(ttlMs);
    const account = await this.repository.findOrCreateAccount(identity.accountReferenceHash, this.now());
    if (account.disabledAt) throw new AuthError('UNAUTHORIZED');

    const { rawToken, tokenHash } = generateSessionToken();
    const issuedAt = this.now();
    const session: ServiceSessionRecord = {
      sessionId: randomUUID(),
      accountId: account.accountId,
      tokenHash,
      issuedAt,
      expiresAt: computeExpiryInstant(issuedAt, resolvedTtlMs),
      revokedAt: null,
    };
    await this.repository.createSession(session);
    return { rawToken, session };
  }

  /** Returns the authenticated account id, or throws a single generic AuthError('UNAUTHORIZED') for any failure whatsoever. */
  async validateSession(rawToken: string): Promise<ServiceAccountId> {
    if (!isPlausibleSessionToken(rawToken)) throw new AuthError('UNAUTHORIZED');
    const result = await this.repository.validateSession(hashSessionToken(rawToken), this.now());
    if (result.outcome !== 'VALID') throw new AuthError('UNAUTHORIZED');
    return result.session.accountId;
  }

  /** Idempotent: revoking an unknown, already-revoked, or expired token is never an error. */
  async revokeSession(rawToken: string): Promise<void> {
    if (!isPlausibleSessionToken(rawToken)) throw new AuthError('UNAUTHORIZED');
    await this.repository.revokeSession(hashSessionToken(rawToken), this.now());
  }
}
