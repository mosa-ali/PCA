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
import type { PlatformAdminAuditEvent, PlatformAdminAuditEventType, PlatformAdminAuditResult } from '../audit/types.js';

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

// PCA-ADMIN-TIMING-1: a fixed, never-matching scrypt-shaped credential used
// only to keep login()'s "unknown email / non-ACTIVE account" branch's
// timing in the same ballpark as its "known account, wrong password"
// branch -- never a real account's hash. Same shape/cost parameters
// passwordCredential.ts's hashPassword produces (scrypt N=32768/r=8/p=1,
// 16-byte salt, 64-byte derived key), matching
// backend/src/parentaccount/ParentAccountService.ts's DUMMY_PASSWORD_HASH
// precedent exactly.
const DUMMY_PASSWORD_CREDENTIAL = `scrypt$32768$8$1$${'00'.repeat(16)}$${'00'.repeat(64)}`;

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
      // PCA-ADMIN-TIMING-1: still run a real scrypt verification against a
      // fixed, never-matching credential so this branch (unknown email /
      // SUSPENDED / DEACTIVATED account) costs roughly the same wall-clock
      // time as the "known ACTIVE account, wrong password" branch below --
      // mirrors backend/src/parentaccount/ParentAccountService.ts's login()
      // DUMMY_PASSWORD_HASH precedent exactly. Without this, an unknown-email
      // request returns almost immediately while a known-email request pays
      // the full scrypt cost, letting an attacker enumerate which admin
      // emails exist purely from response latency -- a real timing oracle on
      // exactly the highest-privilege account set in this system.
      await verifyPassword(password, DUMMY_PASSWORD_CREDENTIAL);
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

  /**
   * The ONE failed-attempt ledger + alert path for this whole service.
   *
   * PCA-STEPUP-LOCKOUT-1: `assertStepUp` now calls this too, via
   * `auditOverride` -- deliberately the SAME method, the SAME
   * `platform_admin_login_attempts` row shape and the SAME
   * `PCA-ADD-PA-020` alert rule login has always used, rather than a
   * parallel step-up-only mechanism. The override exists ONLY so the audit
   * row a step-up denial writes keeps its accurate
   * `ADMIN_STEP_UP_DENIED`/`session:<id>`/`{ scope }` shape (the closed
   * audit vocabulary in ../audit/types.ts already has that event type;
   * nothing new is introduced here). `outcome` is still one of the four
   * values migration 0005's `platform_admin_login_attempts_outcome_check`
   * permits, and `kind` still one of the two values migration 0021's
   * `platform_admin_security_alerts_kind_check` permits -- this change
   * requires no migration.
   *
   * Because the attempt row is keyed by `email_hash` and carries a
   * FAILED_MFA outcome, a denied step-up counts toward -- and is counted by
   * -- exactly the same rolling 15-minute / 5-failure lockout window as a
   * failed login (`recentFailedLoginTimestampsDescending` selects
   * FAILED_CREDENTIALS + FAILED_MFA). One shared budget across both
   * factors-verifying entry points is the point: an attacker holding a
   * stolen session token cannot get a fresh TOTP-guessing budget just by
   * switching from /login to /step-up.
   */
  private async recordFailureAndMaybeAlert(
    emailHash: Buffer,
    outcome: 'FAILED_CREDENTIALS' | 'FAILED_MFA' | 'LOCKED_OUT',
    now: Date,
    correlationId: string,
    adminId: PlatformAdminId | null,
    auditOverride?: {
      eventType: PlatformAdminAuditEventType;
      targetRef: string;
      result: PlatformAdminAuditResult;
      metadata: Record<string, unknown>;
    },
  ): Promise<void> {
    const eventType: PlatformAdminAuditEventType =
      auditOverride?.eventType ?? (outcome === 'LOCKED_OUT' ? 'ADMIN_LOGIN_LOCKED_OUT' : 'ADMIN_LOGIN_FAILED');
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
        targetRef: auditOverride?.targetRef ?? (adminId ? `admin:${adminId}` : null),
        result: auditOverride?.result ?? (outcome === 'LOCKED_OUT' ? 'DENIED' : 'FAILURE'),
        occurredAt: now,
        correlationId,
        metadata: auditOverride?.metadata ?? null,
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
   *
   * PCA-STEPUP-LOCKOUT-1 (security fix): this method used to record a
   * single ADMIN_STEP_UP_DENIED audit row on failure and NOTHING else --
   * no lockout check, no failed-attempt row, no PCA-ADD-PA-020 alert, no
   * session consequence. `login` has had all four since PCA-ADD-PA-020.
   * That asymmetry made step-up the cheap way in: step-up exists precisely
   * to stop an attacker who holds a stolen (12-hour) admin session token
   * but NOT the TOTP device, and `verifyTotp` accepts a +/-1 step window
   * (3 valid codes out of 10^6 per window), so unlimited step-up attempts
   * against a stolen session were a pure brute-force race with no
   * detection and no ceiling -- and success yields a REFUND-scoped
   * stepUpId, i.e. money movement.
   *
   * The fix reuses login's existing, already-reviewed machinery verbatim,
   * in the same order login applies it:
   *   1. resolve the account so the SAME email_hash-keyed attempt ledger
   *      login reads/writes is addressable from here (no new table, no new
   *      key);
   *   2. `recentFailedLoginTimestampsDescending` + `isLockedOut` BEFORE any
   *      TOTP work -- a locked-out admin cannot even present a code;
   *   3. `recordFailureAndMaybeAlert` on every denial -- one attempt row
   *      (FAILED_MFA / LOCKED_OUT) plus the APP_OWNER alert for
   *      APP_OWNER/FINANCE_ADMIN accounts;
   *   4. once the denial crosses the lockout threshold, force-revoke every
   *      active session for the admin, which is what actually kills the
   *      stolen token the attacker is riding on (the one consequence login
   *      has no need of, because a failed login never holds a session).
   *
   * Deliberately NOT a new mechanism, a new table, a new alert kind, or a
   * new audit event type: every constant, query, alert kind and audit event
   * type used here already existed and is already covered by migrations
   * 0005/0021's CHECK constraints.
   *
   * KNOWN GAP, deliberately NOT addressed here: this method still applies
   * no RBAC check to `scope` -- any authenticated admin can obtain a
   * REFUND-scoped grant. It is not directly exploitable today because every
   * sensitive route re-checks its own operation authorization around
   * `consumeStepUp` (e.g. billingRefundRoutes.ts requires ISSUE_REFUND),
   * so an unauthorized grant is unusable. Reported rather than fixed: a
   * scope -> operation map is a cross-lane interface change.
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

    // The attempt ledger and the lockout window are keyed by email_hash
    // (that is the identifier login rate-limits on), so the account row is
    // what makes the shared budget addressable from an adminId-keyed call.
    // Fail CLOSED if it cannot be resolved: never mint a step-up grant for
    // an admin whose account row we cannot read. Unreachable in practice
    // (validateSession already required an ACTIVE account for this session)
    // except as a delete/disable race, which should deny anyway.
    const account = await this.repository.findAccountById(adminId);
    if (!account) {
      await this.repository.recordDeniedStepUp(
        this.buildStepUpDeniedEvent(adminId, actorRole, sessionId, scope, now, correlationId, 'UNKNOWN_ACCOUNT'),
      );
      throw new PlatformAdminAuthError();
    }
    const emailHash = account.emailHash;

    const recentFailures = await this.repository.recentFailedLoginTimestampsDescending(
      emailHash,
      PLATFORM_ADMIN_LOGIN_ATTEMPT_LOOKBACK_LIMIT,
    );
    if (isLockedOut(recentFailures, now)) {
      await this.denyStepUp(emailHash, 'LOCKED_OUT', adminId, actorRole, sessionId, scope, now, correlationId);
      throw new PlatformAdminAuthError();
    }

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
      await this.denyStepUp(emailHash, 'FAILED_MFA', adminId, actorRole, sessionId, scope, now, correlationId);
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

  private buildStepUpDeniedEvent(
    adminId: PlatformAdminId,
    actorRole: PlatformAdminRole | null,
    sessionId: PlatformAdminSessionId,
    scope: PlatformAdminStepUpScope,
    now: Date,
    correlationId: string,
    reason: string,
  ): PlatformAdminAuditEvent {
    return {
      eventId: randomUUID(),
      eventType: 'ADMIN_STEP_UP_DENIED',
      actorAdminId: adminId,
      actorRole,
      targetRef: `session:${sessionId}`,
      result: 'DENIED',
      occurredAt: now,
      correlationId,
      // Non-secret operational metadata only: the requested scope and a
      // coarse reason code. Never the submitted code, never any factor
      // state -- same discipline the login path's audit rows follow.
      metadata: { scope, reason },
    };
  }

  /**
   * PCA-STEPUP-LOCKOUT-1: the single denial path for `assertStepUp`.
   * Writes exactly ONE audit row (still ADMIN_STEP_UP_DENIED, with its
   * scope/session context intact) and ONE platform_admin_login_attempts
   * row, atomically together via `recordLoginAttempt` -- strictly better
   * than the pre-fix behaviour, which wrote the audit row on its own with
   * no attempt row at all -- then fires the PCA-ADD-PA-020 alert under the
   * exact same APP_OWNER/FINANCE_ADMIN rule login uses.
   *
   * Finally, if this denial has taken the admin over the lockout threshold,
   * every active session for that admin is force-revoked. This is the part
   * login has no analogue for and step-up genuinely needs: the attack this
   * defends against is someone RIDING a stolen, still-valid session token,
   * so locking the identifier out is not enough on its own -- the token has
   * to die. Revoking ALL sessions rather than just `sessionId` is
   * deliberate: the platform cannot tell the attacker's session from the
   * legitimate operator's, so it revokes both and makes the operator
   * re-authenticate with their real second factor. Reuses
   * `revokeAllActiveSessions`, the same repository method
   * `revokeAllSessions`/role-revocation/account-disable already cascade
   * through, so the ADMIN_SESSION_REVOKED audit trail is identical.
   */
  private async denyStepUp(
    emailHash: Buffer,
    outcome: 'FAILED_MFA' | 'LOCKED_OUT',
    adminId: PlatformAdminId,
    actorRole: PlatformAdminRole | null,
    sessionId: PlatformAdminSessionId,
    scope: PlatformAdminStepUpScope,
    now: Date,
    correlationId: string,
  ): Promise<void> {
    await this.recordFailureAndMaybeAlert(emailHash, outcome, now, correlationId, adminId, {
      eventType: 'ADMIN_STEP_UP_DENIED',
      targetRef: `session:${sessionId}`,
      result: 'DENIED',
      metadata: { scope, reason: outcome },
    });

    // Re-read the ledger AFTER the row above landed, so the failure just
    // recorded is counted. A LOCKED_OUT row is not itself a countable
    // failure (recentFailedLoginTimestampsDescending selects only
    // FAILED_CREDENTIALS/FAILED_MFA), exactly as on the login path -- so on
    // the already-locked-out branch this simply re-confirms the standing
    // lockout and the revocation below is idempotent (no active sessions
    // remain to revoke after the first time).
    const failuresIncludingThisOne = await this.repository.recentFailedLoginTimestampsDescending(
      emailHash,
      PLATFORM_ADMIN_LOGIN_ATTEMPT_LOOKBACK_LIMIT,
    );
    if (!isLockedOut(failuresIncludingThisOne, now)) return;

    await this.repository.revokeAllActiveSessions(adminId, now, (revokedSessionId): PlatformAdminAuditEvent => ({
      eventId: randomUUID(),
      eventType: 'ADMIN_SESSION_REVOKED',
      actorAdminId: adminId,
      actorRole,
      targetRef: `session:${revokedSessionId}`,
      result: 'SUCCESS',
      occurredAt: now,
      correlationId,
      metadata: { reason: 'STEP_UP_DENIAL_LOCKOUT' },
    }));
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
