import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { isProductionSensitiveRuntime } from '../runtime/environment.js';

const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const ACTIVE_KEY_NAME = 'PCA_PARENT_IDENTITY_ENC_KEY';
const PREVIOUS_KEY_NAMES = ['PCA_PARENT_IDENTITY_ENC_KEY_PREVIOUS_1', 'PCA_PARENT_IDENTITY_ENC_KEY_PREVIOUS_2'] as const;
const DEV_ONLY_KEY = Buffer.alloc(KEY_BYTES, 0).toString('hex');

export type ParentPhoneValidation =
  | { valid: true; value: string | null }
  | { valid: false; reason: 'invalid_format' };

/** Optional phone input is accepted only when it can be canonicalized without guessing a country code. */
export function normalizeParentPhoneNumber(input: unknown): ParentPhoneValidation {
  if (input === undefined || input === null) return { valid: true, value: null };
  if (typeof input !== 'string' || input.length > 64) return { valid: false, reason: 'invalid_format' };
  const trimmed = input.trim().replace(/[٠-٩۰-۹]/g, (digit) => {
    const codePoint = digit.codePointAt(0)!;
    return String(codePoint >= 0x06f0 ? codePoint - 0x06f0 : codePoint - 0x0660);
  });
  if (trimmed === '') return { valid: true, value: null };

  let compact = trimmed.replace(/[\s().-]/g, '');
  if (compact.startsWith('00')) compact = `+${compact.slice(2)}`;
  if (!/^\+[1-9][0-9]{7,14}$/.test(compact)) return { valid: false, reason: 'invalid_format' };
  return { valid: true, value: compact };
}

export interface EncryptedParentDisplayEmail {
  readonly ciphertext: Buffer;
  readonly nonce: Buffer;
  readonly authTag: Buffer;
}

export interface OpenedParentDisplayEmail {
  readonly email: string;
  /** True when authenticated decryption used a decrypt-only previous key. */
  readonly needsReencryption: boolean;
}

export interface ParentIdentityEncryptionKey {
  readonly name: string;
  readonly key: Buffer;
}

export class ParentIdentityEncryptionConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ParentIdentityEncryptionConfigurationError';
  }
}

/** Dedicated durable identity key realm; never reuse the outbox or TOTP key. */
export function loadParentIdentityEncryptionKeyring(env: NodeJS.ProcessEnv = process.env): ParentIdentityEncryptionKey[] {
  const names = [ACTIVE_KEY_NAME, ...PREVIOUS_KEY_NAMES];
  const keys: ParentIdentityEncryptionKey[] = [];
  for (const [index, name] of names.entries()) {
    const raw = env[name];
    if ((raw === undefined || raw === '') && index > 0) continue;
    if ((raw === undefined || raw === '') && index === 0 && !isProductionSensitiveRuntime(env)) {
      keys.push({ name, key: Buffer.from(DEV_ONLY_KEY, 'hex') });
      continue;
    }
    if (typeof raw !== 'string' || !/^[0-9a-f]{64}$/i.test(raw)) {
      throw new ParentIdentityEncryptionConfigurationError(`${name} must be a 64-character hex string (32 raw bytes); refusing to persist or disclose Parent identity email.`);
    }
    keys.push({ name, key: Buffer.from(raw, 'hex') });
  }
  return keys;
}

function emailAad(accountId: string): Buffer {
  if (!/^[A-Za-z0-9-]{1,64}$/.test(accountId)) throw new Error('Invalid Parent account identifier for identity encryption.');
  return Buffer.from(`pca-parent-identity:display-email:v1:${accountId}`, 'utf8');
}

export function encryptParentDisplayEmail(accountId: string, email: string, env: NodeJS.ProcessEnv = process.env): EncryptedParentDisplayEmail {
  const normalized = email.trim();
  if (!normalized || Buffer.byteLength(normalized, 'utf8') > 1280) throw new Error('Invalid Parent display email.');
  const key = loadParentIdentityEncryptionKeyring(env)[0]!.key;
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(emailAad(accountId));
  const ciphertext = Buffer.concat([cipher.update(normalized, 'utf8'), cipher.final()]);
  return { ciphertext, nonce, authTag: cipher.getAuthTag() };
}

export function decryptParentDisplayEmail(
  accountId: string,
  payload: EncryptedParentDisplayEmail | null,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  return openParentDisplayEmail(accountId, payload, env)?.email ?? null;
}

export function openParentDisplayEmail(
  accountId: string,
  payload: EncryptedParentDisplayEmail | null,
  env: NodeJS.ProcessEnv = process.env,
): OpenedParentDisplayEmail | null {
  if (payload === null) return null;
  if (payload.nonce.length !== NONCE_BYTES || payload.authTag.length !== TAG_BYTES || payload.ciphertext.length === 0 || payload.ciphertext.length > 1280) {
    throw new Error('Malformed Parent display email ciphertext.');
  }
  let lastError: unknown;
  const keyring = loadParentIdentityEncryptionKeyring(env);
  for (const [index, candidate] of keyring.entries()) {
    try {
      const decipher = createDecipheriv('aes-256-gcm', candidate.key, payload.nonce);
      decipher.setAAD(emailAad(accountId));
      decipher.setAuthTag(payload.authTag);
      return {
        email: Buffer.concat([decipher.update(payload.ciphertext), decipher.final()]).toString('utf8'),
        needsReencryption: index > 0,
      };
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error('Parent display email could not be decrypted with the configured identity keyring.', { cause: lastError });
}
