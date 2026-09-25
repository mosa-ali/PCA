/**
 * Parent authenticator-app (TOTP) cryptography -- PCA-DEC-037.
 *
 * REUSE, NOT A SECOND DESIGN: every cryptographic primitive here is the
 * Platform Admin implementation (platformadmin/auth/totp.ts), which already
 * carries the RFC 6238 vector tests, the ±1-step skew window, the timing-safe
 * comparison, the 6-digit shape check before any HMAC work, AES-256-GCM
 * sealing and the bounded decrypt-only keyring. Only two things are
 * Parent-specific, and both are deliberate:
 *
 *   1. A SEPARATE key realm (PCA_PARENT_MFA_ENC_KEY, plus decrypt-only
 *      _PREVIOUS_1/_PREVIOUS_2). A Parent secret and an Admin secret are never
 *      sealed under the same key, so compromise or rotation of one realm never
 *      touches the other (the PCA-ADD-PA-012 separation, kept at the key layer).
 *   2. The otpauth:// label/issuer the authenticator app displays.
 *
 * FAIL-CLOSED: loadParentMfaKeyring throws synchronously when the active key
 * is missing or malformed, or when a legacy slot is set but malformed. The
 * error names the VARIABLE, never a value.
 */
import {
  base32Encode,
  decryptTotpSecretWithKeyring,
  encryptTotpSecret,
  generateTotpSecret,
  verifyTotp,
  type EncryptedTotpSecret,
  type MfaDecryptionKeySource,
  type MfaEncryptionKeyring,
} from '../../platformadmin/auth/totp.js';
import { TOTP_DIGITS, TOTP_STEP_SECONDS } from '../../platformadmin/auth/policy.js';

export const PARENT_MFA_ENC_KEY_ENV_VAR = 'PCA_PARENT_MFA_ENC_KEY';
export const PARENT_MFA_LEGACY_ENC_KEY_ENV_VARS = ['PCA_PARENT_MFA_ENC_KEY_PREVIOUS_1', 'PCA_PARENT_MFA_ENC_KEY_PREVIOUS_2'] as const;
const KEY_PATTERN = /^[0-9a-f]{64}$/i;

export type ParentMfaKeyring = MfaEncryptionKeyring;

export function loadParentMfaKeyring(env: NodeJS.ProcessEnv = process.env): ParentMfaKeyring {
  const activeHex = env[PARENT_MFA_ENC_KEY_ENV_VAR];
  if (typeof activeHex !== 'string' || !KEY_PATTERN.test(activeHex)) {
    throw new Error(`${PARENT_MFA_ENC_KEY_ENV_VAR} must be set to a 64-character hex string (32 raw bytes). Refusing to perform any Parent MFA operation (fail-closed).`);
  }
  const legacy: Array<{ source: MfaDecryptionKeySource; key: Buffer }> = [];
  PARENT_MFA_LEGACY_ENC_KEY_ENV_VARS.forEach((name, index) => {
    const hex = env[name];
    if (hex === undefined || hex.trim() === '') return;
    if (!KEY_PATTERN.test(hex)) {
      throw new Error(`${name} is set but is not a 64-character hex string (32 raw bytes). Refusing to perform any Parent MFA operation (fail-closed).`);
    }
    legacy.push({ source: index === 0 ? 'PREVIOUS_1' : 'PREVIOUS_2', key: Buffer.from(hex, 'hex') });
  });
  return { active: Buffer.from(activeHex, 'hex'), legacy };
}

export interface NewParentTotpSecret {
  sealed: EncryptedTotpSecret;
  /** RFC 4648 base32 for manual entry. Returned to the enrolling browser once and never persisted in clear. */
  secretBase32: string;
}

export function generateSealedParentTotpSecret(keyring: ParentMfaKeyring): NewParentTotpSecret {
  const secret = generateTotpSecret();
  try {
    return { sealed: encryptTotpSecret(secret, keyring.active), secretBase32: base32Encode(secret) };
  } finally {
    secret.fill(0);
  }
}

/**
 * Returns the matched absolute TOTP counter, or null. The caller must still
 * claim that counter atomically (last_accepted_totp_counter) before treating
 * the code as accepted -- this function has no replay bookkeeping.
 */
export function verifySealedParentTotp(ciphertext: Buffer, nonce: Buffer, keyring: ParentMfaKeyring, code: string, nowMs: number): number | null {
  if (typeof code !== 'string' || !/^[0-9]{6}$/.test(code)) return null;
  const { secret } = decryptTotpSecretWithKeyring(ciphertext, nonce, keyring);
  try {
    return verifyTotp(secret, code, nowMs);
  } finally {
    secret.fill(0);
  }
}

/** otpauth:// URI for ordinary authenticator apps (Microsoft Authenticator, Google Authenticator, any RFC 6238 app). No vendor account is involved. */
export function buildParentOtpauthUri(accountLabel: string, secretBase32: string): string {
  const label = encodeURIComponent(`PCA Parent:${accountLabel}`);
  return `otpauth://totp/${label}?secret=${secretBase32}&issuer=PCA%20Parent&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_STEP_SECONDS}`;
}
