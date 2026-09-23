import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { EmailSenderPort } from '../../parentaccount/EmailSenderPort.js';
import { hashAdminEmail } from './emailHash.js';
import { hashPassword } from './passwordCredential.js';
import { authorizePlatformAdminOperation } from './rbacPolicy.js';
import { base32Encode, buildOtpauthUri, decryptTotpSecretWithKeyring, encryptTotpSecret, generateTotpSecret, loadMfaEncryptionKeyring, verifyTotp } from './totp.js';
import type { PlatformAdminAuthRepository } from './AuthRepository.js';
import { repairMfaSecretCiphertext } from './mfaSecretReadRepair.js';
import { NOOP_ACTIVATION_DIAGNOSTICS, type ActivationDiagnostics } from './activationDiagnostics.js';
import type { PlatformAdminActivationRepository } from './PlatformAdminActivationRepository.js';
import type { PlatformAdminId, PlatformAdminRole } from './types.js';

const TOKEN_BYTES = 32;
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;
const ACTIVATION_TTL_MS = 30 * 60_000;
const PASSWORD_MIN_LENGTH = 12;
const PASSWORD_MAX_LENGTH = 256;
const GENERIC_MESSAGE = 'Platform Admin activation failed.';

export class PlatformAdminActivationError extends Error {
  constructor() { super(GENERIC_MESSAGE); this.name = 'PlatformAdminActivationError'; }
}

export type ActivationActor = { adminId: PlatformAdminId; roles: PlatformAdminRole[] };

export function generateActivationToken(): { rawToken: string; tokenHash: string } {
  const rawToken = randomBytes(TOKEN_BYTES).toString('base64url');
  return { rawToken, tokenHash: hashActivationToken(rawToken) };
}

export function hashActivationToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

function equalBytes(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

export class PlatformAdminActivationService {
  /**
   * Guarded once, here, so "diagnostics never alter an outcome" holds for ANY
   * injected sink -- not only for CONSOLE_ACTIVATION_DIAGNOSTICS, which happens
   * to catch its own failures. A sink that throws must not be able to fail an
   * activation. The requirement is a property of this service, so it is enforced
   * here rather than left as a convention that every future sink must remember.
   */
  private readonly diagnostics: ActivationDiagnostics;

  constructor(
    private readonly authRepository: PlatformAdminAuthRepository,
    private readonly activationRepository: PlatformAdminActivationRepository,
    private readonly emailSender: EmailSenderPort,
    private readonly env: NodeJS.ProcessEnv = process.env,
    private readonly now: () => Date = () => new Date(),
    // Defaults to the NO-OP sink deliberately: observability is a decision made
    // at the composition root, never an implicit consequence of constructing the
    // service, and every test that does not opt in stays silent. main.ts injects
    // CONSOLE_ACTIVATION_DIAGNOSTICS explicitly.
    diagnostics: ActivationDiagnostics = NOOP_ACTIVATION_DIAGNOSTICS,
  ) {
    this.diagnostics = {
      stage: (stage, outcome, detail) => {
        try {
          diagnostics.stage(stage, outcome, detail);
        } catch {
          /* a diagnostic must never fail the operation it describes */
        }
      },
    };
  }

  async issueActivation(adminId: PlatformAdminId, email: string, actor: ActivationActor): Promise<void> {
    if (authorizePlatformAdminOperation(actor.roles, 'MANAGE_ADMIN_ACCOUNTS') !== 'ALLOW') throw new PlatformAdminActivationError();
    const account = await this.authRepository.findAccountById(adminId);
    const normalized = email.trim().toLowerCase();
    const roles = account ? await this.authRepository.findActiveRoles(adminId) : [];
    const mfa = account ? await this.authRepository.getMfaState(adminId) : null;
    if (!account || account.status !== 'ACTIVE' || !roles.includes('PLATFORM_ADMIN') || !mfa || mfa.status !== 'PENDING_SETUP' || !equalBytes(account.emailHash, hashAdminEmail(normalized))) throw new PlatformAdminActivationError();
    const base = this.env.PCA_PLATFORM_ADMIN_ACTIVATION_BASE_URL;
    if (!base || !/^https:\/\//i.test(base) && this.env.NODE_ENV === 'production') throw new PlatformAdminActivationError();
    const { rawToken, tokenHash } = generateActivationToken();
    const createdAt = this.now();
    await this.activationRepository.issue({ activationId: randomUUID(), adminId, tokenHash, createdAt, expiresAt: new Date(createdAt.getTime() + ACTIVATION_TTL_MS) });
    const url = `${(base ?? 'http://localhost:4100/platform-admin/activate').replace(/\/$/, '')}?token=${encodeURIComponent(rawToken)}`;
    await this.emailSender.sendPlatformAdminActivationLink(normalized, url, rawToken);
  }

  async start(rawToken: string): Promise<{ otpauthUri: string }> {
    if (!TOKEN_SHAPE.test(rawToken)) {
      this.diagnostics.stage('ACTIVATION_TOKEN_VALIDATION', 'REJECTED', { reason: 'INVALID_TOKEN_SHAPE' });
      throw new PlatformAdminActivationError();
    }
    const now = this.now();
    const existing = await this.activationRepository.findUsable(hashActivationToken(rawToken), now);
    if (!existing || existing.account.status !== 'ACTIVE' || existing.mfa.status !== 'PENDING_SETUP' || existing.mfa.totpSecretCiphertext || existing.mfa.totpSecretNonce) {
      // The reasons are distinguished here because they are operationally
      // different: a dead link, a disabled account, and an enrollment that has
      // already been started all present identically to the operator.
      this.diagnostics.stage('ACTIVATION_TOKEN_VALIDATION', 'REJECTED', {
        reason: !existing
          ? 'NO_USABLE_TOKEN'
          : existing.account.status !== 'ACTIVE'
            ? 'ACCOUNT_NOT_ACTIVE'
            : existing.mfa.status !== 'PENDING_SETUP'
              ? 'MFA_NOT_PENDING_SETUP'
              : 'MFA_ALREADY_STARTED',
      });
      throw new PlatformAdminActivationError();
    }
    const secret = generateTotpSecret();
    let encrypted: ReturnType<typeof encryptTotpSecret>;
    try {
      // Validates the FULL key ring, not just the active key. Sealing with the
      // active key alone would let a start() succeed and hand out a QR while a
      // malformed legacy slot guarantees the later complete() must fail -- burning
      // the enrollment and forcing a reissue, which is the opposite of fail-closed.
      encrypted = encryptTotpSecret(secret, loadMfaEncryptionKeyring(this.env).active);
    } catch (error) {
      // Reported, then re-thrown unchanged: the fail-closed contract and the
      // caller-visible outcome are identical to before.
      this.diagnostics.stage('MFA_KEYRING_CONFIGURATION', 'FAILED', { reason: 'KEYRING_MISCONFIGURED' });
      throw error;
    }
    const begun = await this.activationRepository.beginMfa({ tokenHash: hashActivationToken(rawToken), now, ciphertext: encrypted.ciphertext, nonce: encrypted.nonce });
    if (!begun) {
      // beginMfa is a single-winner initialization; losing it means a
      // concurrent start already persisted a secret for this enrollment.
      this.diagnostics.stage('ACTIVATION_START', 'REJECTED', { reason: 'MFA_ALREADY_STARTED' });
      throw new PlatformAdminActivationError();
    }
    this.diagnostics.stage('ACTIVATION_START', 'OK');
    return { otpauthUri: buildOtpauthUri(begun.account.displayName, base32Encode(secret)) };
  }

  async complete(rawToken: string, password: string, totpCode: string): Promise<void> {
    if (!TOKEN_SHAPE.test(rawToken) || typeof password !== 'string' || password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH || !/^[0-9]{6}$/.test(totpCode)) {
      // Deliberately one reason for all of these: which of the token, password
      // or code failed shape validation is not needed to operate the system,
      // and splitting it would put a near-miss signal about submissions into
      // the logs for no operational gain.
      this.diagnostics.stage('ACTIVATION_TOKEN_VALIDATION', 'REJECTED', { reason: 'INVALID_TOKEN_SHAPE' });
      throw new PlatformAdminActivationError();
    }
    const now = this.now();
    const tokenHash = hashActivationToken(rawToken);
    const current = await this.activationRepository.findUsable(tokenHash, now);
    if (!current || current.account.status !== 'ACTIVE' || current.mfa.status !== 'PENDING_SETUP' || !current.mfa.totpSecretCiphertext || !current.mfa.totpSecretNonce) {
      this.diagnostics.stage('ACTIVATION_TOKEN_VALIDATION', 'REJECTED', {
        reason: !current
          ? 'NO_USABLE_TOKEN'
          : current.account.status !== 'ACTIVE'
            ? 'ACCOUNT_NOT_ACTIVE'
            : 'MFA_NOT_PENDING_SETUP',
      });
      throw new PlatformAdminActivationError();
    }
    // Rotation-tolerant decryption. Before the key ring, a rotation between
    // `start` and `complete` made this call throw, and the only recovery was
    // destroying the pending material and reissuing the activation link.
    let keyring: ReturnType<typeof loadMfaEncryptionKeyring>;
    try {
      keyring = loadMfaEncryptionKeyring(this.env);
    } catch (error) {
      // Reported, then re-thrown unchanged: this is the highest-value failure
      // to distinguish, because it is a deployment fault rather than anything
      // the operator did, and it used to present as a generic invalid link.
      this.diagnostics.stage('MFA_KEYRING_CONFIGURATION', 'FAILED', { reason: 'KEYRING_MISCONFIGURED' });
      throw error;
    }
    let decrypted: ReturnType<typeof decryptTotpSecretWithKeyring>;
    try {
      decrypted = decryptTotpSecretWithKeyring(
        current.mfa.totpSecretCiphertext,
        current.mfa.totpSecretNonce,
        keyring,
      );
    } catch (error) {
      // No permitted key authenticated this ciphertext. Distinct from a wrong
      // code: the secret could not even be read.
      this.diagnostics.stage('MFA_SECRET_DECRYPT', 'FAILED', { reason: 'NO_PERMITTED_KEY' });
      throw error;
    }
    const { secret, keySource, requiresReadRepair } = decrypted;
    this.diagnostics.stage('MFA_SECRET_DECRYPT', 'OK', { keySource });
    if (requiresReadRepair) {
      // Best-effort read repair BEFORE the state transition below, so the row is
      // re-sealed under the active key while it is still PENDING_SETUP. Guarded
      // by a CAS on the observed value, which also means a concurrent reissue
      // that legitimately replaced this material cannot be overwritten.
      const repaired = await repairMfaSecretCiphertext(this.activationRepository, {
        adminId: current.token.adminId,
        keyring,
        observedCiphertext: current.mfa.totpSecretCiphertext,
        observedNonce: current.mfa.totpSecretNonce,
        secret,
      });
      // A false result is either a lost race or the row having moved on; both
      // are benign, and the activation below proceeds either way.
      this.diagnostics.stage('MFA_READ_REPAIR', repaired ? 'OK' : 'REJECTED', { repaired, keySource });
    }
    const counter = verifyTotp(secret, totpCode, now.getTime());
    if (counter === null) {
      this.diagnostics.stage('MFA_CODE_VERIFICATION', 'REJECTED', { reason: 'INVALID_CODE' });
      throw new PlatformAdminActivationError();
    }
    this.diagnostics.stage('MFA_CODE_VERIFICATION', 'OK');
    const credential = await hashPassword(password);
    const completed = await this.activationRepository.complete({ tokenHash, now, passwordCredential: credential, acceptedTotpCounter: counter });
    if (!completed) {
      // The code verified but the write was refused (concurrent completion, or
      // the atomic guarded UPDATE matched nothing). An infrastructure outcome,
      // not a bad code -- previously indistinguishable from one.
      this.diagnostics.stage('MFA_PERSISTENCE', 'FAILED', { reason: 'PERSISTENCE_REFUSED' });
      throw new PlatformAdminActivationError();
    }
    this.diagnostics.stage('ACTIVATION_COMPLETE', 'OK');
  }
}
