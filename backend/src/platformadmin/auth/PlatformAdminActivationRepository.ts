import type { PlatformAdminAccountRecord, PlatformAdminId, PlatformAdminMfaStateRecord } from './types.js';

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
  complete(input: { tokenHash: string; now: Date; passwordCredential: string; acceptedTotpCounter: number }): Promise<boolean>;
}
