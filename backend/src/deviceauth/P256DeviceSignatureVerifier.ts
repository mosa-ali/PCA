import { createPublicKey, verify as cryptoVerify, type KeyObject } from 'node:crypto';
import type { DeviceSignatureVerifier } from './DeviceSignatureVerifier.js';

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
    return strictBase64Url(value).length === 64;
  } catch {
    return false;
  }
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

function toBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}
