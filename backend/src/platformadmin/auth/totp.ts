import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { TOTP_CLOCK_SKEW_STEPS, TOTP_DIGITS, TOTP_STEP_SECONDS } from './policy.js';

/**
 * PCA-ADD-PA-016: MFA is mandatory, with no bypass. Implemented entirely
 * against node:crypto primitives -- no new npm dependency:
 *   - Base32 encode/decode: a small, hand-written data-encoding helper
 *     (NOT a cryptographic primitive, so writing it here does not violate
 *     the "no custom crypto" rule) for RFC 4648 presentation of the raw
 *     TOTP secret in an otpauth:// URI.
 *   - TOTP: RFC 6238 over HMAC-SHA1 (node:crypto's createHmac), 30-second
 *     step, 6 digits, accepting the current step ±1 for clock skew.
 *   - At-rest secret encryption: AES-256-GCM (node:crypto's
 *     createCipheriv/createDecipheriv), keyed by a bounded KEYRING whose active
 *     key is PLATFORM_ADMIN_MFA_ENC_KEY (see the keyring section below for why
 *     decryption also accepts explicitly named, decrypt-only previous keys).
 *
 * FAIL-CLOSED CONTRACT (binding): loadMfaEncryptionKey throws SYNCHRONOUSLY
 * if PLATFORM_ADMIN_MFA_ENC_KEY is missing or is not exactly a 64-character
 * hex string (32 raw bytes). Every MFA operation -- enrollment, encryption,
 * decryption, verification -- calls this function first and therefore
 * refuses outright rather than silently degrading (e.g. falling back to an
 * unencrypted secret, or skipping MFA) when the key is absent or
 * malformed. This is a deliberate, permanent fail-closed boundary: there
 * is no code path in this module that stores or verifies a TOTP secret
 * without a valid encryption key present.
 *
 * The keyring preserves that boundary rather than relaxing it: the ACTIVE key
 * is still mandatory and still validated identically, and a legacy key that is
 * present but malformed is a hard error. See loadMfaEncryptionKeyring.
 */

const MFA_ENC_KEY_ENV_VAR = 'PLATFORM_ADMIN_MFA_ENC_KEY';
const MFA_ENC_KEY_HEX_LENGTH = 64; // 32 raw bytes
const GCM_NONCE_BYTES = 16; // matches platform_admin_mfa_state.totp_secret_nonce VARBINARY(16)
const GCM_AUTH_TAG_BYTES = 16;
const TOTP_SECRET_BYTES = 20; // 160 bits, RFC 4226 Section 4's recommended HOTP secret length

export function loadMfaEncryptionKey(env: NodeJS.ProcessEnv = process.env): Buffer {
  const hex = env[MFA_ENC_KEY_ENV_VAR];
  if (typeof hex !== 'string' || !/^[0-9a-f]{64}$/i.test(hex) || hex.length !== MFA_ENC_KEY_HEX_LENGTH) {
    throw new Error(
      `${MFA_ENC_KEY_ENV_VAR} must be set to a ${MFA_ENC_KEY_HEX_LENGTH}-character hex string (32 raw bytes). Refusing to perform any MFA operation (fail-closed).`,
    );
  }
  return Buffer.from(hex, 'hex');
}

export function generateTotpSecret(): Buffer {
  return randomBytes(TOTP_SECRET_BYTES);
}

export interface EncryptedTotpSecret {
  ciphertext: Buffer;
  nonce: Buffer;
}

export function encryptTotpSecret(secret: Buffer, key: Buffer): EncryptedTotpSecret {
  const nonce = randomBytes(GCM_NONCE_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  const encrypted = Buffer.concat([cipher.update(secret), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return { ciphertext: Buffer.concat([encrypted, authTag]), nonce };
}

export function decryptTotpSecret(ciphertext: Buffer, nonce: Buffer, key: Buffer): Buffer {
  if (ciphertext.length < GCM_AUTH_TAG_BYTES) throw new Error('Malformed TOTP ciphertext.');
  const authTag = ciphertext.subarray(ciphertext.length - GCM_AUTH_TAG_BYTES);
  const encrypted = ciphertext.subarray(0, ciphertext.length - GCM_AUTH_TAG_BYTES);
  const decipher = createDecipheriv('aes-256-gcm', key, nonce);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}

// ---- Bounded MFA encryption keyring (rotation without losing enrollments) --
//
// WHY THIS EXISTS
// ---------------
// `loadMfaEncryptionKey` reads exactly ONE key. That is correct for ENCRYPTION
// and catastrophic for DECRYPTION across a rotation: the moment the operator
// sets a new PLATFORM_ADMIN_MFA_ENC_KEY, every TOTP secret already sealed under
// the previous key becomes undecryptable, so any admin mid-enrollment fails
// `complete()`, and any already-enrolled admin is locked out of MFA. Recovery
// then requires DESTROYING the pending material and reissuing activation -- a
// manual, privileged, one-admin-at-a-time operation.
//
// The keyring makes rotation a non-event: `active` seals new material, and an
// explicitly named, bounded set of previous keys may DECRYPT ONLY. A successful
// legacy decrypt is reported so the caller can read-repair (re-seal under the
// active key), which retires the legacy key one row at a time.
//
// BOUNDED by construction. The legacy slots are two NAMED environment
// variables, not a lookup: there is deliberately no enumeration of Key Vault
// secret versions or history, because that would turn a rotation bug into an
// unbounded credential-discovery surface, and would let a stale or attacker
// planted version silently become a valid decryption key. Two slots is the
// whole rotation window (rotate once, and once more before the first drains).
//
// FAIL-CLOSED, with the same strictness as the active key. An ABSENT legacy
// variable is simply skipped. A legacy variable that is PRESENT but malformed
// throws: silently ignoring a mistyped rotation key would look exactly like
// having no legacy key at all, and would fail open into the very lockout this
// exists to prevent.
export const MFA_LEGACY_ENC_KEY_ENV_VARS = [
  'PLATFORM_ADMIN_MFA_ENC_KEY_PREVIOUS_1',
  'PLATFORM_ADMIN_MFA_ENC_KEY_PREVIOUS_2',
] as const;

export type MfaDecryptionKeySource = 'ACTIVE' | 'PREVIOUS_1' | 'PREVIOUS_2';

export interface MfaEncryptionKeyring {
  active: Buffer;
  /** Bounded, ordered decrypt-only keys. Empty when no rotation is pending. */
  legacy: ReadonlyArray<{ source: MfaDecryptionKeySource; key: Buffer }>;
}

export interface MfaDecryptionResult {
  secret: Buffer;
  keySource: MfaDecryptionKeySource;
  /**
   * True when the secret was sealed under a LEGACY key. Callers that own a
   * writable row should re-seal with `keyring.active` and persist, which is
   * what drains the legacy key. Callers that cannot write may safely ignore
   * this, but must not treat it as an error.
   */
  requiresReadRepair: boolean;
}

export function loadMfaEncryptionKeyring(env: NodeJS.ProcessEnv = process.env): MfaEncryptionKeyring {
  const active = loadMfaEncryptionKey(env);
  const legacy: Array<{ source: MfaDecryptionKeySource; key: Buffer }> = [];
  MFA_LEGACY_ENC_KEY_ENV_VARS.forEach((name, index) => {
    const hex = env[name];
    // Absent or blank means "no such generation" -- a clean skip, so an
    // operator with nothing to rotate is not forced to set anything.
    if (hex === undefined || hex.trim() === '') return;
    if (!/^[0-9a-f]{64}$/i.test(hex) || hex.length !== MFA_ENC_KEY_HEX_LENGTH) {
      // Names the VARIABLE, never the value.
      throw new Error(
        `${name} is set but is not a ${MFA_ENC_KEY_HEX_LENGTH}-character hex string (32 raw bytes). Refusing to perform any MFA operation (fail-closed).`,
      );
    }
    const source: MfaDecryptionKeySource = index === 0 ? 'PREVIOUS_1' : 'PREVIOUS_2';
    legacy.push({ source, key: Buffer.from(hex, 'hex') });
  });
  return { active, legacy };
}

/**
 * Decrypts a sealed TOTP secret by trying the ACTIVE key first, then the
 * bounded legacy keys in order. Throws if no permitted key authenticates the
 * ciphertext (GCM's auth tag is the check, so a wrong key cannot silently
 * yield garbage plaintext).
 *
 * The error message carries no key material and no plaintext.
 */
export function decryptTotpSecretWithKeyring(
  ciphertext: Buffer,
  nonce: Buffer,
  keyring: MfaEncryptionKeyring,
): MfaDecryptionResult {
  // Malformed input is a data-shape error, not a key-selection problem, so it
  // is rejected before any key is tried rather than surfacing as "no key works".
  if (ciphertext.length < GCM_AUTH_TAG_BYTES) throw new Error('Malformed TOTP ciphertext.');

  try {
    return { secret: decryptTotpSecret(ciphertext, nonce, keyring.active), keySource: 'ACTIVE', requiresReadRepair: false };
  } catch {
    // Fall through to the legacy keys. The failure is deliberately swallowed:
    // it is the EXPECTED outcome during a rotation window.
  }

  for (const { source, key } of keyring.legacy) {
    try {
      return { secret: decryptTotpSecret(ciphertext, nonce, key), keySource: source, requiresReadRepair: true };
    } catch {
      // Try the next generation.
    }
  }

  throw new Error('TOTP secret could not be decrypted with any permitted MFA encryption key.');
}

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

export function base32Decode(encoded: string): Buffer {
  const clean = encoded.toUpperCase().replace(/=+$/, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) throw new Error(`Invalid base32 character: ${char}`);
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

function hotp(secret: Buffer, counter: number): string {
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac('sha1', secret).update(counterBuffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binaryCode =
    ((hmac[offset] & 0x7f) << 24) | ((hmac[offset + 1] & 0xff) << 16) | ((hmac[offset + 2] & 0xff) << 8) | (hmac[offset + 3] & 0xff);
  const code = binaryCode % 10 ** TOTP_DIGITS;
  return code.toString().padStart(TOTP_DIGITS, '0');
}

function currentCounter(timeMs: number, stepOffset: number): number {
  return Math.floor(timeMs / 1000 / TOTP_STEP_SECONDS) + stepOffset;
}

export function computeTotp(secret: Buffer, timeMs: number, stepOffset = 0): string {
  return hotp(secret, currentCounter(timeMs, stepOffset));
}

function timingSafeEqualStrings(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, 'utf8');
  const bufferB = Buffer.from(b, 'utf8');
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}

/**
 * TOTP-REPLAY-1: accepts the current 30-second step ±1
 * (TOTP_CLOCK_SKEW_STEPS) for clock skew, exactly as before. Rejects any
 * candidate not shaped like a 6-digit code without attempting HMAC
 * computation. Every candidate comparison remains timing-safe
 * (timingSafeEqualStrings/timingSafeEqual), unchanged.
 *
 * Returns the matched ABSOLUTE HOTP counter (not merely a boolean) on a
 * match, or `null` if no candidate in the ±1 window matches. This lets the
 * caller (PlatformAdminAuthService) durably claim that exact counter via
 * AuthRepository.claimTotpCounter -- a single guarded, atomic
 * compare-and-swap against platform_admin_mfa_state.last_accepted_totp_counter
 * -- before treating the code as accepted, so the SAME valid code can never
 * be accepted twice (RFC 6238's recommended last-accepted-counter replay
 * defense). verifyTotp itself performs no replay bookkeeping and has no
 * side effects -- it is a pure function over (secret, code, timeMs), same
 * as before; the counter claim is the caller's responsibility.
 */
export function verifyTotp(secret: Buffer, code: string, timeMs: number): number | null {
  if (typeof code !== 'string' || !/^[0-9]{6}$/.test(code)) return null;
  for (let offset = -TOTP_CLOCK_SKEW_STEPS; offset <= TOTP_CLOCK_SKEW_STEPS; offset++) {
    const counter = currentCounter(timeMs, offset);
    if (timingSafeEqualStrings(hotp(secret, counter), code)) return counter;
  }
  return null;
}

/** otpauth:// URI for authenticator-app enrollment (bootstrap script only in this lane -- see scripts/bootstrap-platform-owner.mjs). */
export function buildOtpauthUri(accountLabel: string, secretBase32: string): string {
  const label = encodeURIComponent(`PCA Platform Admin:${accountLabel}`);
  return `otpauth://totp/${label}?secret=${secretBase32}&issuer=PCA&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_STEP_SECONDS}`;
}
