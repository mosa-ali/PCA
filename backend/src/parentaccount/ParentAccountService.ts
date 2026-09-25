import { randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import type { AuthService } from '../auth/AuthService.js';
import { DEFAULT_SESSION_TTL_MS } from '../auth/policy.js';
import type { OpaqueFamilyId } from '../familytrustset/types.js';
import { hashParentEmail, isPlausibleEmail } from './emailHash.js';
import { DUMMY_PASSWORD_HASH, hashPassword, isPlausiblePassword, verifyPassword } from './passwordCredential.js';
import { generateVerificationCode, hashVerificationCode, isPlausibleVerificationCode, verificationCodeHashesMatch } from './verificationCode.js';
import {
  MAX_LOGIN_STEP_UP_ATTEMPTS_PER_CODE,
  MAX_PARENT_MFA_RECOVERY_ATTEMPTS_PER_CODE,
  MAX_PASSWORD_RESET_ATTEMPTS_PER_CODE,
  MAX_VERIFICATION_ATTEMPTS_PER_CODE,
  LOGIN_STEP_UP_CODE_TTL_MS,
  DAILY_LOGIN_GRANT_PURPOSE,
  DAILY_LOGIN_GRANT_TTL_MS,
  PARENT_MFA_RECOVERY_CODE_TTL_MS,
  PARENT_MFA_RECOVERY_HOLD_MS,
  PASSWORD_RESET_CODE_TTL_MS,
  VERIFICATION_CODE_TTL_MS,
  computeFreeAccessExpiry,
  resolveFreeAccessDefaults,
} from './policy.js';
import type { ParentAccountRepository } from './ParentAccountRepository.js';
import type { FamilyMembershipRepository, FamilyMembershipRole } from '../familymembers/FamilyMembershipRepository.js';
import type { EmailSenderPort, ParentSecurityNotice } from './EmailSenderPort.js';
import type {
  CompleteEnrollmentOutcome,
  CompleteLoginStepUpOutcome,
  LoginOutcome,
  ParentAccountId,
  ParentAccountRecord,
  ParentMfaSummary,
  RegisterOutcome,
  RequestPasswordResetOutcome,
  ResetPasswordOutcome,
  SessionReadOutcome,
  VerifyEmailOutcome,
  ParentSignupProfile,
} from './types.js';
import { generateDailyLoginGrant, hashDailyLoginGrant, isPlausibleDailyLoginGrant } from './dailyLoginGrant.js';
import { ParentMfaError, ParentMfaService, type ParentMfaPosture } from './mfa/ParentMfaService.js';
import type { CommercialStepUpOperation } from './mfa/ParentMfaRepository.js';

export type ParentAccountErrorCode = 'INVALID_INPUT' | 'UNAUTHORIZED' | 'RATE_LIMITED' | 'MFA_INVALID' | 'MFA_LOCKED' | 'FORBIDDEN';

/**
 * Deliberately ONE generic code/message per failure category -- mirrors
 * AuthService.AuthError/PlatformAdminAuthService.PlatformAdminAuthError
 * exactly. UNAUTHORIZED covers every login/verify-email failure mode
 * (unknown email, wrong password, unverified account, wrong/expired/
 * already-consumed code) -- the caller can never distinguish which.
 * MFA_INVALID/MFA_LOCKED are only ever raised AFTER the password has been
 * proven, so they reveal nothing an unauthenticated caller could not learn.
 */
export class ParentAccountError extends Error {
  readonly code: ParentAccountErrorCode;
  constructor(code: ParentAccountErrorCode) {
    super(code);
    this.name = 'ParentAccountError';
    this.code = code;
  }
}

/**
 * How many of an account's most recent verification-code rows verifyEmail
 * will consider. Bounded work per request, and comfortably above what
 * REGISTER_EMAIL_RATE_LIMIT (5 registrations per email per hour) can
 * produce inside one VERIFICATION_CODE_TTL_MS (15 minute) window, so a real
 * registrant's own code can never be pushed out of the candidate set by
 * someone else's re-registrations.
 */
const MAX_LIVE_VERIFICATION_CODES_CONSIDERED = 10;

export interface ParentAccountServiceDeps {
  repository: ParentAccountRepository;
  authService: AuthService;
  emailSender: EmailSenderPort;
  /** PCA-DEC-037 authenticator-app MFA. Required: there is no Parent login path without it. */
  mfaService: ParentMfaService;
  /** Active family-role persistence. Missing/unresolved membership fails closed. */
  familyMembershipRepository?: FamilyMembershipRepository;
  now?: () => Date;
}

/** How the enrollment endpoints were reached: an existing session, or a short-lived ticket earned without one. */
export type EnrollmentCredential = { kind: 'SESSION'; rawSessionToken: string } | { kind: 'TICKET'; rawTicket: string };

/**
 * Orchestrates the Parent account journey (PCA-DEC-026 registration, as
 * amended by PCA-DEC-037): register -> verify email -> first login (starts
 * the one 3-day MFA grace window and provisions the family server-side) ->
 * authenticator enrollment -> every later explicit login is
 * email + password + 6-digit TOTP.
 *
 * Delegates ALL session token issuance/validation/single-token revocation to
 * the EXISTING backend/src/auth/AuthService (PCA_IMPL_DECISION_003).
 * accountReferenceHash is always sha256(this domain's own accountId).
 */
export class ParentAccountService {
  private readonly repository: ParentAccountRepository;
  private readonly authService: AuthService;
  private readonly emailSender: EmailSenderPort;
  private readonly mfa: ParentMfaService;
  private readonly familyMembershipRepository: FamilyMembershipRepository | undefined;
  private readonly now: () => Date;

  constructor(deps: ParentAccountServiceDeps) {
    this.repository = deps.repository;
    this.authService = deps.authService;
    this.emailSender = deps.emailSender;
    this.mfa = deps.mfaService;
    // Test-only in-memory repositories may implement the membership port on
    // the same object. Production must pass the explicit durable repository;
    // an absent resolver still fails closed in resolveFamilyRole().
    this.familyMembershipRepository = deps.familyMembershipRepository ??
      (typeof (deps.repository as ParentAccountRepository & { findActiveRole?: unknown }).findActiveRole === 'function'
        ? (deps.repository as unknown as FamilyMembershipRepository)
        : undefined);
    this.now = deps.now ?? (() => new Date());
  }

  /**
   * PCA-ADD-IDENT-004: the server never trusts a client-asserted
   * password===passwordConfirmation match beyond re-checking it itself.
   * Response is IDENTICAL ({status:'PENDING_VERIFICATION'}) whether the
   * email was new, already PENDING_VERIFICATION (resend), or already
   * VERIFIED (silent no-op) -- never an enumeration oracle.
   *
   * PENDING_VERIFICATION CREDENTIAL BINDING (migration 0030): a registration
   * for an email that already has a still-unverified account never writes that
   * account's credential. Each registration issues its OWN verification code
   * carrying its OWN credential, and the account's credential is written
   * exactly once, by whichever code is actually redeemed.
   */
  async register(email: string, password: string, passwordConfirmation: string, profile?: ParentSignupProfile): Promise<RegisterOutcome> {
    if (!isPlausibleEmail(email) || !isPlausiblePassword(password) || password !== passwordConfirmation) {
      throw new ParentAccountError('INVALID_INPUT');
    }
    if (
      profile &&
      ((profile.accountType !== 'PARENT_GUARDIAN' && profile.accountType !== 'OTHER') ||
        profile.estimatedChildCount !== null &&
          (!Number.isInteger(profile.estimatedChildCount) || profile.estimatedChildCount < 0 || profile.estimatedChildCount > 50))
    ) {
      throw new ParentAccountError('INVALID_INPUT');
    }
    const emailHash = hashParentEmail(email);
    const existing = await this.repository.findByEmailHash(emailHash);
    const passwordHash = await hashPassword(password);
    const now = this.now();

    if (existing === null) {
      const accountId = randomUUID();
      try {
        await this.repository.createPendingAccount({
          accountId,
          emailHash,
          passwordHash,
          createdAt: now,
          accountType: profile?.accountType ?? null,
          estimatedChildCount: profile?.estimatedChildCount ?? null,
        });
      } catch (error) {
        // A concurrent registration for the same email won the race --
        // fall through to the identical PENDING_VERIFICATION response.
        if (!isDuplicateEntryLike(error)) throw error;
      }
      const account = await this.repository.findByEmailHash(emailHash);
      if (account && account.status === 'PENDING_VERIFICATION') {
        await this.issueAndSendVerificationCode(account.accountId, email, passwordHash);
      }
      return { status: 'PENDING_VERIFICATION' };
    }

    if (existing.status === 'PENDING_VERIFICATION') {
      await this.issueAndSendVerificationCode(existing.accountId, email, passwordHash);
    }
    // existing.status === 'VERIFIED': silent no-op, identical response.
    return { status: 'PENDING_VERIFICATION' };
  }

  private async issueAndSendVerificationCode(accountId: ParentAccountId, email: string, passwordHash: string): Promise<void> {
    const now = this.now();
    const { code, codeHash } = generateVerificationCode();
    await this.repository.insertVerificationCode({
      codeId: randomUUID(),
      accountId,
      codeHash,
      // The credential THIS code authorises -- never applied to the account
      // until (and unless) this specific code is redeemed. See register().
      passwordHash,
      createdAt: now,
      expiresAt: new Date(now.getTime() + VERIFICATION_CODE_TTL_MS),
    });
    // Best-effort: a transport failure must never distinguish this response
    // from any other branch's identical response.
    try {
      await this.emailSender.sendVerificationCode(email, code);
    } catch {
      // deliberately swallowed
    }
  }

  /**
   * Redeems ONE of the account's still-live verification codes and applies
   * THAT code's own bound credential (migration 0030) as it marks the
   * account VERIFIED. Every live code is a candidate; one submitted code
   * costs one attempt against every live candidate, so the total guess
   * budget is unchanged.
   *
   * PCA-DEC-037: activation only. No session is issued here and no family is
   * created here -- both happen at the first real sign-in. An
   * ACCOUNT_ACTIVATED notice is sent to the address that just proved it
   * controls the mailbox.
   */
  async verifyEmail(email: string, code: string): Promise<VerifyEmailOutcome> {
    if (!isPlausibleEmail(email) || !isPlausibleVerificationCode(code)) {
      throw new ParentAccountError('INVALID_INPUT');
    }
    const emailHash = hashParentEmail(email);
    const account = await this.repository.findByEmailHash(emailHash);
    if (!account || account.status !== 'PENDING_VERIFICATION') throw new ParentAccountError('UNAUTHORIZED');

    const recentCodes = await this.repository.findRecentVerificationCodes(account.accountId, MAX_LIVE_VERIFICATION_CODES_CONSIDERED);
    const nowMs = this.now().getTime();
    const liveCodes = recentCodes.filter(
      (candidate) =>
        candidate.consumedAt === null &&
        candidate.attemptCount < MAX_VERIFICATION_ATTEMPTS_PER_CODE &&
        candidate.expiresAt.getTime() > nowMs,
    );
    if (liveCodes.length === 0) throw new ParentAccountError('UNAUTHORIZED');

    for (const candidate of liveCodes) {
      await this.repository.incrementVerificationAttempt(candidate.codeId);
    }
    const candidateHash = hashVerificationCode(code);
    const activeCode = liveCodes.find((candidate) => verificationCodeHashesMatch(candidateHash, candidate.codeHash));
    if (!activeCode) throw new ParentAccountError('UNAUTHORIZED');

    const won = await this.repository.consumeVerificationCodeIfUnconsumed(activeCode.codeId, this.now());
    if (!won) throw new ParentAccountError('UNAUTHORIZED'); // lost a concurrent verify-email race for the same code

    const now = this.now();
    const defaults = resolveFreeAccessDefaults();
    const expiresAt = computeFreeAccessExpiry(now, defaults);

    await this.repository.markVerified({
      accountId: account.accountId,
      verifiedAt: now,
      familyId: null,
      passwordHash: activeCode.passwordHash,
      freeAccess: {
        mode: defaults.mode,
        durationDays: defaults.durationDays,
        startedAt: now,
        expiresAt,
        defaultParentMemberLimit: defaults.defaultParentMemberLimit,
        defaultManagedDeviceLimit: defaults.defaultManagedDeviceLimit,
      },
    });
    await this.notify(email, 'ACCOUNT_ACTIVATED', `activated:${account.accountId}`);
    return { status: 'VERIFIED' };
  }

  /**
   * PCA-ADD-IDENT-012 + PCA-DEC-037. Generic UNAUTHORIZED for every
   * pre-password failure. After the password is proven:
   *   - ACTIVE authenticator: a valid 6-digit TOTP is required on EVERY
   *     explicit login. No email code and no remembered-browser grant can
   *     replace it; MFA_REQUIRED is returned until one is supplied.
   *   - Grace running (or first login): emailed step-up, or this browser's
   *     own daily grant, exactly as before.
   *   - Grace over: emailed step-up always (daily grants no longer count),
   *     and its completion yields an enrollment ticket, never a session.
   */
  async login(email: string, password: string, dailyLoginGrantToken?: string, totpCode?: string): Promise<LoginOutcome> {
    if (!isPlausibleEmail(email) || typeof password !== 'string' || password.length === 0) {
      throw new ParentAccountError('INVALID_INPUT');
    }
    const account = await this.findVerifiedAccountWithPassword(email, password);

    // PCA-ADD-PA-017: a Platform Admin-suspended family cannot sign in.
    // Identical generic UNAUTHORIZED, so suspension is indistinguishable
    // from a wrong password.
    if (account.familyId !== null) {
      const familyStatus = await this.repository.findFamilyStatus(account.familyId);
      if (familyStatus === 'SUSPENDED') throw new ParentAccountError('UNAUTHORIZED');
    }

    const posture = await this.mfa.posture(account.accountId);
    if (posture.status === 'RECOVERY_PENDING') return { status: 'MFA_RECOVERY_PENDING', recoveryAvailableAt: posture.recoveryAvailableAt };
    if (posture.status === 'ACTIVE') {
      if (typeof totpCode !== 'string' || totpCode.length === 0) return { status: 'MFA_REQUIRED' };
      await this.verifyTotpOrThrow(account.accountId, totpCode);
      return { status: 'AUTHENTICATED', ...(await this.establishSession(account, email)) };
    }

    if (posture.status !== 'SETUP_REQUIRED' && isPlausibleDailyLoginGrant(dailyLoginGrantToken)) {
      const grantValid = await this.repository.validateAndTouchDailyLoginGrant(account.accountId, hashDailyLoginGrant(dailyLoginGrantToken), this.now());
      if (grantValid) return { status: 'AUTHENTICATED', ...(await this.establishSession(account, email)) };
    }

    await this.issueAndSendLoginStepUpCode(account.accountId, email);
    return { status: 'STEP_UP_REQUIRED' };
  }

  private async issueAndSendLoginStepUpCode(accountId: ParentAccountId, email: string): Promise<void> {
    const now = this.now();
    const { code, codeHash } = generateVerificationCode();
    await this.repository.insertLoginStepUpCode({
      codeId: randomUUID(),
      accountId,
      codeHash,
      createdAt: now,
      expiresAt: new Date(now.getTime() + LOGIN_STEP_UP_CODE_TTL_MS),
    });
    try {
      await this.emailSender.sendLoginStepUpCode(email, code);
    } catch {
      // deliberately swallowed -- see issueAndSendVerificationCode
    }
  }

  /**
   * Consumes an emailed login code. For an account WITHOUT an active
   * authenticator this is the second factor: inside grace it issues the
   * session plus a fresh browser grant; after grace it issues only an
   * enrollment ticket. For an account WITH an active authenticator an email
   * code never authenticates -- even one issued before enrollment.
   */
  async completeLoginStepUp(email: string, code: string): Promise<CompleteLoginStepUpOutcome> {
    if (!isPlausibleEmail(email) || !isPlausibleVerificationCode(code)) {
      throw new ParentAccountError('INVALID_INPUT');
    }
    const account = await this.repository.findByEmailHash(hashParentEmail(email));
    if (!account || account.status !== 'VERIFIED' || account.disabledAt !== null) throw new ParentAccountError('UNAUTHORIZED');

    const activeCode = await this.repository.findLatestLoginStepUpCode(account.accountId);
    if (!activeCode || activeCode.consumedAt !== null) throw new ParentAccountError('UNAUTHORIZED');
    if (activeCode.attemptCount >= MAX_LOGIN_STEP_UP_ATTEMPTS_PER_CODE) throw new ParentAccountError('UNAUTHORIZED');
    if (activeCode.expiresAt.getTime() <= this.now().getTime()) throw new ParentAccountError('UNAUTHORIZED');

    await this.repository.incrementLoginStepUpAttempt(activeCode.codeId);
    if (!verificationCodeHashesMatch(hashVerificationCode(code), activeCode.codeHash)) throw new ParentAccountError('UNAUTHORIZED');

    const won = await this.repository.consumeLoginStepUpCodeIfUnconsumed(activeCode.codeId, this.now());
    if (!won) throw new ParentAccountError('UNAUTHORIZED'); // lost a concurrent completion race for the same code

    const posture = await this.mfa.posture(account.accountId);
    if (posture.status === 'RECOVERY_PENDING') throw new ParentAccountError('UNAUTHORIZED');
    if (posture.status === 'ACTIVE') throw new ParentAccountError('UNAUTHORIZED');
    if (posture.status === 'SETUP_REQUIRED') {
      return { status: 'MFA_SETUP_REQUIRED', rawEnrollmentTicket: await this.mfa.issueTicket(account.accountId, 'MFA_SETUP_REQUIRED') };
    }

    await this.repository.markFirstLoginCompletedIfAbsent(account.accountId, this.now());
    const established = await this.establishSession(account, email);
    const dailyGrant = generateDailyLoginGrant();
    try {
      await this.repository.insertDailyLoginGrant({
        grantId: randomUUID(),
        accountId: account.accountId,
        tokenHash: dailyGrant.tokenHash,
        purpose: DAILY_LOGIN_GRANT_PURPOSE,
        createdAt: this.now(),
        expiresAt: new Date(this.now().getTime() + DAILY_LOGIN_GRANT_TTL_MS),
      });
    } catch (error) {
      await this.authService.revokeSession(established.rawSessionToken).catch(() => undefined);
      throw error;
    }
    return { status: 'AUTHENTICATED', ...established, rawDailyLoginGrantToken: dailyGrant.rawToken };
  }

  /**
   * Issues a session for an account that has just passed every required
   * factor, and performs the server-side first-login work:
   *   1. starts the one MFA grace window if this is the first login (and sends
   *      the first-login notice),
   *   2. caps a not-yet-enrolled account's session at the grace deadline, so no
   *      session outlives the grace period,
   *   3. provisions (or re-asserts) the account's family and ADMINISTRATOR
   *      membership in one transaction.
   */
  private async establishSession(account: ParentAccountRecord, email: string) {
    let posture: ParentMfaPosture = await this.mfa.posture(account.accountId);
    if (posture.status === 'NOT_STARTED') {
      const { started, posture: next } = await this.mfa.startGraceIfAbsent(account.accountId);
      posture = next;
      if (started) {
        await this.mfa.event(account.accountId, 'FIRST_LOGIN', null);
        await this.notify(email, 'FIRST_LOGIN', `first-login:${account.accountId}`);
      }
    }
    if (posture.status === 'SETUP_REQUIRED' || posture.status === 'NOT_STARTED') throw new ParentAccountError('UNAUTHORIZED');

    const now = this.now();
    const ttlMs = posture.status === 'GRACE' ? Math.min(DEFAULT_SESSION_TTL_MS, posture.graceExpiresAt.getTime() - now.getTime()) : DEFAULT_SESSION_TTL_MS;
    if (ttlMs <= 0) throw new ParentAccountError('UNAUTHORIZED');
    const issued = await this.issueSessionFor(account.accountId, ttlMs);
    const postIssuePosture = await this.mfa.posture(account.accountId);
    if (postIssuePosture.status === 'RECOVERY_PENDING' || postIssuePosture.status === 'SETUP_REQUIRED') {
      await this.authService.revokeSession(issued.rawToken).catch(() => undefined);
      throw new ParentAccountError('UNAUTHORIZED');
    }
    let familyId: OpaqueFamilyId;
    try {
      const provisioned = await this.repository.ensureProvisionedFamily(account.accountId, issued.session.accountId, now);
      familyId = provisioned.familyId;
      if (provisioned.created) await this.mfa.event(account.accountId, 'FAMILY_PROVISIONED', null);
    } catch (error) {
      await this.authService.revokeSession(issued.rawToken).catch(() => undefined);
      throw error;
    }
    const role = await this.resolveFamilyRole(account.accountId, familyId);
    return {
      accountId: account.accountId,
      familyId,
      rawSessionToken: issued.rawToken,
      sessionExpiresAt: issued.session.expiresAt,
      role,
      mfa: summarize(posture),
    };
  }

  private async issueSessionFor(accountId: ParentAccountId, ttlMs?: number) {
    const identity = { accountReferenceHash: accountReferenceHashFor(accountId) };
    const issued = await this.authService.issueSession(identity, ttlMs);
    await this.repository.setServiceAccountIdIfAbsent(accountId, issued.session.accountId);
    return issued;
  }

  /**
   * GET /api/parent/session. Fails closed (UNAUTHORIZED) for a
   * missing/expired/revoked session, a disabled account, an account whose
   * grace is over without an authenticator, or a legacy session that never
   * went through a PCA-DEC-037 login (no grace record).
   */
  async readSession(rawSessionToken: string): Promise<SessionReadOutcome> {
    const { account, serviceAccountId, posture } = await this.resolveUsableSession(rawSessionToken);
    let familyId = account.familyId;
    if (familyId === null) familyId = (await this.repository.ensureProvisionedFamily(account.accountId, serviceAccountId, this.now())).familyId;
    const role = await this.resolveFamilyRole(account.accountId, familyId);
    return { accountId: account.accountId, familyId, emailVerified: true, role, mfa: summarize(posture) };
  }

  /**
   * Begins authenticator enrollment. Re-authenticates with email + password
   * even on the session path, so a stolen session alone can never bind an
   * attacker's authenticator. An ACTIVE factor is never replaced here; that
   * requires recovery.
   */
  async beginMfaEnrollment(credential: EnrollmentCredential, email: string, password: string): Promise<{ otpauthUri: string; secretBase32: string }> {
    const { account } = await this.resolveEnrollmentAccount(credential);
    await this.assertEmailAndPassword(account, email, password);
    try {
      return await this.mfa.beginEnrollment(account.accountId, email.trim().toLowerCase());
    } catch (error) {
      throw mapMfaError(error);
    }
  }

  /**
   * Confirms enrollment with one valid code. Every remembered-browser grant is
   * revoked (they could otherwise never be used again, but this removes them
   * from the database outright). On the ticket path the ticket is consumed and
   * THIS browser receives its session; on the session path the session is kept.
   */
  async confirmMfaEnrollment(credential: EnrollmentCredential, email: string, code: string): Promise<CompleteEnrollmentOutcome> {
    const { account, ticketId } = await this.resolveEnrollmentAccount(credential);
    this.assertEmail(account, email);
    try {
      await this.mfa.confirmEnrollment(account.accountId, code);
    } catch (error) {
      throw mapMfaError(error);
    }
    await this.repository.revokeAllDailyLoginGrants(account.accountId, this.now());
    await this.notify(email, 'MFA_ENROLLED', `mfa-enrolled:${account.accountId}:${this.now().getTime()}`);
    if (ticketId === null) return { status: 'ENROLLED' };
    if (!(await this.mfa.consumeTicket(ticketId))) throw new ParentAccountError('UNAUTHORIZED');
    return { status: 'ENROLLED_SESSION_ESTABLISHED', ...(await this.establishSession(account, email)) };
  }

  /**
   * Lost authenticator, step 1. Identical response whatever happens; a code
   * is emailed only to a verified, enabled account whose password is correct
   * and which has an ACTIVE authenticator.
   */
  async requestMfaRecovery(email: string, password: string): Promise<void> {
    if (!isPlausibleEmail(email) || typeof password !== 'string' || password.length === 0) throw new ParentAccountError('INVALID_INPUT');
    let account: ParentAccountRecord;
    try {
      account = await this.findVerifiedAccountWithPassword(email, password);
    } catch {
      return;
    }
    const recoveryPosture = await this.mfa.posture(account.accountId);
    if (recoveryPosture.status !== 'ACTIVE' && recoveryPosture.status !== 'RECOVERY_PENDING') return;
    const now = this.now();
    const { code, codeHash } = generateVerificationCode();
    await this.mfa.recordRecoveryCode(account.accountId, codeHash, now, new Date(now.getTime() + PARENT_MFA_RECOVERY_CODE_TTL_MS));
    await this.mfa.event(account.accountId, 'MFA_RECOVERY_REQUESTED', null);
    try {
      await this.emailSender.sendMfaRecoveryCode(email, code);
    } catch {
      // deliberately swallowed
    }
  }

  /**
   * Lost authenticator, step 2. The first verified code starts an immutable
   * 24-hour server hold and revokes every session. A fresh code after the
   * deadline clears the old factor and yields a ticket for a newly generated
   * authenticator. Codes received during the hold cannot shorten or extend it.
   */
  async completeMfaRecovery(email: string, password: string, code: string): Promise<{ status: 'MFA_RECOVERY_PENDING'; recoveryAvailableAt: Date } | { status: 'MFA_SETUP_REQUIRED'; rawEnrollmentTicket: string }> {
    if (!isPlausibleEmail(email) || !isPlausibleVerificationCode(code) || typeof password !== 'string' || password.length === 0) {
      throw new ParentAccountError('INVALID_INPUT');
    }
    const account = await this.findVerifiedAccountWithPassword(email, password);
    const now = this.now();
    const recoveryCode = await this.mfa.latestRecoveryCode(account.accountId);
    if (!recoveryCode || recoveryCode.consumedAt !== null || recoveryCode.attemptCount >= MAX_PARENT_MFA_RECOVERY_ATTEMPTS_PER_CODE || recoveryCode.expiresAt.getTime() <= now.getTime()) {
      throw new ParentAccountError('UNAUTHORIZED');
    }
    if (!verificationCodeHashesMatch(hashVerificationCode(code), recoveryCode.codeHash)) {
      await this.mfa.incrementRecoveryAttempt(recoveryCode.codeId);
      throw new ParentAccountError('UNAUTHORIZED');
    }
    let result: Awaited<ReturnType<ParentMfaService['applyRecoveryCode']>>;
    try {
      result = await this.mfa.applyRecoveryCode({
        codeId: recoveryCode.codeId,
        accountId: account.accountId,
        serviceAccountId: account.serviceAccountId,
        now,
        holdExpiresAt: new Date(now.getTime() + PARENT_MFA_RECOVERY_HOLD_MS),
      });
    } catch {
      throw new ParentAccountError('UNAUTHORIZED');
    }
    // Keep the test repository and the historical repository contract aligned;
    // MySQL repeats these idempotent revocations inside the hold transaction.
    await this.repository.revokeAllDailyLoginGrants(account.accountId, now);
    if (account.serviceAccountId !== null) await this.repository.revokeAllServiceSessionsFor(account.serviceAccountId, now);
    if (result.status === 'PENDING') {
      if (result.started) await this.notify(email, 'MFA_RECOVERY_PENDING', `mfa-recovery-pending:${account.accountId}:${now.getTime()}`);
      return { status: 'MFA_RECOVERY_PENDING', recoveryAvailableAt: result.recoveryAvailableAt };
    }
    await this.notify(email, 'MFA_RESET', `mfa-reset:${account.accountId}:${now.getTime()}`);
    return { status: 'MFA_SETUP_REQUIRED', rawEnrollmentTicket: await this.mfa.issueTicket(account.accountId, 'MFA_RECOVERY') };
  }

  /**
   * COMMERCIAL_OWNER_AUTHORITY = FAMILY ADMINISTRATOR + FRESH TOTP STEP-UP.
   * Requires a live session, the ACTIVE ADMINISTRATOR membership of the
   * session's own family, an ACTIVE authenticator, and a TOTP code whose
   * counter is newer than any accepted before (so the login code can never be
   * reused). Yields one single-use grant for one operation, briefly.
   */
  async issueCommercialStepUp(rawSessionToken: string, operation: CommercialStepUpOperation, code: string): Promise<{ stepUpToken: string; expiresAt: Date }> {
    const { account, posture } = await this.resolveUsableSession(rawSessionToken);
    if (account.familyId === null) throw new ParentAccountError('FORBIDDEN');
    const role = await this.resolveFamilyRole(account.accountId, account.familyId);
    if (role !== 'ADMINISTRATOR') throw new ParentAccountError('FORBIDDEN');
    if (posture.status !== 'ACTIVE') throw new ParentAccountError('FORBIDDEN');
    try {
      const grant = await this.mfa.issueCommercialStepUp(account.accountId, account.familyId, operation, code);
      if ((await this.mfa.posture(account.accountId)).status !== 'ACTIVE') {
        await this.mfa.consumeCommercialStepUp(account.accountId, account.familyId, operation, grant.stepUpToken);
        throw new ParentAccountError('UNAUTHORIZED');
      }
      return grant;
    } catch (error) {
      throw mapMfaError(error);
    }
  }

  /** Reads a live session and its MFA posture, refusing any session that must not be usable (see readSession). */
  private async resolveUsableSession(rawSessionToken: string): Promise<{ account: ParentAccountRecord; serviceAccountId: string; posture: ParentMfaPosture }> {
    const { account, serviceAccountId } = await this.resolveAuthenticatedParent(rawSessionToken);
    const posture = await this.mfa.posture(account.accountId);
    if (posture.status === 'NOT_STARTED' || posture.status === 'SETUP_REQUIRED' || posture.status === 'RECOVERY_PENDING') throw new ParentAccountError('UNAUTHORIZED');
    return { account, serviceAccountId, posture };
  }

  private async resolveEnrollmentAccount(credential: EnrollmentCredential): Promise<{ account: ParentAccountRecord; ticketId: string | null }> {
    if (credential.kind === 'SESSION') {
      const { account } = await this.resolveUsableSession(credential.rawSessionToken);
      return { account, ticketId: null };
    }
    const ticket = await this.mfa.resolveTicket(credential.rawTicket);
    if (!ticket) throw new ParentAccountError('UNAUTHORIZED');
    const account = await this.repository.findById(ticket.accountId);
    if (!account || account.status !== 'VERIFIED' || account.disabledAt !== null) throw new ParentAccountError('UNAUTHORIZED');
    return { account, ticketId: ticket.ticketId };
  }

  private assertEmail(account: ParentAccountRecord, email: string): void {
    if (!isPlausibleEmail(email)) throw new ParentAccountError('UNAUTHORIZED');
    const supplied = hashParentEmail(email);
    if (supplied.length !== account.emailHash.length || !timingSafeEqual(supplied, account.emailHash)) throw new ParentAccountError('UNAUTHORIZED');
  }

  private async assertEmailAndPassword(account: ParentAccountRecord, email: string, password: string): Promise<void> {
    this.assertEmail(account, email);
    if (typeof password !== 'string' || !(await verifyPassword(password, account.passwordHash))) throw new ParentAccountError('UNAUTHORIZED');
  }

  private async findVerifiedAccountWithPassword(email: string, password: string): Promise<ParentAccountRecord> {
    const account = await this.repository.findByEmailHash(hashParentEmail(email));
    if (!account || account.status !== 'VERIFIED' || account.disabledAt !== null) {
      // Hash against a dummy value so unknown-email and wrong-password take roughly the same time.
      await verifyPassword(password, DUMMY_PASSWORD_HASH);
      throw new ParentAccountError('UNAUTHORIZED');
    }
    if (!(await verifyPassword(password, account.passwordHash))) throw new ParentAccountError('UNAUTHORIZED');
    return account;
  }

  private async verifyTotpOrThrow(accountId: ParentAccountId, code: string): Promise<void> {
    try {
      await this.mfa.verifyActiveCode(accountId, code, 'MFA_LOGIN_FAILED');
    } catch (error) {
      throw mapMfaError(error);
    }
  }

  /** Security notices are best-effort: delivery trouble never changes the outcome the caller sees. */
  private async notify(email: string, notice: ParentSecurityNotice, eventId: string): Promise<void> {
    try {
      await this.emailSender.sendSecurityNotice(email, notice, this.now(), eventId);
    } catch {
      // deliberately swallowed
    }
  }

  private async resolveAuthenticatedParent(rawSessionToken: string) {
    let session;
    try {
      session = await this.authService.validateSessionRecord(rawSessionToken);
    } catch {
      throw new ParentAccountError('UNAUTHORIZED');
    }
    const serviceAccountId = session.accountId;
    const account = await this.repository.findByServiceAccountId(serviceAccountId);
    if (!account || account.status !== 'VERIFIED' || account.disabledAt !== null) throw new ParentAccountError('UNAUTHORIZED');
    return { account, serviceAccountId, session };
  }

  private async resolveFamilyRole(accountId: ParentAccountId, familyId: OpaqueFamilyId | null): Promise<FamilyMembershipRole | null> {
    // Null is an explicit fail-closed role result; the Parent Web client
    // refuses an elevated session unless this is a valid normal role.
    if (!familyId || !this.familyMembershipRepository) return null;
    return this.familyMembershipRepository.findActiveRole(accountId, familyId);
  }

  /** Idempotent: revoking an unknown/malformed/already-revoked token is never an error. */
  async logout(rawSessionToken: string, rawDailyLoginGrantToken?: string): Promise<void> {
    let accountId: ParentAccountId | null = null;
    try {
      const session = await this.authService.validateSessionRecord(rawSessionToken);
      const account = await this.repository.findByServiceAccountId(session.accountId);
      if (account) accountId = account.accountId;
    } catch {
      // Logout remains idempotent for malformed, expired, or already-revoked sessions.
    }
    try {
      await this.authService.revokeSession(rawSessionToken);
    } catch {
      // A malformed token -- logout is still a success from the caller's perspective.
    }
    if (accountId && isPlausibleDailyLoginGrant(rawDailyLoginGrantToken)) {
      await this.repository.revokeDailyLoginGrant(accountId, hashDailyLoginGrant(rawDailyLoginGrantToken), this.now());
    }
  }

  /** Requires an already-valid current session; revokes every session for that service account. */
  async revokeAllSessions(rawSessionToken: string): Promise<void> {
    let serviceAccountId: string;
    try {
      serviceAccountId = await this.authService.validateSession(rawSessionToken);
    } catch {
      throw new ParentAccountError('UNAUTHORIZED');
    }
    const account = await this.repository.findByServiceAccountId(serviceAccountId);
    if (!account) throw new ParentAccountError('UNAUTHORIZED');
    const revokedAt = this.now();
    await this.repository.revokeAllServiceSessionsFor(serviceAccountId, revokedAt);
    await this.repository.revokeAllDailyLoginGrants(account.accountId, revokedAt);
  }

  /**
   * Account-level password reset, distinct from the family-E2EE Recovery
   * flow. Response is IDENTICAL whether the email matches no account, an
   * unverified account, or a disabled account -- never an enumeration oracle.
   */
  async requestPasswordReset(email: string): Promise<RequestPasswordResetOutcome> {
    if (!isPlausibleEmail(email)) throw new ParentAccountError('INVALID_INPUT');
    const account = await this.repository.findByEmailHash(hashParentEmail(email));
    if (account && account.status === 'VERIFIED' && account.disabledAt === null) {
      await this.issueAndSendPasswordResetCode(account.accountId, email);
    }
    return { status: 'RESET_CODE_SENT_IF_ACCOUNT_EXISTS' };
  }

  private async issueAndSendPasswordResetCode(accountId: ParentAccountId, email: string): Promise<void> {
    const now = this.now();
    const { code, codeHash } = generateVerificationCode();
    await this.repository.insertPasswordResetCode({
      codeId: randomUUID(),
      accountId,
      codeHash,
      createdAt: now,
      expiresAt: new Date(now.getTime() + PASSWORD_RESET_CODE_TTL_MS),
    });
    try {
      await this.emailSender.sendPasswordResetCode(email, code);
    } catch {
      // deliberately swallowed
    }
  }

  /**
   * Consumes a password-reset code and replaces the credential. Never issues
   * a session, and revokes every existing session and browser grant. The
   * authenticator is NOT touched: a reset password still needs the TOTP code
   * at the next login.
   */
  async resetPassword(email: string, code: string, newPassword: string, newPasswordConfirmation: string): Promise<ResetPasswordOutcome> {
    if (
      !isPlausibleEmail(email) ||
      !isPlausibleVerificationCode(code) ||
      !isPlausiblePassword(newPassword) ||
      newPassword !== newPasswordConfirmation
    ) {
      throw new ParentAccountError('INVALID_INPUT');
    }
    const account = await this.repository.findByEmailHash(hashParentEmail(email));
    if (!account || account.status !== 'VERIFIED' || account.disabledAt !== null) throw new ParentAccountError('UNAUTHORIZED');
    if ((await this.mfa.posture(account.accountId)).status === 'RECOVERY_PENDING') throw new ParentAccountError('UNAUTHORIZED');

    const activeCode = await this.repository.findLatestPasswordResetCode(account.accountId);
    if (!activeCode || activeCode.consumedAt !== null) throw new ParentAccountError('UNAUTHORIZED');
    if (activeCode.attemptCount >= MAX_PASSWORD_RESET_ATTEMPTS_PER_CODE) throw new ParentAccountError('UNAUTHORIZED');
    if (activeCode.expiresAt.getTime() <= this.now().getTime()) throw new ParentAccountError('UNAUTHORIZED');

    await this.repository.incrementPasswordResetAttempt(activeCode.codeId);
    if (!verificationCodeHashesMatch(hashVerificationCode(code), activeCode.codeHash)) throw new ParentAccountError('UNAUTHORIZED');

    const won = await this.repository.consumePasswordResetCodeIfUnconsumed(activeCode.codeId, this.now());
    if (!won) throw new ParentAccountError('UNAUTHORIZED'); // lost a concurrent reset race for the same code

    // Revoke browser grants before changing the credential; fail closed if that cannot be persisted.
    const revokedAt = this.now();
    await this.repository.revokeAllDailyLoginGrants(account.accountId, revokedAt);
    await this.repository.updatePasswordHash(account.accountId, await hashPassword(newPassword));
    if (account.serviceAccountId !== null) {
      await this.repository.revokeAllServiceSessionsFor(account.serviceAccountId, revokedAt);
    }
    return { status: 'PASSWORD_RESET' };
  }
}

function summarize(posture: ParentMfaPosture): ParentMfaSummary {
  if (posture.status === 'ACTIVE') return { status: 'ACTIVE' };
  if (posture.status === 'GRACE') return { status: 'GRACE', graceExpiresAt: posture.graceExpiresAt };
  if (posture.status === 'SETUP_REQUIRED') return { status: 'SETUP_REQUIRED', graceExpiresAt: posture.graceExpiresAt };
  if (posture.status === 'RECOVERY_PENDING') return { status: 'RECOVERY_PENDING', recoveryAvailableAt: posture.recoveryAvailableAt };
  throw new ParentAccountError('UNAUTHORIZED');
}

function mapMfaError(error: unknown): unknown {
  if (!(error instanceof ParentMfaError)) return error;
  if (error.code === 'LOCKED') return new ParentAccountError('MFA_LOCKED');
  if (error.code === 'INVALID_CODE') return new ParentAccountError('MFA_INVALID');
  return new ParentAccountError('UNAUTHORIZED');
}

function accountReferenceHashFor(accountId: ParentAccountId): Buffer {
  return createHash('sha256').update(accountId, 'utf8').digest();
}

function isDuplicateEntryLike(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'ER_DUP_ENTRY';
}
