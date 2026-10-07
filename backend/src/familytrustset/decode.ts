import {
  isDistinctKeyPair,
  isPlausibleEntryStatus,
  isPlausibleEpochNumber,
  isPlausibleFamilyRole,
  isPlausibleKeyEpoch,
  isPlausibleOpaqueId,
  isWellFormedUnicode,
  MAX_ENTRIES_PER_EPOCH,
} from './policy.js';
import type { FamilyTrustSetEntry, FamilyTrustSetEpoch } from './types.js';

/**
 * Canonical decimal form shared by length prefixes and integer field tokens:
 * digits only, no leading zeros -- exactly what String(n) emits for the
 * non-negative integers canonicalize.ts encodes.
 */
const CANONICAL_INTEGER_PATTERN = /^(0|[1-9][0-9]*)$/;
const COLON_CHAR_CODE = 0x3a;

/**
 * Defensive ceiling on the raw input length, in characters (UTF-16 code
 * units). The largest structurally admissible epoch -- 64 entries x 7
 * fields, each id bounded by policy.ts's MAX_OPAQUE_ID_LENGTH of 128
 * characters, plus framing and the fixed numeric/date fields -- stays well
 * under 64 KB; this rejects a malformed or abusive blob before any field
 * parsing work happens.
 */
export const MAX_CANONICAL_TRUST_SET_LENGTH = 262144;

/**
 * Thrown for ANY structural deviation from the canonical byte grammar.
 * Deliberately carries no field-level detail (matching parse.ts's
 * anti-oracle rationale): a caller learns only that the bytes are not a
 * canonical trust-set epoch.
 */
export class TrustSetEpochDecodeError extends Error {
  readonly code: 'MALFORMED_CANONICAL_BYTES' = 'MALFORMED_CANONICAL_BYTES';

  constructor() {
    super('malformed_canonical_trust_set_bytes');
    this.name = 'TrustSetEpochDecodeError';
  }
}

/** Raw transport bytes must be strict UTF-8, never Node's replacement-based Buffer.toString decoding. */
export function decodeCanonicalTrustSetEpochBytes(bytes: Uint8Array): FamilyTrustSetEpoch {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength > MAX_CANONICAL_TRUST_SET_LENGTH * 3) throw new TrustSetEpochDecodeError();
  try {
    // Preserve a BOM as an actual scalar: a leading BOM is not canonical framing.
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    return decodeCanonicalTrustSetEpoch(text);
  } catch {
    throw new TrustSetEpochDecodeError();
  }
}

/**
 * Strict inverse of canonicalizeTrustSetEpoch (canonicalize.ts): parses the
 * exact netstring-style, UTF-8-byte-length-prefixed byte string that
 * canonicalize emits back into a typed FamilyTrustSetEpoch.
 *
 * This is the READ counterpart of canonicalize.ts: it is used to recover an
 * epoch's fields -- e.g. to resolve roles -- from the canonical bytes a
 * device has STORED for an already-accepted epoch, and to re-derive the
 * exact signable string for signature verification. It NEVER verifies
 * signatures itself -- that is exclusively the injected
 * TrustSetSignatureVerifier's job (FamilyTrustSetEngine.acceptEpoch); a
 * decoded epoch must still pass that verifier (and the engine's semantic
 * checks) before it may replace any stored trust set.
 *
 * Field count and order mirror canonicalize.ts byte-for-byte: familyId,
 * trustSetEpoch, keyEpoch, entries.length, then 7 fields per entry
 * (deviceId, role, dskKeyId, dskPublicKey, dekKeyId, dekPublicKey,
 * status), then issuedAt (exact ISO), then supersedesEpoch (the literal
 * `null` token, or a canonical integer). Every `${byteLength}:` prefix must
 * be the canonical decimal form of the UTF-8 byte length of the field
 * actually consumed (no leading zeros; a prefix that cannot land on a code
 * point boundary is rejected), the entry count must complete exactly, and
 * the input must be fully consumed with NO trailing bytes.
 *
 * In addition to framing, decoded values are held to the same domain
 * parse.ts enforces on the wire (opaque ids 1..MAX_OPAQUE_ID_LENGTH chars,
 * known roles/statuses, distinct DSK/DEK per entry, trustSetEpoch >= 1,
 * keyEpoch >= 0, 1..MAX_ENTRIES_PER_EPOCH entries, supersedesEpoch null or
 * a plausible epoch number), so this is the exact inverse over the
 * parse.ts-admissible domain. canonicalize will happily ENCODE objects
 * outside that domain (it is deliberately a pure encoder); decode rejects
 * such bytes rather than resurrecting an epoch that could never have passed
 * wire validation. Any deviation throws TrustSetEpochDecodeError.
 *
 * The returned `signature` is always the empty string: the canonical bytes
 * by definition EXCLUDE the signature (canonicalize.ts never encodes it),
 * so there is no signature to decode. This is intentional and fail-closed:
 * a decoded object is never acceptable to FamilyTrustSetEngine.acceptEpoch
 * as-is (verifying an empty signature can only fail). A caller must
 * re-attach the signature from the stored envelope before attempting
 * acceptance.
 */
export function decodeCanonicalTrustSetEpoch(canonicalBytes: string): FamilyTrustSetEpoch {
  if (typeof canonicalBytes !== 'string' || canonicalBytes.length > MAX_CANONICAL_TRUST_SET_LENGTH || !isWellFormedUnicode(canonicalBytes)) {
    throw new TrustSetEpochDecodeError();
  }

  let cursor = 0;

  const familyIdField = readNetstringField(canonicalBytes, cursor);
  cursor = familyIdField.next;
  const familyId = familyIdField.field;
  if (!isPlausibleOpaqueId(familyId)) throw new TrustSetEpochDecodeError();

  const trustSetEpochField = readNetstringField(canonicalBytes, cursor);
  cursor = trustSetEpochField.next;
  const trustSetEpoch = parseCanonicalIntegerToken(trustSetEpochField.field);
  if (trustSetEpoch === null || !isPlausibleEpochNumber(trustSetEpoch)) throw new TrustSetEpochDecodeError();

  const keyEpochField = readNetstringField(canonicalBytes, cursor);
  cursor = keyEpochField.next;
  const keyEpoch = parseCanonicalIntegerToken(keyEpochField.field);
  if (keyEpoch === null || !isPlausibleKeyEpoch(keyEpoch)) throw new TrustSetEpochDecodeError();

  const entryCountField = readNetstringField(canonicalBytes, cursor);
  cursor = entryCountField.next;
  const entryCount = parseCanonicalIntegerToken(entryCountField.field);
  if (entryCount === null || entryCount < 1 || entryCount > MAX_ENTRIES_PER_EPOCH) {
    throw new TrustSetEpochDecodeError();
  }

  const entries: FamilyTrustSetEntry[] = [];
  for (let index = 0; index < entryCount; index += 1) {
    const deviceIdField = readNetstringField(canonicalBytes, cursor);
    cursor = deviceIdField.next;
    const roleField = readNetstringField(canonicalBytes, cursor);
    cursor = roleField.next;
    const dskKeyIdField = readNetstringField(canonicalBytes, cursor);
    cursor = dskKeyIdField.next;
    const dskPublicKeyField = readNetstringField(canonicalBytes, cursor);
    cursor = dskPublicKeyField.next;
    const dekKeyIdField = readNetstringField(canonicalBytes, cursor);
    cursor = dekKeyIdField.next;
    const dekPublicKeyField = readNetstringField(canonicalBytes, cursor);
    cursor = dekPublicKeyField.next;
    const statusField = readNetstringField(canonicalBytes, cursor);
    cursor = statusField.next;

    if (!isPlausibleOpaqueId(deviceIdField.field)) throw new TrustSetEpochDecodeError();
    if (!isPlausibleFamilyRole(roleField.field)) throw new TrustSetEpochDecodeError();
    if (!isPlausibleOpaqueId(dskKeyIdField.field)) throw new TrustSetEpochDecodeError();
    if (!isPlausibleOpaqueId(dskPublicKeyField.field)) throw new TrustSetEpochDecodeError();
    if (!isPlausibleOpaqueId(dekKeyIdField.field)) throw new TrustSetEpochDecodeError();
    if (!isPlausibleOpaqueId(dekPublicKeyField.field)) throw new TrustSetEpochDecodeError();
    if (!isPlausibleEntryStatus(statusField.field)) throw new TrustSetEpochDecodeError();
    if (!isDistinctKeyPair(dskPublicKeyField.field, dekPublicKeyField.field)) throw new TrustSetEpochDecodeError();

    entries.push({
      deviceId: deviceIdField.field,
      role: roleField.field as FamilyTrustSetEntry['role'],
      dskKeyId: dskKeyIdField.field,
      dskPublicKey: dskPublicKeyField.field,
      dekKeyId: dekKeyIdField.field,
      dekPublicKey: dekPublicKeyField.field,
      status: statusField.field as FamilyTrustSetEntry['status'],
    });
  }

  const issuedAtField = readNetstringField(canonicalBytes, cursor);
  cursor = issuedAtField.next;
  const issuedAt = parseExactIsoDate(issuedAtField.field);
  if (!issuedAt) throw new TrustSetEpochDecodeError();

  const supersedesField = readNetstringField(canonicalBytes, cursor);
  cursor = supersedesField.next;
  let supersedesEpoch: number | null = null;
  if (supersedesField.field !== 'null') {
    const supersedes = parseCanonicalIntegerToken(supersedesField.field);
    if (supersedes === null || !isPlausibleEpochNumber(supersedes)) throw new TrustSetEpochDecodeError();
    supersedesEpoch = supersedes;
  }

  if (cursor !== canonicalBytes.length) throw new TrustSetEpochDecodeError();

  return {
    familyId,
    trustSetEpoch,
    keyEpoch,
    entries,
    issuedAt,
    supersedesEpoch,
    signature: '',
  };
}

interface FieldReadResult {
  readonly field: string;
  readonly next: number;
}

/**
 * Reads one `${byteLength}:${field}` netstring at `start`, requiring the
 * prefix to equal the UTF-8 byte length of exactly the characters consumed
 * for the field. Multi-byte code points count their full UTF-8 width
 * (mirroring Buffer.byteLength, which canonicalize.ts uses); a prefix that
 * cannot land on a code point boundary -- falling short at end of input, or
 * overshooting by straddling one character too far -- is rejected, which is
 * also what catches cross-field misalignment introduced by a corrupted
 * prefix.
 */
function readNetstringField(input: string, start: number): FieldReadResult {
  let cursor = start;
  while (cursor < input.length && isAsciiDigit(input.charCodeAt(cursor))) cursor += 1;
  if (cursor === start) throw new TrustSetEpochDecodeError();
  if (cursor >= input.length || input.charCodeAt(cursor) !== COLON_CHAR_CODE) throw new TrustSetEpochDecodeError();

  const prefix = input.slice(start, cursor);
  if (!CANONICAL_INTEGER_PATTERN.test(prefix)) throw new TrustSetEpochDecodeError();
  const declaredLength = Number(prefix);
  if (!Number.isSafeInteger(declaredLength)) throw new TrustSetEpochDecodeError();
  cursor += 1;

  const fieldStart = cursor;
  let consumedBytes = 0;
  while (consumedBytes < declaredLength) {
    if (cursor >= input.length) throw new TrustSetEpochDecodeError();
    const codePoint = input.codePointAt(cursor);
    if (codePoint === undefined) throw new TrustSetEpochDecodeError();
    consumedBytes += utf8ByteLengthOfCodePoint(codePoint);
    cursor += codePoint > 0xffff ? 2 : 1;
  }
  if (consumedBytes !== declaredLength) throw new TrustSetEpochDecodeError();

  const field = input.slice(fieldStart, cursor);
  if (Buffer.byteLength(field, 'utf8') !== declaredLength) throw new TrustSetEpochDecodeError();
  return { field, next: cursor };
}

/** Parses the canonical decimal token of an integer field; null for anything else (including non-canonical forms like '01' or unsafe magnitudes). */
function parseCanonicalIntegerToken(token: string): number | null {
  if (!CANONICAL_INTEGER_PATTERN.test(token)) return null;
  const value = Number(token);
  return Number.isSafeInteger(value) ? value : null;
}

/** Same exact-ISO round-trip gate parse.ts applies on the wire. */
function parseExactIsoDate(token: string): Date | null {
  const parsed = new Date(token);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString() === token ? parsed : null;
}

function isAsciiDigit(code: number): boolean {
  return code >= 0x30 && code <= 0x39;
}

function utf8ByteLengthOfCodePoint(codePoint: number): number {
  if (codePoint < 0x80) return 1;
  if (codePoint < 0x800) return 2;
  if (codePoint < 0x10000) return 3;
  return 4;
}
