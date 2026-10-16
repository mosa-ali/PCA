/**
 * Wave 02C-R2 audit candidate. This module is deliberately not wired into
 * production composition and does not own or persist any browser key.
 *
 * Wire contract: docs/security/production-crypto-review/wave02c-r2/PROFILE.md
 */
import {
  Aes128Gcm,
  CipherSuite,
  DhkemP256HkdfSha256,
  HkdfSha256,
} from '@hpke/core';

export type CandidateRecipient =
  | { kind: 'DEVICE'; recipientDeviceId: string }
  | { kind: 'GROUP'; recipientGroup: string };

export type CandidateEnvelopeMetadata = {
  protocolMajor: number;
  protocolMinor: number;
  messageId: string;
  familyId: string;
  senderDeviceId: string;
  recipient: CandidateRecipient;
  senderKeyId: string;
  messageType: string;
  sequenceOrNonce: string;
  issuedAt: string;
  expiresAt: string;
  trustSetEpoch: number;
  keyEpoch: number;
  semanticVersion: string;
  correlationId: string | null;
};

export class PcaEnvelopeCryptoError extends Error {
  readonly code = 'PCA_ENVELOPE_CRYPTO_FAILED' as const;

  constructor() {
    super('The PCA encrypted envelope could not be processed.');
    this.name = 'PcaEnvelopeCryptoError';
  }
}

const MAGIC = Uint8Array.of(0x50, 0x43, 0x41, 0x46, 0x45, 0x32, 0x00, 0x01); // PCAFE2\0\1
const KEY_WRAP_KIND = 0x01;
const CONTENT_KIND = 0x02;
const CONTENT_PROFILE_ID = 0x0001; // HKDF-SHA256 / AES-128-GCM
const HPKE_KEM_ID = 0x0010;
const HPKE_KDF_ID = 0x0001;
const HPKE_AEAD_ID = 0x0001;
const HPKE_ENC_BYTES = 65;
const HPKE_FDEK_CIPHERTEXT_BYTES = 48;
const FDEK_BYTES = 32;
const CONTENT_SALT_BYTES = 32;
const CONTENT_NONCE_BYTES = 12;
const CONTENT_TAG_BYTES = 16;
export const MAX_CONTENT_PLAINTEXT_BYTES = 32 * 1024;
export const MAX_FAMILY_ENVELOPE_PAYLOAD_BYTES = 64 * 1024;
export const MAX_ENVELOPE_TTL_MS = 24 * 60 * 60 * 1000;

const MESSAGE_TYPES = new Set([
  'POLICY_UPDATE', 'POLICY_RECEIPT', 'STATUS_SNAPSHOT', 'ACTIVITY_SUMMARY',
  'LOCATION_RESPONSE', 'CHILD_REQUEST', 'PARENT_DECISION', 'TAMPER_ALERT',
  'RETENTION_DELETION_INSTRUCTION', 'RETENTION_RECEIPT', 'FTS_UPDATE',
  'KEY_ROTATION', 'DEVICE_REVOKE', 'RECOVERY_TRANSACTION', 'SIGNED_ROLLBACK',
]);

const encoder = new TextEncoder();

function bytes(value: ArrayBufferLike | ArrayBufferView): Uint8Array {
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  return new Uint8Array(value as ArrayBufferLike);
}

function utf8(value: string, maxBytes: number): Uint8Array {
  if (typeof value !== 'string') throw new PcaEnvelopeCryptoError();
  const encoded = encoder.encode(value);
  // TextEncoder replaces unpaired UTF-16 surrogates. Reject those rather
  // than let different runtimes canonicalize an invalid string differently.
  if (new TextDecoder('utf-8', { fatal: true }).decode(encoded) !== value || encoded.length > maxBytes) {
    throw new PcaEnvelopeCryptoError();
  }
  return encoded;
}

function netstrings(fields: readonly string[]): Uint8Array {
  const parts: Uint8Array[] = [];
  let total = 0;
  for (const field of fields) {
    const value = utf8(field, 1024);
    const prefix = encoder.encode(`${value.length}:`);
    parts.push(prefix, value);
    total += prefix.length + value.length;
  }
  if (total > 4096) throw new PcaEnvelopeCryptoError();
  const transcript = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    transcript.set(part, offset);
    offset += part.length;
  }
  return transcript;
}

function epoch(value: number): string {
  if (!Number.isSafeInteger(value) || value < 1) throw new PcaEnvelopeCryptoError();
  return String(value);
}

function canonicalTime(value: string): string {
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)) {
    throw new PcaEnvelopeCryptoError();
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value) {
    throw new PcaEnvelopeCryptoError();
  }
  return value;
}

function validateMetadata(metadata: CandidateEnvelopeMetadata): string[] {
  if (metadata.protocolMajor !== 1 || metadata.protocolMinor !== 0) throw new PcaEnvelopeCryptoError();
  const issuedAt = canonicalTime(metadata.issuedAt);
  const expiresAt = canonicalTime(metadata.expiresAt);
  const ttl = Date.parse(expiresAt) - Date.parse(issuedAt);
  if (ttl <= 0 || ttl > MAX_ENVELOPE_TTL_MS) throw new PcaEnvelopeCryptoError();
  if (!MESSAGE_TYPES.has(metadata.messageType)) throw new PcaEnvelopeCryptoError();
  if (!/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(metadata.semanticVersion)) {
    throw new PcaEnvelopeCryptoError();
  }
  if (metadata.correlationId !== null && metadata.correlationId.length === 0) {
    throw new PcaEnvelopeCryptoError();
  }
  const recipientKind = metadata.recipient.kind;
  const recipientId = recipientKind === 'DEVICE'
    ? metadata.recipient.recipientDeviceId
    : metadata.recipient.recipientGroup;
  const fields = [
    String(metadata.protocolMajor), String(metadata.protocolMinor),
    metadata.messageId, metadata.familyId, metadata.senderDeviceId,
    recipientKind, recipientId, metadata.senderKeyId, metadata.messageType,
    metadata.sequenceOrNonce, issuedAt, expiresAt,
    epoch(metadata.trustSetEpoch), epoch(metadata.keyEpoch), metadata.semanticVersion,
    metadata.correlationId === null ? '0' : '1', metadata.correlationId ?? '',
  ];
  const limits = [8, 8, 128, 128, 128, 8, 128, 128, 64, 128, 24, 24, 16, 16, 32, 1, 128];
  fields.forEach((field, index) => { utf8(field, limits[index]!); });
  return fields;
}

/** Fixed-order metadata transcript; byte-length netstring framing matches the existing PCA canonicalizer. */
export function canonicalFamilyEnvelopeAad(metadata: CandidateEnvelopeMetadata, payloadKind: 'FDEK_WRAP' | 'CONTENT', headerFields: readonly string[] = []): Uint8Array {
  return netstrings([
    'PCA_FAMILY_ENVELOPE_AAD_V1',
    ...validateMetadata(metadata),
    payloadKind,
    payloadKind === 'FDEK_WRAP' ? 'HPKE-0x0010-0x0001-0x0001' : 'CONTENT-0x0001',
    ...headerFields,
  ]);
}

/** HPKE setup info is a fixed domain separator; all variable metadata is in AAD. */
export function familyFdekHpkeInfo(metadata: CandidateEnvelopeMetadata): Uint8Array {
  validateMetadata(metadata);
  if (metadata.recipient.kind !== 'DEVICE') throw new PcaEnvelopeCryptoError();
  // @hpke/core documents a 128-byte info limit. Variable metadata is
  // authenticated in AAD; this is the fixed protocol domain separator.
  return encoder.encode('PCA_FDEK_HPKE_INFO_V1');
}

function suite(): CipherSuite {
  return new CipherSuite({
    kem: new DhkemP256HkdfSha256(),
    kdf: new HkdfSha256(),
    aead: new Aes128Gcm(),
  });
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function suiteIds(): Uint8Array {
  return Uint8Array.of(0x00, 0x10, 0x00, 0x01, 0x00, 0x01);
}

function assertCryptoKey(key: CryptoKey, type: 'public' | 'private'): void {
  if (key.type !== type || key.algorithm.name !== 'ECDH' ||
      !('namedCurve' in key.algorithm) || key.algorithm.namedCurve !== 'P-256') {
    throw new PcaEnvelopeCryptoError();
  }
  if (type === 'private' && key.extractable) throw new PcaEnvelopeCryptoError();
}

/** Sender-only public adapter. It accepts a recipient public key and never exports a private key. */
export async function sealFdekForDevice(
  metadata: CandidateEnvelopeMetadata,
  recipientPublicKey: CryptoKey,
  fdek: Uint8Array,
): Promise<Uint8Array> {
  let fdekCopy: Uint8Array | undefined;
  try {
    if (metadata.recipient.kind !== 'DEVICE' || metadata.messageType !== 'KEY_ROTATION' || fdek.length !== FDEK_BYTES) {
      throw new PcaEnvelopeCryptoError();
    }
    assertCryptoKey(recipientPublicKey, 'public');
    fdekCopy = fdek.slice();
    const aad = canonicalFamilyEnvelopeAad(metadata, 'FDEK_WRAP');
    const sealed = await suite().seal(
      { recipientPublicKey, info: familyFdekHpkeInfo(metadata) },
      fdekCopy,
      aad,
    );
    const enc = bytes(sealed.enc);
    const ciphertext = bytes(sealed.ct);
    if (enc.length !== HPKE_ENC_BYTES || ciphertext.length !== HPKE_FDEK_CIPHERTEXT_BYTES) {
      throw new PcaEnvelopeCryptoError();
    }
    return concat([MAGIC, Uint8Array.of(KEY_WRAP_KIND), suiteIds(), enc, ciphertext]);
  } catch {
    throw new PcaEnvelopeCryptoError();
  } finally {
    fdekCopy?.fill(0);
  }
}

/** Receiver/reference API for vector verification; production browser composition does not call it. */
export async function openFdekForDevice(
  metadata: CandidateEnvelopeMetadata,
  recipientKeys: CryptoKeyPair,
  payload: Uint8Array,
): Promise<Uint8Array> {
  try {
    if (metadata.recipient.kind !== 'DEVICE' || metadata.messageType !== 'KEY_ROTATION' || payload.length !== 128 || !hasPrefix(payload, MAGIC)) {
      throw new PcaEnvelopeCryptoError();
    }
    if (!recipientKeys || !recipientKeys.privateKey || !recipientKeys.publicKey) throw new PcaEnvelopeCryptoError();
    assertCryptoKey(recipientKeys.privateKey, 'private');
    assertCryptoKey(recipientKeys.publicKey, 'public');
    if (payload[8] !== KEY_WRAP_KIND || !equalBytes(payload.slice(9, 15), suiteIds())) {
      throw new PcaEnvelopeCryptoError();
    }
    const enc = payload.slice(15, 15 + HPKE_ENC_BYTES);
    const ciphertext = payload.slice(15 + HPKE_ENC_BYTES);
    const fdek = await suite().open(
      // Supplying the pair avoids asking the library to derive the public key
      // from the private key, which may be non-exportable in custody APIs.
      { recipientKey: recipientKeys, enc, info: familyFdekHpkeInfo(metadata) },
      ciphertext,
      canonicalFamilyEnvelopeAad(metadata, 'FDEK_WRAP'),
    );
    const output = new Uint8Array(fdek);
    if (output.length !== FDEK_BYTES) throw new PcaEnvelopeCryptoError();
    return output;
  } catch {
    throw new PcaEnvelopeCryptoError();
  }
}

function hasPrefix(value: Uint8Array, prefix: Uint8Array): boolean {
  return value.length >= prefix.length && equalBytes(value.slice(0, prefix.length), prefix);
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index++) difference |= left[index]! ^ right[index]!;
  return difference === 0;
}

function b64urlNoPadding(value: Uint8Array): string {
  let binary = '';
  for (const octet of value) binary += String.fromCharCode(octet);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

export function familyMessageKeyInfo(metadata: CandidateEnvelopeMetadata): Uint8Array {
  const fields = validateMetadata(metadata);
  return netstrings([
    'PCA_FAMILY_MESSAGE_KEY_INFO_V1', 'HKDF-SHA256/AES-128-GCM',
    ...fields,
  ]);
}

async function deriveContentKey(fdek: Uint8Array, salt: Uint8Array, info: Uint8Array): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', fdek, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt, info },
    base,
    { name: 'AES-GCM', length: 128 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** Encrypts one content envelope using a fresh HKDF salt and a single-use AES-GCM key. */
export async function sealFamilyContent(
  metadata: CandidateEnvelopeMetadata,
  fdek: Uint8Array,
  plaintext: Uint8Array,
): Promise<Uint8Array> {
  let fdekCopy: Uint8Array | undefined;
  let plaintextCopy: Uint8Array | undefined;
  try {
    if (fdek.length !== FDEK_BYTES || plaintext.length > MAX_CONTENT_PLAINTEXT_BYTES) {
      throw new PcaEnvelopeCryptoError();
    }
    fdekCopy = fdek.slice();
    plaintextCopy = plaintext.slice();
    const salt = crypto.getRandomValues(new Uint8Array(CONTENT_SALT_BYTES));
    const nonce = crypto.getRandomValues(new Uint8Array(CONTENT_NONCE_BYTES));
    const aad = canonicalFamilyEnvelopeAad(metadata, 'CONTENT', [b64urlNoPadding(salt), b64urlNoPadding(nonce)]);
    const key = await deriveContentKey(fdekCopy, salt, familyMessageKeyInfo(metadata));
    const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, additionalData: aad, tagLength: 128 }, key, plaintextCopy));
    const payload = concat([MAGIC, Uint8Array.of(CONTENT_KIND), Uint8Array.of(0x00, 0x01), salt, nonce, ciphertext]);
    if (payload.length > MAX_FAMILY_ENVELOPE_PAYLOAD_BYTES) throw new PcaEnvelopeCryptoError();
    return payload;
  } catch {
    throw new PcaEnvelopeCryptoError();
  } finally {
    fdekCopy?.fill(0);
    plaintextCopy?.fill(0);
  }
}

/** Opens a content envelope after the caller has verified DSK, scope, epochs, replay, and expiry. */
export async function openFamilyContent(
  metadata: CandidateEnvelopeMetadata,
  fdek: Uint8Array,
  payload: Uint8Array,
): Promise<Uint8Array> {
  let fdekCopy: Uint8Array | undefined;
  try {
    if (fdek.length !== FDEK_BYTES || payload.length < 71 || payload.length > MAX_FAMILY_ENVELOPE_PAYLOAD_BYTES ||
        !hasPrefix(payload, MAGIC) || payload[8] !== CONTENT_KIND || payload[9] !== 0 || payload[10] !== 1) {
      throw new PcaEnvelopeCryptoError();
    }
    const salt = payload.slice(11, 11 + CONTENT_SALT_BYTES);
    const nonce = payload.slice(11 + CONTENT_SALT_BYTES, 11 + CONTENT_SALT_BYTES + CONTENT_NONCE_BYTES);
    const ciphertext = payload.slice(11 + CONTENT_SALT_BYTES + CONTENT_NONCE_BYTES);
    if (ciphertext.length < CONTENT_TAG_BYTES || ciphertext.length > MAX_CONTENT_PLAINTEXT_BYTES + CONTENT_TAG_BYTES) {
      throw new PcaEnvelopeCryptoError();
    }
    fdekCopy = fdek.slice();
    const aad = canonicalFamilyEnvelopeAad(metadata, 'CONTENT', [b64urlNoPadding(salt), b64urlNoPadding(nonce)]);
    const key = await deriveContentKey(fdekCopy, salt, familyMessageKeyInfo(metadata));
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce, additionalData: aad, tagLength: 128 }, key, ciphertext));
  } catch {
    throw new PcaEnvelopeCryptoError();
  } finally {
    fdekCopy?.fill(0);
  }
}

export const FAMILY_E2EE_PROFILE_V1 = Object.freeze({
  protocolMajor: 1,
  protocolMinor: 0,
  hpkeKemId: HPKE_KEM_ID,
  hpkeKdfId: HPKE_KDF_ID,
  hpkeAeadId: HPKE_AEAD_ID,
  fdekBytes: FDEK_BYTES,
  hpkeEncBytes: HPKE_ENC_BYTES,
  hpkeFdekCiphertextBytes: HPKE_FDEK_CIPHERTEXT_BYTES,
  contentProfileId: CONTENT_PROFILE_ID,
  contentSaltBytes: CONTENT_SALT_BYTES,
  contentNonceBytes: CONTENT_NONCE_BYTES,
  contentTagBytes: CONTENT_TAG_BYTES,
  maxContentPlaintextBytes: MAX_CONTENT_PLAINTEXT_BYTES,
  maxFamilyEnvelopePayloadBytes: MAX_FAMILY_ENVELOPE_PAYLOAD_BYTES,
  maxEnvelopeTtlMs: MAX_ENVELOPE_TTL_MS,
});
