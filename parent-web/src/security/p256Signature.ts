const P256_ORDER = BigInt('0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551');
const P256_HALF_ORDER = P256_ORDER / 2n;

/**
 * WebCrypto/native adapters must return the fixed-width IEEE-P1363 form.
 * Only scalar parsing and comparison is performed here; no curve arithmetic.
 */
export function canonicalizeP256Signature(signature: ArrayBuffer): ArrayBuffer {
  const input = new Uint8Array(signature);
  if (input.length !== 64) throw new Error('invalid_p256_signature_length');
  const r = BigInt(`0x${toHex(input.subarray(0, 32))}`);
  const s = BigInt(`0x${toHex(input.subarray(32, 64))}`);
  if (r < 1n || r >= P256_ORDER || s < 1n || s >= P256_ORDER) throw new Error('invalid_p256_signature_scalar');
  const lowS = s > P256_HALF_ORDER ? P256_ORDER - s : s;
  const output = new Uint8Array(64);
  output.set(input.subarray(0, 32), 0);
  output.set(fromHex(lowS.toString(16).padStart(64, '0')), 32);
  return output.buffer;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function fromHex(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  return bytes;
}

export function isStrictCanonicalBase64Url(value: unknown, expectedBytes: number): value is string {
  if (typeof value !== 'string' || value.length === 0 || !/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1) return false;
  try {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
    const binary = atob(normalized);
    if (binary.length !== expectedBytes) return false;
    let roundTrip = '';
    for (let index = 0; index < binary.length; index += 1) roundTrip += String.fromCharCode(binary.charCodeAt(index));
    const encoded = btoa(roundTrip).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    return encoded === value;
  } catch {
    return false;
  }
}
