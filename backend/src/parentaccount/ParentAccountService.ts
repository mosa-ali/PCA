import { randomUUID, createHash } from 'node:crypto';
import type { AuthService } from '../auth/AuthService.js';
import type { OpaqueFamilyId } from '../familytrustset/types.js';
import { hashParentEmail, isPlausibleEmail } from './emailHash.js';
import { hashPassword, isPlausiblePassword, verifyPassword } from './passwordCredential.js';
import { generateVerificationCode, hashVerificationCode, isPlausibleVerificationCode, verificationCodeHashesMatch } from './verificationCode.js';
import {
  MAX_LOGIN_STEP_UP_ATTEMPTS_PER_CODE,
  MAX_PASSWORD_RESET_ATTEMPTS_PER_CODE,
  MAX_VERIFICATION_ATTEMPTS_PER_CODE,
  LOGIN_STEP_UP_CODE_TTL_MS,
  PASSWORD_RESET_CODE_TTL_MS,
  VERIFICATION_CODE_TTL_MS,
  computeFreeAccessExpiry,
  resolveFreeAccessDefaults,
} from './policy.js';
import type { ParentAccountRepository } from './ParentAccountRepository.js';
import type { FamilyMembershipRepository, FamilyMembershipRole } from '../familymembers/FamilyMembershipRepository.js';
import type { EmailSenderPort } from './EmailSenderPort.js';
import type {
  CompleteLoginStepUpOutcome,
  LoginOutcome,
  ParentAccountId,
  RegisterOutcome,
  RequestPasswordResetOutcome,
  ResetPasswordOutcome,
  SessionReadOutcome,
  VerifyEmailOutcome,
  ParentSignupProfile,
} from './types.js';
import type { ParentGenesisService, BeginParentGenesisInput, CompleteParentGenesisInput } from './ParentGenesisService.js';

export type ParentAccountErrorCode = 'INVALID_INPUT' | 'UNAUTHORIZED' | 'RATE_LIMITED';

/**
 * Deliberately ONE generic code/message per failure category -- mirrors
 * AuthService.AuthError/PlatformAdminAuthService.PlatformAdminAuthError
 * exactly. UNAUTHORIZED covers every login/verify-email failure mode
 * (unknown email, wrong password, unverified account, wrong/expired/
 * already-consumed code) -- the caller can never distinguish which.
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
  /** Active family-role persistence. Missing/unresolved membership fails closed. */
  familyMembershipRepository?: FamilyMembershipRepository;
  /** Explicit client-key genesis ceremony; omitted only by test compositions that do not expose genesis routes. */
  parentGenesisService?: ParentGenesisService;
  now?: () => Date;
}

/**
 * Orchestrates PCA-DEC-026's self-service registration/verification/login
 * flow. Deliberately delegates ALL session token issuance/validation/
 * single-token revocation to the EXISTING, unmodified
 * backend/src/auth/AuthService -- see PCA_IMPL_DECISION_003's "no new
 * session-issuance contract is invented at the AuthService layer; a new
 * identity-producing step is added upstream of it." accountReferenceHash is
 * always sha256(this domain's own accountId), never derived from email or
 * password.
 */
export class ParentAccountService {
  private readonly repository: ParentAccountRepository;
  private readonly authService: AuthService;
  private readonly emailSender: EmailSenderPort;
  private readonly familyMembershipRepository: FamilyMembershipRepository | undefined;
  private readonly parentGenesisService: ParentGenesisService | undefined;
  private readonly now: () => Date;

  constructor(deps: ParentAccountServiceDeps) {
    this.repository = deps.repository;
    this.authService = deps.authService;
    this.emailSender = deps.emailSender;
    // Test-only in-memory repositories may implement the membership port on
    // the same object. Production must pass the explicit durable repository;
    // an absent resolver still fails closed in requireFamilyRole().
    this.familyMembershipRepository = deps.familyMembershipRepository ??
      (typeof (deps.repository as ParentAccountRepository & { findActiveRole?: unknown }).findActiveRole === 'function'
        ? (deps.repository as unknown as FamilyMembershipRepository)
        : undefined);
    this.parentGenesisService = deps.parentGenesisService;
    this.now = deps.now ?? (() => new Date());
  }

  /**
   * PCA-ADD-IDENT-004: the server never trusts a client-asserted
   * password===passwordConfirmation match beyond re-checking it itself.
   * Response is IDENTICAL ({status:'PENDING_VERIFICATION'}) whether the
   * email was new, already PENDING_VERIFICATION (resend), or already
   * VERIFIED (silent no-op) -- never an enumeration oracle.
   *
   * PENDING_VERIFICATION CREDENTIAL BINDING (security fix, migration 0030):
   * a registration for an email that ALREADY has a still-unverified account
   * no longer writes that account's credential at all. It used to call
   * `updatePendingPasswordHash`, which meant any unauthenticated caller
   * could overwrite a pending account's stored password hash with their own
   * while the fresh code was still delivered to the real mailbox owner --
   * the owner's own verification then activated the account carrying the
   * OTHER party's password. Note that neither "last registration wins" (the
   * old rule) nor "first registration wins" fixes this: whichever party the
   * rule favours can simply register in that position. Instead each
   * registration issues its OWN verification code carrying its OWN
   * credential, previously-issued codes stay independently redeemable (see
   * verifyEmail), and the account's credential is written exactly once, by
   * whichever code is actually redeemed.
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
        // fall through to the identical PENDING_VERIFICATION response,
        // never surfacing the race as a distinguishable error.
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
    // Best-effort: a TEST_SANDBOX/logging failure must never distinguish
    // this response from any other branch's identical response.
    try {
      await this.emailSender.sendVerificationCode(email, code);
    } catch {
      // deliberately swallowed -- see this method's own doc comment.
    }
  }

  /**
   * Redeems ONE of the account's still-live verification codes and applies
   * THAT code's own bound credential (migration 0030) as it marks the
   * account VERIFIED.
   *
   * Every code the account has been issued that is still live (unconsumed,
   * unexpired, under its own attempt budget) is a candidate, not merely the
   * most recent one. That is what makes register()'s credential binding an
   * actual fix rather than a rename: with a single-newest-code lookup, a
   * hostile re-registration silently invalidates the code the real mailbox
   * owner is holding, leaving them with only the attacker's freshly-issued
   * code to redeem -- exactly the takeover this is meant to close.
   *
   * The total guess budget is UNCHANGED, not widened: one submitted code
   * costs one attempt against EVERY live candidate (the increment happens
   * before any comparison, exactly as before), so at most
   * MAX_VERIFICATION_ATTEMPTS_PER_CODE guesses can ever be made against the
   * account's live set no matter how many codes it contains. TTL, the
   * single-use compare-and-swap, the timing-safe comparison, and the single
   * generic UNAUTHORIZED for every failure mode are all preserved exactly.
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
    // PCA-DEC-020-R1: email verification establishes account identity only.
    // It must never generate or silently authorize a cryptographic first
    // device. Family genesis is now a separate client-key challenge ceremony
    // whose source protocol lives in genesisProtocol.ts; until that ceremony
    // completes, the account remains deliberately family-scoped-null.
    const familyId: OpaqueFamilyId | null = null;
    const defaults = resolveFreeAccessDefaults();
    const expiresAt = computeFreeAccessExpiry(now, defaults);

    await this.repository.markVerified({
      accountId: account.accountId,
      verifiedAt: now,
      familyId,
      // The redeemed code's OWN credential -- the single point at which a
      // pending account's password is ever written. Null only for a
      // pre-migration-0030 row, which leaves it unchanged.
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

    const issued = await this.issueSessionFor(account.accountId);
    const role = null;
    return { accountId: account.accountId, familyId, rawSessionToken: issued.rawToken, sessionExpiresAt: issued.session.expiresAt, role };
  }

  /** PCA-ADD-IDENT-012: only succeeds against a VERIFIED account; generic failure for every other case (unknown email, wrong password, unverified). */
  async login(email: string, password: string): Promise<LoginOutcome> {
    if (!isPlausibleEmail(email) || typeof password !== 'string' || password.length === 0) {
      throw new ParentAccountError('INVALID_INPUT');
    }
    const emailHash = hashParentEmail(email);
    const account = await this.repository.findByEmailHash(emailHash);
    if (!account || account.status !== 'VERIFIED' || account.disabledAt !== null) {
      // Still hash against a dummy value so the two branches (unknown
      // email vs. wrong password) take roughly the same time.
      await verifyPassword(password, DUMMY_PASSWORD_HASH);
      throw new ParentAccountError('UNAUTHORIZED');
    }
    const ok = await verifyPassword(password, account.passwordHash);
    if (!ok) throw new ParentAccountError('UNAUTHORIZED');

    // PCA-ADD-PA-017 enforcement (Writer73): a Platform Admin-suspended
    // family (families.status='SUSPENDED', see
    // platformadmin/accounts/FamilyAccountStatusService.ts) must not be
    // able to sign in and reach the family's data -- generic UNAUTHORIZED,
    // identical to every other login failure mode, so a suspension can
    // never be distinguished from a wrong password by the caller. An
    // account with no familyId yet (genesis never completed) has nothing to
    // suspend and always passes this check.
    if (account.familyId !== null) {
      const familyStatus = await this.repository.findFamilyStatus(account.familyId);
      if (familyStatus === 'SUSPENDED') throw new ParentAccountError('UNAUTHORIZED');
    }

    const role = await this.resolveFamilyRole(account.accountId, account.familyId);

    // Owner authentication-architecture decision (2026-09-15): normal users
    // get password + risk-based email step-up, never Platform Admin-style
    // TOTP. The one risk trigger implemented for the current release is
    // "this account has never completed an authenticated session" -- see
    // ParentAccountRecord.firstLoginCompletedAt's own doc comment for why
    // this is already false (step-up already satisfied) for every account
    // that has ever verified its email, the overwhelming common case.
    if (account.firstLoginCompletedAt === null) {
      await this.issueAndSendLoginStepUpCode(account.accountId, email);
      return { status: 'STEP_UP_REQUIRED' };
    }

    const issued = await this.issueSessionFor(account.accountId);
    return {
      status: 'AUTHENTICATED',
      accountId: account.accountId,
      familyId: account.familyId,
      rawSessionToken: issued.rawToken,
      sessionExpiresAt: issued.session.expiresAt,
      role,
    };
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
    // Best-effort: see issueAndSendVerificationCode's own doc comment -- the same reasoning applies unchanged.
    try {
      await this.emailSender.sendLoginStepUpCode(email, code);
    } catch {
      // deliberately swallowed
    }
  }

  /**
   * Consumes a login-step-up code and, on success, issues the real session
   * password verification alone was not enough to grant. Marks the
   * account's first-login requirement permanently satisfied (idempotent,
   * only writes if still null) so every later login proceeds directly,
   * matching the "risk-aware, not on every routine login" model.
   */
  async completeLoginStepUp(email: string, code: string): Promise<CompleteLoginStepUpOutcome> {
    if (!isPlausibleEmail(email) || !isPlausibleVerificationCode(code)) {
      throw new ParentAccountError('INVALID_INPUT');
    }
    const emailHash = hashParentEmail(email);
    const account = await this.repository.findByEmailHash(emailHash);
    if (!account || account.status !== 'VERIFIED' || account.disabledAt !== null) throw new ParentAccountError('UNAUTHORIZED');

    const activeCode = await this.repository.findLatestLoginStepUpCode(account.accountId);
    if (!activeCode || activeCode.consumedAt !== null) throw new ParentAccountError('UNAUTHORIZED');
    if (activeCode.attemptCount >= MAX_LOGIN_STEP_UP_ATTEMPTS_PER_CODE) throw new ParentAccountError('UNAUTHORIZED');
    if (activeCode.expiresAt.getTime() <= this.now().getTime()) throw new ParentAccountError('UNAUTHORIZED');

    await this.repository.incrementLoginStepUpAttempt(activeCode.codeId);
    const candidateHash = hashVerificationCode(code);
    if (!verificationCodeHashesMatch(candidateHash, activeCode.codeHash)) throw new ParentAccountError('UNAUTHORIZED');

    const won = await this.repository.consumeLoginStepUpCodeIfUnconsumed(activeCode.codeId, this.now());
    if (!won) throw new ParentAccountError('UNAUTHORIZED'); // lost a concurrent completion race for the same code

    await this.repository.markFirstLoginCompletedIfAbsent(account.accountId, this.now());
    const issued = await this.issueSessionFor(account.accountId);
    const role = await this.resolveFamilyRole(account.accountId, account.familyId);
    return { accountId: account.accountId, familyId: account.familyId, rawSessionToken: issued.rawToken, sessionExpiresAt: issued.session.expiresAt, role };
  }

  private async issueSessionFor(accountId: ParentAccountId) {
    const identity = { accountReferenceHash: accountReferenceHashFor(accountId) };
    const issued = await this.authService.issueSession(identity);
    await this.repository.setServiceAccountIdIfAbsent(accountId, issued.session.accountId);
    return issued;
  }

  /** GET /api/parent/session -- reads current session state without re-verifying credentials. Fails closed (UNAUTHORIZED) identically for missing/malformed/expired/revoked cookie, disabled account, or an orphaned service-session lookup. */
  async readSession(rawSessionToken: string): Promise<SessionReadOutcome> {
    const { account } = await this.resolveAuthenticatedParent(rawSessionToken);
    const role = await this.resolveFamilyRole(account.accountId, account.familyId);
    return { accountId: account.accountId, familyId: account.familyId, emailVerified: true, role };
  }

  /** Starts the explicit client-key family genesis ceremony for an authenticated account. */
  async beginGenesisChallenge(rawSessionToken: string, input: Omit<BeginParentGenesisInput, 'accountId' | 'serviceAccountId'>) {
    if (!this.parentGenesisService) throw new ParentAccountError('UNAUTHORIZED');
    const { account, serviceAccountId } = await this.resolveAuthenticatedParent(rawSessionToken);
    if (account.familyId !== null || account.serviceAccountId !== serviceAccountId) throw new ParentAccountError('UNAUTHORIZED');
    return this.parentGenesisService.begin({ ...input, accountId: account.accountId, serviceAccountId });
  }

  /** Completes genesis only when the challenge and authenticated session identify the same account. */
  async completeGenesis(rawSessionToken: string, input: CompleteParentGenesisInput) {
    if (!this.parentGenesisService) throw new ParentAccountError('UNAUTHORIZED');
    const { account, serviceAccountId } = await this.resolveAuthenticatedParent(rawSessionToken);
    if (account.familyId !== null || account.serviceAccountId !== serviceAccountId) throw new ParentAccountError('UNAUTHORIZED');
    return this.parentGenesisService.complete(input, { accountId: account.accountId, serviceAccountId });
  }

  private async resolveAuthenticatedParent(rawSessionToken: string) {
    let serviceAccountId: string;
    try {
      serviceAccountId = await this.authService.validateSession(rawSessionToken);
    } catch {
      throw new ParentAccountError('UNAUTHORIZED');
    }
    const account = await this.repository.findByServiceAccountId(serviceAccountId);
    if (!account || account.status !== 'VERIFIED' || account.disabledAt !== null) throw new ParentAccountError('UNAUTHORIZED');
    return { account, serviceAccountId };
  }

  private async resolveFamilyRole(accountId: ParentAccountId, familyId: OpaqueFamilyId | null): Promise<FamilyMembershipRole | null> {
    // Null is an explicit fail-closed role result. Identity/session state is
    // not promoted to a family role when genesis or membership resolution is
    // unavailable; the Parent Web client refuses to establish an elevated
    // session unless this field contains a valid normal role.
    if (!familyId || !this.familyMembershipRepository) return null;
    return this.familyMembershipRepository.findActiveRole(accountId, familyId);
  }

  /** Idempotent: revoking an unknown/malformed/already-revoked token is never an error. */
  async logout(rawSessionToken: string): Promise<void> {
    try {
      await this.authService.revokeSession(rawSessionToken);
    } catch {
      // AuthError from a malformed token -- logout is still a success from the caller's perspective (fail closed on the READ side, not here).
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
    await this.repository.revokeAllServiceSessionsFor(serviceAccountId, this.now());
  }

  /**
   * PCA product-completion programme (P1 /login finding): account-level
   * password reset, distinct from the family-E2EE Recovery flow. Response
   * is IDENTICAL whether the email matches no account, an unverified
   * account, or a disabled account -- never an enumeration oracle, same
   * posture as register().
   */
  async requestPasswordReset(email: string): Promise<RequestPasswordResetOutcome> {
    if (!isPlausibleEmail(email)) throw new ParentAccountError('INVALID_INPUT');
    const emailHash = hashParentEmail(email);
    const account = await this.repository.findByEmailHash(emailHash);
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
    // Best-effort: see issueAndSendVerificationCode's own doc comment -- the
    // same reasoning applies unchanged.
    try {
      await this.emailSender.sendPasswordResetCode(email, code);
    } catch {
      // deliberately swallowed
    }
  }

  /**
   * Consumes a password-reset code and replaces the account's credential.
   * Deliberately does NOT auto-issue a new session afterward (unlike
   * verifyEmail) -- the family must sign in fresh with the new password,
   * a deliberately more conservative choice than treating "proved control
   * of the reset code" as equivalent to "proved control of the account for
   * session-issuance purposes." Every existing session for the account is
   * revoked on success, so a previously-stolen session cannot outlive a
   * password reset.
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
    const emailHash = hashParentEmail(email);
    const account = await this.repository.findByEmailHash(emailHash);
    if (!account || account.status !== 'VERIFIED' || account.disabledAt !== null) throw new ParentAccountError('UNAUTHORIZED');

    const activeCode = await this.repository.findLatestPasswordResetCode(account.accountId);
    if (!activeCode || activeCode.consumedAt !== null) throw new ParentAccountError('UNAUTHORIZED');
    if (activeCode.attemptCount >= MAX_PASSWORD_RESET_ATTEMPTS_PER_CODE) throw new ParentAccountError('UNAUTHORIZED');
    if (activeCode.expiresAt.getTime() <= this.now().getTime()) throw new ParentAccountError('UNAUTHORIZED');

    await this.repository.incrementPasswordResetAttempt(activeCode.codeId);
    const candidateHash = hashVerificationCode(code);
    if (!verificationCodeHashesMatch(candidateHash, activeCode.codeHash)) throw new ParentAccountError('UNAUTHORIZED');

    const won = await this.repository.consumePasswordResetCodeIfUnconsumed(activeCode.codeId, this.now());
    if (!won) throw new ParentAccountError('UNAUTHORIZED'); // lost a concurrent reset race for the same code

    const newPasswordHash = await hashPassword(newPassword);
    await this.repository.updatePasswordHash(account.accountId, newPasswordHash);

    if (account.serviceAccountId !== null) {
      await this.repository.revokeAllServiceSessionsFor(account.serviceAccountId, this.now());
    }

    return { status: 'PASSWORD_RESET' };
  }
}

function accountReferenceHashFor(accountId: ParentAccountId): Buffer {
  return createHash('sha256').update(accountId, 'utf8').digest();
}

function isDuplicateEntryLike(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'ER_DUP_ENTRY';
}

// A fixed, never-matching scrypt-shaped credential used only to keep
// login()'s "unknown account" branch's timing in the same ballpark as its
// "wrong password" branch -- never a real account's hash.
const DUMMY_PASSWORD_HASH = `scrypt$32768$8$1$${'00'.repeat(16)}$${'00'.repeat(64)}`;
