import { createPublicKey, verify as cryptoVerify, type KeyObject } from 'node:crypto';
import type { DeviceSignatureVerifier } from './DeviceSignatureVerifier.js';

/** SEC1/P-256 group order from SEC 2, section 2.4.2. */
export const P256_ORDER = BigInt('0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551');
export const P256_HALF_ORDER = P256_ORDER / 2n;

/**
 * R1 source-only verifier for the existing browser/native key contract.
 *
 * Wire format is deliberately narrow: SEC1 uncompressed P-256 public point
 * (`0x04 || x || y`, exactly 65 bytes) and Web Crypto ECDSA SHA-256
 * IEEE-P1363 signatures (exactly 64 bytes), both unpadded base64url. This
 * class is not production-wired until PCA-DEC-020 receives independent human
 * cryptographic approval.
 */
export class P256DeviceSignatureVerifier implements DeviceSignatureVerifier {
  async verify(publicKey: string, message: string, signature: string): Promise<boolean> {
    try {
      const publicKeyBytes = strictBase64Url(publicKey);
      const signatureBytes = strictBase64Url(signature);
      if (publicKeyBytes.length !== 65 || publicKeyBytes[0] !== 0x04 || signatureBytes.length !== 64) return false;
      if (!isCanonicalP256SignatureBytes(signatureBytes)) return false;

      const keyObject = createP256PublicKey(publicKeyBytes);
      return cryptoVerify(
        'sha256',
        Buffer.from(message, 'utf8'),
        { key: keyObject, dsaEncoding: 'ieee-p1363' },
        signatureBytes,
      );
    } catch {
      return false;
    }
  }
}

export function isCanonicalP256PublicKey(value: unknown): value is string {
  try {
    const bytes = strictBase64Url(value);
    return bytes.length === 65 && bytes[0] === 0x04;
  } catch {
    return false;
  }
}

export function isCanonicalP256Signature(value: unknown): value is string {
  try {
    return isCanonicalP256SignatureBytes(strictBase64Url(value));
  } catch {
    return false;
  }
}

export function isCanonicalBase64Url(value: unknown, expectedBytes?: number): value is string {
  try {
    const decoded = strictBase64Url(value);
    return expectedBytes === undefined || decoded.length === expectedBytes;
  } catch {
    return false;
  }
}

/** Returns a low-S IEEE-P1363 signature, preserving the fixed 64-byte wire shape. */
export function canonicalizeP256Signature(signature: Uint8Array): Buffer {
  if (signature.length !== 64) throw new Error('invalid_p256_signature_length');
  const r = BigInt(`0x${Buffer.from(signature.subarray(0, 32)).toString('hex')}`);
  const s = BigInt(`0x${Buffer.from(signature.subarray(32, 64)).toString('hex')}`);
  if (r < 1n || r >= P256_ORDER || s < 1n || s >= P256_ORDER) throw new Error('invalid_p256_signature_scalar');
  const lowS = s > P256_HALF_ORDER ? P256_ORDER - s : s;
  const output = Buffer.alloc(64);
  Buffer.from(r.toString(16).padStart(64, '0'), 'hex').copy(output, 0);
  Buffer.from(lowS.toString(16).padStart(64, '0'), 'hex').copy(output, 32);
  return output;
}

export function createP256PublicKey(publicKeyBytes: Uint8Array): KeyObject {
  if (publicKeyBytes.length !== 65 || publicKeyBytes[0] !== 0x04) throw new Error('invalid_p256_public_key');
  const x = toBase64Url(publicKeyBytes.slice(1, 33));
  const y = toBase64Url(publicKeyBytes.slice(33, 65));
  return createPublicKey({
    key: { kty: 'EC', crv: 'P-256', x, y },
    format: 'jwk',
  });
}

export function strictBase64Url(value: unknown): Buffer {
  if (typeof value !== 'string' || value.length === 0 || !/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1) {
    throw new Error('invalid_base64url');
  }
  const bytes = Buffer.from(value, 'base64url');
  if (bytes.toString('base64url') !== value) throw new Error('noncanonical_base64url');
  return bytes;
}

function isCanonicalP256SignatureBytes(signature: Uint8Array): boolean {
  if (signature.length !== 64) return false;
  const r = BigInt(`0x${Buffer.from(signature.subarray(0, 32)).toString('hex')}`);
  const s = BigInt(`0x${Buffer.from(signature.subarray(32, 64)).toString('hex')}`);
  return r >= 1n && r < P256_ORDER && s >= 1n && s <= P256_HALF_ORDER;
}

function toBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}
