import type { X509Certificate } from 'node:crypto';

/**
 * Wave 6D: extraction of the App Attest attestation nonce from the
 * credential certificate (credCert). Apple places
 *   nonce = SHA-256(authData_1 || clientDataHash_1)
 * in the certificate extension OID 1.2.840.113635.100.8.2, whose DER
 * encoding is exactly:
 *
 *   extnValue OCTET STRING {
 *     SEQUENCE {
 *       [1] EXPLICIT {
 *         OCTET STRING (32 bytes)   <- the nonce
 *       }
 *     }
 *   }
 *
 * This module performs a bounded, total, strictly-shaped extraction: it
 * locates the extension OID inside the certificate DER, parses the OCTET
 * STRING that follows (with or without the optional critical BOOLEAN),
 * then walks the inner structure requiring exactly one SEQUENCE holding
 * exactly one [1] EXPLICIT wrapper holding exactly one 32-byte OCTET
 * STRING, with full consumption at every level. Any deviation returns
 * null (callers treat null as REJECTED); the module never throws.
 *
 * The OID search is byte-exact on the full DER TLV of the OID
 * (`06 09 2A 86 48 86 F7 63 64 08 02`). A stray match inside signature
 * bytes is cryptographically negligible (2^-88 for a random 11-byte
 * sequence) AND harmless: a false positive would simply fail the strict
 * shape parse and yield null -- only a byte-exact, correctly structured
 * extension can ever produce a nonce, and the caller always compares that
 * nonce against an independently computed SHA-256 value.
 */

const NONCE_EXTENSION_OID_TLV = Buffer.from('06092a864886f763640802', 'hex');
const OCTET_STRING_TAG = 0x04;
const SEQUENCE_TAG = 0x30;
const CONTEXT_1_TAG = 0xa1;
const EXACT_NONCE_BYTES = 32;

interface DerReader {
  readonly buffer: Buffer;
  offset: number;
}

function readTagAndLength(reader: DerReader): { tag: number; length: number } | null {
  if (reader.offset + 2 > reader.buffer.length) return null;
  const tag = reader.buffer[reader.offset];
  reader.offset += 1;
  const first = reader.buffer[reader.offset];
  reader.offset += 1;
  if (first < 0x80) return { tag, length: first };
  const count = first & 0x7f;
  if (count < 1 || count > 2) return null; // bounded: no >64KB extension content
  if (reader.offset + count > reader.buffer.length) return null;
  let length = 0;
  for (let index = 0; index < count; index += 1) {
    length = (length << 8) | reader.buffer[reader.offset + index];
  }
  reader.offset += count;
  return { tag, length };
}

function readExactItem(reader: DerReader, expectedTag: number): Buffer | null {
  const header = readTagAndLength(reader);
  if (header === null || header.tag !== expectedTag) return null;
  if (reader.offset + header.length > reader.buffer.length) return null;
  const content = reader.buffer.subarray(reader.offset, reader.offset + header.length);
  reader.offset += header.length;
  return content;
}

/**
 * Extracts the 32-byte App Attest nonce from one credential certificate.
 * Returns null on any deviation; never throws.
 */
export function extractAppAttestNonce(certificate: X509Certificate): Buffer | null {
  try {
    const der = Buffer.from(certificate.raw);
    const oidIndex = der.indexOf(NONCE_EXTENSION_OID_TLV);
    if (oidIndex < 0 || oidIndex + NONCE_EXTENSION_OID_TLV.length >= der.length) return null;

    // After the OID: an optional critical BOOLEAN (01 01 FF), then the
    // extnValue OCTET STRING.
    const afterOid = der.subarray(oidIndex + NONCE_EXTENSION_OID_TLV.length);
    let start = 0;
    if (afterOid.length >= 3 && afterOid[0] === 0x01) {
      if (afterOid[1] !== 0x01 || afterOid[2] !== 0xff) return null;
      start = 3;
    }
    const valueReader: DerReader = { buffer: afterOid, offset: start };
    const extnValue = readExactItem(valueReader, OCTET_STRING_TAG);
    if (extnValue === null) return null;

    const sequenceReader: DerReader = { buffer: extnValue, offset: 0 };
    const sequence = readExactItem(sequenceReader, SEQUENCE_TAG);
    if (sequence === null || sequenceReader.offset !== extnValue.length) return null;

    const contextReader: DerReader = { buffer: sequence, offset: 0 };
    const context = readExactItem(contextReader, CONTEXT_1_TAG);
    if (context === null || contextReader.offset !== sequence.length) return null;

    const nonceReader: DerReader = { buffer: context, offset: 0 };
    const nonce = readExactItem(nonceReader, OCTET_STRING_TAG);
    if (nonce === null || nonceReader.offset !== context.length) return null;
    if (nonce.length !== EXACT_NONCE_BYTES) return null;
    return Buffer.from(nonce);
  } catch {
    return null;
  }
}
