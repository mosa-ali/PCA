import type { PlatformAdminAccountRecord, PlatformAdminId, PlatformAdminMfaStateRecord } from './types.js';
import type { CompareAndSwapMfaSecretCiphertextInput } from './AuthRepository.js';

export const PLATFORM_ADMIN_ACTIVATION_PURPOSE = 'PLATFORM_ADMIN_FIRST_TIME' as const;

export interface ActivationTokenRecord {
  activationId: string;
  adminId: PlatformAdminId;
  tokenHash: string;
  createdAt: Date;
  expiresAt: Date;
  usedAt: Date | null;
  revokedAt: Date | null;
}

export interface ActivationState {
  token: ActivationTokenRecord;
  account: PlatformAdminAccountRecord;
  mfa: PlatformAdminMfaStateRecord;
}

export interface PlatformAdminActivationRepository {
  issue(input: { activationId: string; adminId: PlatformAdminId; tokenHash: string; createdAt: Date; expiresAt: Date }): Promise<void>;
  findUsable(tokenHash: string, now: Date): Promise<ActivationState | null>;
  beginMfa(input: { tokenHash: string; now: Date; ciphertext: Buffer; nonce: Buffer }): Promise<ActivationState | null>;
  /**
   * Read-repair of an existing sealed MFA secret under the active key, guarded
   * by a compare-and-swap on the observed old ciphertext/nonce (see
   * PlatformAdminAuthRepository.compareAndSwapMfaSecretCiphertext, the same
   * contract). Present on this repository too because the PENDING_SETUP repair
   * happens during activation, which does not hold the auth repository.
   * False means the row already moved on and must be treated as success.
   */
  compareAndSwapMfaSecretCiphertext(input: CompareAndSwapMfaSecretCiphertextInput): Promise<boolean>;
  complete(input: { tokenHash: string; now: Date; passwordCredential: string; acceptedTotpCounter: number }): Promise<boolean>;
}
