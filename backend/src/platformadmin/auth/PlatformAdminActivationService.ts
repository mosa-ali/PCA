import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { EmailSenderPort } from '../../parentaccount/EmailSenderPort.js';
import { hashAdminEmail } from './emailHash.js';
import { hashPassword } from './passwordCredential.js';
import { authorizePlatformAdminOperation } from './rbacPolicy.js';
import { base32Encode, buildOtpauthUri, decryptTotpSecret, encryptTotpSecret, generateTotpSecret, loadMfaEncryptionKey, verifyTotp } from './totp.js';
import type { PlatformAdminAuthRepository } from './AuthRepository.js';
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
  constructor(
    private readonly authRepository: PlatformAdminAuthRepository,
    private readonly activationRepository: PlatformAdminActivationRepository,
    private readonly emailSender: EmailSenderPort,
    private readonly env: NodeJS.ProcessEnv = process.env,
    private readonly now: () => Date = () => new Date(),
  ) {}

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
    if (!TOKEN_SHAPE.test(rawToken)) throw new PlatformAdminActivationError();
    const now = this.now();
    const existing = await this.activationRepository.findUsable(hashActivationToken(rawToken), now);
    if (!existing || existing.account.status !== 'ACTIVE' || existing.mfa.status !== 'PENDING_SETUP' || existing.mfa.totpSecretCiphertext || existing.mfa.totpSecretNonce) throw new PlatformAdminActivationError();
    const secret = generateTotpSecret();
    const encrypted = encryptTotpSecret(secret, loadMfaEncryptionKey(this.env));
    const begun = await this.activationRepository.beginMfa({ tokenHash: hashActivationToken(rawToken), now, ciphertext: encrypted.ciphertext, nonce: encrypted.nonce });
    if (!begun) throw new PlatformAdminActivationError();
    return { otpauthUri: buildOtpauthUri(begun.account.displayName, base32Encode(secret)) };
  }

  async complete(rawToken: string, password: string, totpCode: string): Promise<void> {
    if (!TOKEN_SHAPE.test(rawToken) || typeof password !== 'string' || password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH || !/^[0-9]{6}$/.test(totpCode)) throw new PlatformAdminActivationError();
    const now = this.now();
    const tokenHash = hashActivationToken(rawToken);
    const current = await this.activationRepository.findUsable(tokenHash, now);
    if (!current || current.account.status !== 'ACTIVE' || current.mfa.status !== 'PENDING_SETUP' || !current.mfa.totpSecretCiphertext || !current.mfa.totpSecretNonce) throw new PlatformAdminActivationError();
    const secret = decryptTotpSecret(current.mfa.totpSecretCiphertext, current.mfa.totpSecretNonce, loadMfaEncryptionKey(this.env));
    const counter = verifyTotp(secret, totpCode, now.getTime());
    if (counter === null) throw new PlatformAdminActivationError();
    const credential = await hashPassword(password);
    const completed = await this.activationRepository.complete({ tokenHash, now, passwordCredential: credential, acceptedTotpCounter: counter });
    if (!completed) throw new PlatformAdminActivationError();
  }
}
