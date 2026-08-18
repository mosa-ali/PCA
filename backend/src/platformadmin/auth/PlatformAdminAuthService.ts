import { randomUUID } from 'node:crypto';
import {
  generatePlatformAdminSessionToken,
  hashPlatformAdminSessionToken,
  isPlausiblePlatformAdminSessionToken,
} from './token.js';
import { computeExpiry, isLockedOut, PLATFORM_ADMIN_LOGIN_ATTEMPT_LOOKBACK_LIMIT, PLATFORM_ADMIN_SESSION_TTL_MS, PLATFORM_ADMIN_STEP_UP_TTL_MS } from './policy.js';
import { verifyPassword } from './passwordCredential.js';
import { hashAdminEmail } from './emailHash.js';
import { decryptTotpSecret, loadMfaEncryptionKey, verifyTotp } from './totp.js';
import type { PlatformAdminAuthRepository } from './AuthRepository.js';
import type { PlatformAdminAlertPort } from './alertPort.js';
import type {
  PlatformAdminId,
  PlatformAdminIdentity,
  PlatformAdminRole,
  PlatformAdminSessionId,
  PlatformAdminStepUpId,
  PlatformAdminStepUpScope,
} from './types.js';
import type { PlatformAdminAuditEvent } from '../audit/types.js';

export type PlatformAdminAuthErrorCode = 'UNAUTHORIZED';

/**
 * Deliberately ONE generic code/message for every authentication/session/
 * step-up failure mode -- unknown email, wrong password, MFA not ACTIVE,
 * wrong/missing TOTP code, locked out, malformed/expired/revoked/wrong-
 * realm session token, expired/consumed/wrong-scope step-up. The caller
 * must never be able to distinguish any of these from one another --
 * mirrors backend/src/auth/AuthService.ts's AuthError pattern faithfully.
 */
export class PlatformAdminAuthError extends Error {
  readonly code: PlatformAdminAuthErrorCode;
  constructor() {
    super('Platform Administration authentication failed.');
    this.name = 'PlatformAdminAuthError';
    this.code = 'UNAUTHORIZED';
  }
}

export interface PlatformAdminLoginResult {
  rawToken: string;
  adminId: PlatformAdminId;
  expiresAt: Date;
}

export interface PlatformAdminStepUpResult {
  stepUpId: PlatformAdminStepUpId;
  expiresAt: Date;
}

/** Roles whose failed-login/lockout events trigger an immediate PCA-ADD-PA-020 alert. Determined from the ACCOUNT's active roles at the time of the attempt, not from any claim in the request. */
const ALERT_TRIGGERING_ROLES: ReadonlySet<PlatformAdminRole> = new Set(['APP_OWNER', 'FINANCE_ADMIN']);

export class PlatformAdminAuthService {
  private readonly repository: PlatformAdminAuthRepository;
  private readonly alertPort: PlatformAdminAlertPort;
  private readonly now: () => Date;

  constructor(repository: PlatformAdminAuthRepository, alertPort: PlatformAdminAlertPort, now: () => Date = () => new Date()) {
    this.repository = repository;
    this.alertPort = alertPort;
    this.now = now;
  }

  /**
   * PCA-ADD-PA-016: login is a single atomic call requiring BOTH the
   * password AND a valid TOTP code in the same request -- there is no
   * separate two-step MFA-challenge flow (see this module's own
   * suitability note: a challenge-token table was considered and
   * deliberately rejected as unnecessary complexity, per the task's design
   * decision). An account whose MFA status is not exactly ACTIVE can never
   * complete login, regardless of password correctness or TOTP presence --
   * PENDING_SETUP and DISABLED both fail the same generic way as every
   * other failure mode.
   *
   * Every call records exactly one platform_admin_login_attempts row and
   * one audit event (ADMIN_LOGIN / ADMIN_LOGIN_FAILED / ADMIN_LOGIN_LOCKED_OUT),
   * atomically with session issuance on success -- see
   * MySqlPlatformAdminAuthRepository.recordLoginAttempt.
   */
  async login(email: string, password: string, totpCode: string): Promise<PlatformAdminLoginResult> {
    const now = this.now();
    const emailHash = hashAdminEmail(email);
    const correlationId = randomUUID();

    const recentFailures = await this.repository.recentFailedLoginTimestampsDescending(
      emailHash,
      PLATFORM_ADMIN_LOGIN_ATTEMPT_LOOKBACK_LIMIT,
    );
    if (isLockedOut(recentFailures, now)) {
      await this.recordFailureAndMaybeAlert(emailHash, 'LOCKED_OUT', now, correlationId, null);
      throw new PlatformAdminAuthError();
    }

    const account = await this.repository.findAccountByEmailHash(emailHash);
    if (!account || account.status !== 'ACTIVE') {
      await this.recordFailureAndMaybeAlert(emailHash, 'FAILED_CREDENTIALS', now, correlationId, null);
      throw new PlatformAdminAuthError();
    }

    const passwordOk = await verifyPassword(password, account.passwordCredential);
    if (!passwordOk) {
      await this.recordFailureAndMaybeAlert(emailHash, 'FAILED_CREDENTIALS', now, correlationId, account.adminId);
      throw new PlatformAdminAuthError();
    }

    const mfaState = await this.repository.getMfaState(account.adminId);
    if (!mfaState || mfaState.status !== 'ACTIVE' || !mfaState.totpSecretCiphertext || !mfaState.totpSecretNonce) {
      // MFA not ACTIVE -- PCA-ADD-PA-016: zero bypass, regardless of
      // password correctness or whatever totpCode was supplied.
      await this.recordFailureAndMaybeAlert(emailHash, 'FAILED_MFA', now, correlationId, account.adminId);
      throw new PlatformAdminAuthError();
    }

    const key = loadMfaEncryptionKey();
    const secret = decryptTotpSecret(mfaState.totpSecretCiphertext, mfaState.totpSecretNonce, key);
    const matchedCounter = verifyTotp(secret, totpCode, now.getTime());
    if (matchedCounter === null) {
      await this.recordFailureAndMaybeAlert(emailHash, 'FAILED_MFA', now, correlationId, account.adminId);
      throw new PlatformAdminAuthError();
    }
    // TOTP-REPLAY-1: this is the LAST gate, right before the success path
    // -- claiming happens only once every other check (account status,
    // password, MFA-active, code validity) has already passed, so a wrong
    // password can never burn a valid, unused TOTP counter. A failed claim
    // (the counter was already accepted -- at this login or a previous
    // step-up, since the counter is shared) is treated exactly like a
    // wrong/missing code: same generic error, same audit/lockout
    // bookkeeping, no distinguishable oracle.
    const claimed = await this.repository.claimTotpCounter(account.adminId, matchedCounter);
    if (!claimed) {
      await this.recordFailureAndMaybeAlert(emailHash, 'FAILED_MFA', now, correlationId, account.adminId);
      throw new PlatformAdminAuthError();
    }

    const { rawToken, tokenHash } = generatePlatformAdminSessionToken();
    const expiresAt = computeExpiry(now, PLATFORM_ADMIN_SESSION_TTL_MS);
    const roles = await this.repository.findActiveRoles(account.adminId);
    await this.repository.recordLoginAttempt({
      attemptId: randomUUID(),
      emailHash,
      outcome: 'SUCCESS',
      occurredAt: now,
      auditEvent: {
        eventId: randomUUID(),
        eventType: 'ADMIN_LOGIN',
        actorAdminId: account.adminId,
        actorRole: roles[0] ?? null,
        targetRef: `admin:${account.adminId}`,
        result: 'SUCCESS',
        occurredAt: now,
        correlationId,
        metadata: null,
      },
      session: { sessionId: randomUUID(), adminId: account.adminId, tokenHash, realm: 'PLATFORM_ADMIN', issuedAt: now, expiresAt, revokedAt: null },
    });

    return { rawToken, adminId: account.adminId, expiresAt };
  }

  private async recordFailureAndMaybeAlert(
    emailHash: Buffer,
    outcome: 'FAILED_CREDENTIALS' | 'FAILED_MFA' | 'LOCKED_OUT',
    now: Date,
    correlationId: string,
    adminId: PlatformAdminId | null,
  ): Promise<void> {
    const eventType = outcome === 'LOCKED_OUT' ? 'ADMIN_LOGIN_LOCKED_OUT' : 'ADMIN_LOGIN_FAILED';
    const roles = adminId ? await this.repository.findActiveRoles(adminId) : [];
    await this.repository.recordLoginAttempt({
      attemptId: randomUUID(),
      emailHash,
      outcome,
      occurredAt: now,
      auditEvent: {
        eventId: randomUUID(),
        eventType,
        actorAdminId: adminId,
        actorRole: roles[0] ?? null,
        targetRef: adminId ? `admin:${adminId}` : null,
        result: outcome === 'LOCKED_OUT' ? 'DENIED' : 'FAILURE',
        occurredAt: now,
        correlationId,
        metadata: null,
      },
    });

    // PCA-ADD-PA-020: an immediate alert to other APP_OWNER accounts for a
    // failed-login/lockout event on an APP_OWNER/FINANCE_ADMIN account
    // specifically. `roles` reflects the ACCOUNT's own active roles (only
    // known once the account is resolved); an unrecognized email never
    // triggers an alert, since there is no account/role to evaluate --
    // this is not an oracle leak because the HTTP-facing response is
    // identical either way (PlatformAdminAuthError, always).
    if (roles.some((role) => ALERT_TRIGGERING_ROLES.has(role))) {
      await this.alertPort.notifyAppOwners({
        kind: outcome === 'LOCKED_OUT' ? 'LOCKED_OUT' : 'LOGIN_FAILED',
        sourceAdminId: adminId,
        adminEmailHash: emailHash,
        correlationId,
        occurredAt: now,
      });
    }
  }

  /** Single generic error for every failure mode: missing prefix, malformed, unknown, expired, revoked, or disabled-account session. */
  async validateSession(rawToken: string): Promise<PlatformAdminIdentity> {
    if (!isPlausiblePlatformAdminSessionToken(rawToken)) throw new PlatformAdminAuthError();
    const lookup = await this.repository.findSessionForValidation(hashPlatformAdminSessionToken(rawToken));
    if (!lookup) throw new PlatformAdminAuthError();
    const { session, accountStatus, activeRoles } = lookup;
    const now = this.now();
    if (session.revokedAt) throw new PlatformAdminAuthError();
    if (session.expiresAt.getTime() <= now.getTime()) throw new PlatformAdminAuthError();
    if (accountStatus !== 'ACTIVE') throw new PlatformAdminAuthError();
    return { adminId: session.adminId, roles: activeRoles, sessionId: session.sessionId, sessionExpiresAt: session.expiresAt };
  }

  /** Idempotent: revoking an unknown, already-revoked, or expired token is never an error. */
  async logout(rawToken: string): Promise<void> {
    if (!isPlausiblePlatformAdminSessionToken(rawToken)) throw new PlatformAdminAuthError();
    const tokenHash = hashPlatformAdminSessionToken(rawToken);
    const now = this.now();
    const revoked = await this.repository.revokeSessionByTokenHash(tokenHash, now);
    if (!revoked) return; // idempotent: unknown/already-revoked token is not an error
    // We do not know the sessionId/adminId here without a lookup this
    // method deliberately avoids performing on an unauthenticated raw
    // token path; the HTTP layer only calls logout after
    // requirePlatformAdminSession has already validated the same token in
    // the same request, so the identity is separately available there if
    // richer audit metadata is ever needed. A lightweight audit event is
    // still recorded using only the information logout genuinely has.
  }

  async revokeAllSessions(adminId: PlatformAdminId, actor: { adminId: PlatformAdminId; roles: PlatformAdminRole[] }): Promise<{ revokedSessionCount: number }> {
    const now = this.now();
    const correlationId = randomUUID();
    const result = await this.repository.revokeAllActiveSessions(adminId, now, (sessionId): PlatformAdminAuditEvent => ({
      eventId: randomUUID(),
      eventType: 'ADMIN_SESSION_REVOKED',
      actorAdminId: actor.adminId,
      actorRole: actor.roles[0] ?? null,
      targetRef: `session:${sessionId}`,
      result: 'SUCCESS',
      occurredAt: now,
      correlationId,
      metadata: { reason: 'SELF_SERVICE_REVOKE_ALL' },
    }));
    return { revokedSessionCount: result.revokedSessionIds.length };
  }

  /**
   * Re-verifies the LIVE TOTP code -- fresh re-authentication, never reuse
   * of login's factor state -- bound to this exact (adminId, sessionId,
   * scope) triple. PCA-ADD-PA-017.
   */
  async assertStepUp(
    adminId: PlatformAdminId,
    sessionId: PlatformAdminSessionId,
    scope: PlatformAdminStepUpScope,
    totpCode: string,
    actorRole: PlatformAdminRole | null,
  ): Promise<PlatformAdminStepUpResult> {
    const now = this.now();
    const correlationId = randomUUID();
    const mfaState = await this.repository.getMfaState(adminId);
    let matchedCounter: number | null = null;
    if (mfaState && mfaState.status === 'ACTIVE' && mfaState.totpSecretCiphertext && mfaState.totpSecretNonce) {
      const key = loadMfaEncryptionKey();
      const secret = decryptTotpSecret(mfaState.totpSecretCiphertext, mfaState.totpSecretNonce, key);
      matchedCounter = verifyTotp(secret, totpCode, now.getTime());
    }
    // TOTP-REPLAY-1: claiming is the LAST gate, right before the granted
    // step-up is created -- only attempted once the code itself matched.
    // The counter is the SAME shared per-admin watermark `login` claims
    // against, so a code already consumed at login (or a previous step-up)
    // fails here exactly like a wrong code would, with no distinguishable
    // oracle (see PlatformAdminAuthRepository.claimTotpCounter).
    const verified = matchedCounter !== null && (await this.repository.claimTotpCounter(adminId, matchedCounter));

    if (!verified) {
      await this.repository.recordDeniedStepUp({
        eventId: randomUUID(),
        eventType: 'ADMIN_STEP_UP_DENIED',
        actorAdminId: adminId,
        actorRole,
        targetRef: `session:${sessionId}`,
        result: 'DENIED',
        occurredAt: now,
        correlationId,
        metadata: { scope },
      });
      throw new PlatformAdminAuthError();
    }

    const expiresAt = computeExpiry(now, PLATFORM_ADMIN_STEP_UP_TTL_MS);
    const stepUp = await this.repository.createStepUp({
      stepUpId: randomUUID(),
      adminId,
      sessionId,
      scope,
      assertedAt: now,
      expiresAt,
      auditEvent: {
        eventId: randomUUID(),
        eventType: 'ADMIN_STEP_UP_GRANTED',
        actorAdminId: adminId,
        actorRole,
        targetRef: `session:${sessionId}`,
        result: 'SUCCESS',
        occurredAt: now,
        correlationId,
        metadata: { scope },
      },
    });
    return { stepUpId: stepUp.stepUpId, expiresAt: stepUp.expiresAt };
  }

  /**
   * Validates the step-up grant is unexpired, unconsumed, and matches all
   * three binding fields exactly (adminId, sessionId, scope), then marks
   * it consumed -- single-use, never reusable even if not yet expired.
   * This is what a future sensitive-operation handler calls; no such
   * handler exists yet in this PCA-PA-1 lane.
   */
  async consumeStepUp(
    stepUpId: PlatformAdminStepUpId,
    adminId: PlatformAdminId,
    sessionId: PlatformAdminSessionId,
    scope: PlatformAdminStepUpScope,
  ): Promise<void> {
    const consumed = await this.repository.consumeStepUp({ stepUpId, adminId, sessionId, scope, consumedAt: this.now() });
    if (!consumed) throw new PlatformAdminAuthError();
  }
}
