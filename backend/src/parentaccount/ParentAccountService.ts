import { randomUUID, createHash } from 'node:crypto';
import type { AuthService } from '../auth/AuthService.js';
import type { OpaqueFamilyId, OpaqueDeviceId } from '../familytrustset/types.js';
import type { FamilyOwnerAttestationChainEngine } from '../familycommercial/authority/FamilyOwnerAttestationChainEngine.js';
import { canonicalizeGenesisAnchor, canonicalizeOwnerAttestation } from '../familycommercial/authority/canonicalize.js';
import { FAMILY_AUTHORITY_PROTOCOL_VERSION, OWNER_ATTESTATION_DOMAIN } from '../familycommercial/authority/types.js';
import type { FamilyAuthorityGenesisAnchor, FamilyOwnerAttestation } from '../familycommercial/authority/types.js';
import { generateEphemeralGenesisDeviceKeyPair, signWithGenesisDeviceKey } from './genesisDeviceSigner.js';
import { hashParentEmail, isPlausibleEmail } from './emailHash.js';
import { hashPassword, isPlausiblePassword, verifyPassword } from './passwordCredential.js';
import { generateVerificationCode, hashVerificationCode, isPlausibleVerificationCode, verificationCodeHashesMatch } from './verificationCode.js';
import {
  MAX_PASSWORD_RESET_ATTEMPTS_PER_CODE,
  MAX_VERIFICATION_ATTEMPTS_PER_CODE,
  PASSWORD_RESET_CODE_TTL_MS,
  VERIFICATION_CODE_TTL_MS,
  computeFreeAccessExpiry,
  resolveFreeAccessDefaults,
} from './policy.js';
import type { ParentAccountRepository } from './ParentAccountRepository.js';
import type { EmailSenderPort } from './EmailSenderPort.js';
import type {
  LoginOutcome,
  ParentAccountId,
  RegisterOutcome,
  RequestPasswordResetOutcome,
  ResetPasswordOutcome,
  SessionReadOutcome,
  VerifyEmailOutcome,
} from './types.js';

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

const GENESIS_DEVICE_ATTESTATION_TTL_MS = 24 * 60 * 60 * 1000; // 24h -- comfortably inside FamilyOwnerAttestationChainEngine's sane-TTL bounds

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
  /**
   * Injected so production (Coordinator-wired, see main.ts's own existing
   * FamilyOwnerAttestationChainEngine construction) and tests can supply
   * different DeviceSignatureVerifier policies -- this service never
   * constructs its own engine instance. `undefined` means "genesis
   * capability not wired" (treated identically to a genesis attempt that
   * returns INVALID_PROOF/AUTHORITY_UNAVAILABLE: identity/session issuance
   * still succeeds, familyId is simply null).
   */
  familyGenesisEngine?: FamilyOwnerAttestationChainEngine;
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
  private readonly familyGenesisEngine: FamilyOwnerAttestationChainEngine | undefined;
  private readonly now: () => Date;

  constructor(deps: ParentAccountServiceDeps) {
    this.repository = deps.repository;
    this.authService = deps.authService;
    this.emailSender = deps.emailSender;
    this.familyGenesisEngine = deps.familyGenesisEngine;
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
  async register(email: string, password: string, passwordConfirmation: string): Promise<RegisterOutcome> {
    if (!isPlausibleEmail(email) || !isPlausiblePassword(password) || password !== passwordConfirmation) {
      throw new ParentAccountError('INVALID_INPUT');
    }
    const emailHash = hashParentEmail(email);
    const existing = await this.repository.findByEmailHash(emailHash);
    const passwordHash = await hashPassword(password);
    const now = this.now();

    if (existing === null) {
      const accountId = randomUUID();
      try {
        await this.repository.createPendingAccount({ accountId, emailHash, passwordHash, createdAt: now });
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
    const familyId = await this.attemptFamilyGenesis(account.accountId, now);
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
    if (familyId !== null) {
      // PCA-DEC-026: a freshly genesis-anchored Family Owner must actually
      // be able to reach their own family's commercial data through the
      // EXISTING, unmodified familyCommercialRoutes.ts/
      // billingCheckoutRoutes.ts, both of which require an ACTIVE
      // service_account_family_scopes row before anything else runs -- see
      // ParentAccountRepository.grantFamilyScopeIfAbsent's own doc comment.
      await this.repository.grantFamilyScopeIfAbsent(issued.session.accountId, familyId, now);
      // Without this, Platform Administration's dashboards/account list/
      // suspend flow (platformadmin/accounts/**) can never see or act on a
      // family that only ever exists via self-service registration -- see
      // ParentAccountRepository.createFamilyIfAbsent's own doc comment.
      await this.repository.createFamilyIfAbsent(familyId, now);
    }
    return { accountId: account.accountId, familyId, rawSessionToken: issued.rawToken, sessionExpiresAt: issued.session.expiresAt };
  }

  /**
   * PCA-ADD-IDENT-009: every fresh verification creates its OWN new family
   * (this self-service flow has no "join an existing family" path --
   * PCA-ADD-IDENT-011 -- so every verified account is, by construction, the
   * first-and-only verified parent of a brand-new family). Best-effort:
   * genesis is a bounded external capability (see genesisDeviceSigner.ts's
   * header) -- a rejected/unavailable signature verifier degrades to
   * familyId=null, never blocks identity verification or session issuance.
   */
  private async attemptFamilyGenesis(accountId: ParentAccountId, now: Date): Promise<OpaqueFamilyId | null> {
    if (!this.familyGenesisEngine) return null;
    const familyId: OpaqueFamilyId = randomUUID();
    // Plain UUIDs, matching every other genesis_device_id/genesis_dsk_key_id
    // value's real schema column (migration 0011: CHAR(36) CHARACTER SET
    // ascii) exactly, like every other device id in this codebase -- a
    // prefixed "web-registration:<accountId>" string (54+ chars) does not
    // fit that column and previously made this path fail with a genuine
    // MySQL ER_DATA_TOO_LONG error the first time it ever ran against real
    // MySQL (caught running the disposable-database seed for this session's
    // local validation, not previously exercised against a real database).
    const genesisDeviceId: OpaqueDeviceId = randomUUID();
    const { publicKeyBase64, privateKey } = generateEphemeralGenesisDeviceKeyPair();
    const genesisDskKeyId = randomUUID();

    const anchorWithoutSignature: Omit<FamilyAuthorityGenesisAnchor, 'signature'> = {
      familyId,
      genesisDeviceId,
      genesisDskKeyId,
      genesisDskPublicKey: publicKeyBase64,
      protocolVersion: FAMILY_AUTHORITY_PROTOCOL_VERSION,
      createdAt: now,
    };
    const anchor: FamilyAuthorityGenesisAnchor = {
      ...anchorWithoutSignature,
      signature: signWithGenesisDeviceKey(privateKey, canonicalizeGenesisAnchor(anchorWithoutSignature)),
    };

    const attestationWithoutSignature: Omit<FamilyOwnerAttestation, 'signature'> = {
      familyId,
      purpose: OWNER_ATTESTATION_DOMAIN,
      attestationRevision: 1,
      ownerDeviceId: genesisDeviceId,
      ownerDskKeyId: genesisDskKeyId,
      ownerDskPublicKey: publicKeyBase64,
      trustSetEpoch: 1,
      keyEpoch: 1,
      issuedAt: now,
      expiresAt: new Date(now.getTime() + GENESIS_DEVICE_ATTESTATION_TTL_MS),
      previousAttestationId: null,
      signerDeviceId: genesisDeviceId,
      signerDskKeyId: genesisDskKeyId,
      signerDskPublicKey: publicKeyBase64,
    };
    const genesisAttestation: FamilyOwnerAttestation = {
      ...attestationWithoutSignature,
      signature: signWithGenesisDeviceKey(privateKey, canonicalizeOwnerAttestation(attestationWithoutSignature)),
    };

    const result = await this.familyGenesisEngine.bootstrapFamilyAuthority({ anchor, genesisAttestation });
    if (result.status === 'BOOTSTRAPPED' || result.status === 'ALREADY_BOOTSTRAPPED') {
      return result.anchor.familyId;
    }
    return null; // INVALID_PROOF -- e.g. RejectingDeviceSignatureVerifier in production today; identity/session still proceed.
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

    const issued = await this.issueSessionFor(account.accountId);
    return { accountId: account.accountId, familyId: account.familyId, rawSessionToken: issued.rawToken, sessionExpiresAt: issued.session.expiresAt };
  }

  private async issueSessionFor(accountId: ParentAccountId) {
    const identity = { accountReferenceHash: accountReferenceHashFor(accountId) };
    const issued = await this.authService.issueSession(identity);
    await this.repository.setServiceAccountIdIfAbsent(accountId, issued.session.accountId);
    return issued;
  }

  /** GET /api/parent/session -- reads current session state without re-verifying credentials. Fails closed (UNAUTHORIZED) identically for missing/malformed/expired/revoked cookie, disabled account, or an orphaned service-session lookup. */
  async readSession(rawSessionToken: string): Promise<SessionReadOutcome> {
    let serviceAccountId: string;
    try {
      serviceAccountId = await this.authService.validateSession(rawSessionToken);
    } catch {
      throw new ParentAccountError('UNAUTHORIZED');
    }
    const account = await this.repository.findByServiceAccountId(serviceAccountId);
    if (!account || account.status !== 'VERIFIED' || account.disabledAt !== null) throw new ParentAccountError('UNAUTHORIZED');
    return { accountId: account.accountId, familyId: account.familyId, emailVerified: true };
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
