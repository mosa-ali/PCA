/**
 * PCA-DW-W2-15F -- encryption at rest for the durable email outbox.
 *
 * WHY THIS EXISTS: migrations/0013_parent_account_identity.sql is explicit
 * that "email_hash is the ONLY queryable form of the submitted email...
 * No raw email column exists" anywhere in this domain -- a deliberate
 * privacy invariant, not an oversight (PCA-ADD-IDENT-003). A durable outbox
 * genuinely needs the recipient address and rendered code at rest (a
 * process restart between enqueue and send must not lose the ability to
 * actually deliver it), which is unavoidably a NEW kind of exposure this
 * domain has never had before. Encrypting the row's sensitive columns with
 * a server-held key (AES-256-GCM, authenticated) means a DB leak, backup,
 * or misdirected replica -- the exact threat migration 0013 and
 * verificationCode.ts's HMAC keying both already defend against -- still
 * cannot recover the recipient address or code without also having this
 * key, which never lives in the database or in git. This is deliberately
 * NOT the same guarantee as "no raw email column at all": the live
 * application process can still decrypt (it must, to actually send the
 * email) -- see EmailOutboxProcessor.ts's short-TTL, purge-on-completion
 * handling, which bounds how long that exposure window exists at all.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { isProductionSensitiveRuntime } from '../runtime/environment.js';

const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const IV_BYTES = 12;

export class MissingEmailOutboxEncryptionKeyError extends Error {
  constructor() {
    super(
      'PCA_EMAIL_OUTBOX_ENCRYPTION_KEY must be set (base64, 32 bytes) in production. ' +
        'Refusing to persist outbox content with a guessable or absent key.',
    );
    this.name = 'MissingEmailOutboxEncryptionKeyError';
  }
}

export class InvalidEmailOutboxEncryptionKeyError extends Error {
  constructor(reason: string) {
    super(`PCA_EMAIL_OUTBOX_ENCRYPTION_KEY is invalid: ${reason}`);
    this.name = 'InvalidEmailOutboxEncryptionKeyError';
  }
}

// Fixed, clearly-labeled dev-only key -- 32 zero bytes is deliberately
// inert/obvious rather than something that could be mistaken for a real
// secret if it ever leaked from a local .env; matches the codebase's
// existing "dev-only, do-not-use-in-production" self-declaration idiom.
const DEV_ONLY_DEFAULT_KEY = Buffer.alloc(KEY_BYTES, 0).toString('base64');

function resolveKey(env: NodeJS.ProcessEnv): Buffer {
  const configured = env.PCA_EMAIL_OUTBOX_ENCRYPTION_KEY;
  const raw = typeof configured === 'string' && configured.length > 0 ? configured : (() => {
    if (isProductionSensitiveRuntime(env)) throw new MissingEmailOutboxEncryptionKeyError();
    return DEV_ONLY_DEFAULT_KEY;
  })();

  let key: Buffer;
  try {
    key = Buffer.from(raw, 'base64');
  } catch {
    throw new InvalidEmailOutboxEncryptionKeyError('not valid base64');
  }
  if (key.length !== KEY_BYTES) {
    throw new InvalidEmailOutboxEncryptionKeyError(`must decode to exactly ${KEY_BYTES} bytes, got ${key.length}`);
  }
  return key;
}

export interface EncryptedPayload {
  readonly ivBase64: string;
  readonly authTagBase64: string;
  readonly ciphertextBase64: string;
}

export function encryptOutboxContent(plaintext: string, env: NodeJS.ProcessEnv = process.env): EncryptedPayload {
  const key = resolveKey(env);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    ivBase64: iv.toString('base64'),
    authTagBase64: authTag.toString('base64'),
    ciphertextBase64: ciphertext.toString('base64'),
  };
}

export function decryptOutboxContent(payload: EncryptedPayload, env: NodeJS.ProcessEnv = process.env): string {
  const key = resolveKey(env);
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(payload.ivBase64, 'base64'));
  decipher.setAuthTag(Buffer.from(payload.authTagBase64, 'base64'));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(payload.ciphertextBase64, 'base64')), decipher.final()]);
  return plaintext.toString('utf8');
}
