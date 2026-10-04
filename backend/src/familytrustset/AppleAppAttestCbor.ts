/**
 * Wave 6D: a strict, bounded, dependency-free CBOR reader for the two
 * CBOR structures App Attest produces (the attestation object and the
 * assertion object). This is deliberately NOT a general CBOR library:
 * it supports exactly the shape Apple's encoder emits for those two
 * objects -- definite-length items only, text-string map keys only,
 * integers/byte-strings/text-strings/arrays/maps/simple values -- and
 * rejects everything else in both directions (no throw: parse failures
 * return null, and every caller treats null as REJECTED).
 *
 * STRICTNESS RULES (each one is a behavioral kill target):
 *  - definite lengths only: additional-information 31 (indefinite) is
 *    rejected for byte strings, text strings, arrays and maps;
 *  - minimal length encoding: a value encoded in a longer form than
 *    RFC 8949 canonical form requires is rejected (e.g. 0x18 0x05);
 *  - map keys are text strings only, and duplicate keys are rejected;
 *  - no tags (major 6), no floats, no undefined (0xF7);
 *  - bounded: input byte cap, item-count cap and nesting-depth cap are
 *    enforced while decoding; an item that does not consume its exact
 *    declared extent is rejected.
 */

export type CborMap = { readonly [key: string]: CborValue };
export type CborValue =
  | number
  | Uint8Array
  | string
  | CborValue[]
  | CborMap
  | boolean
  | null;

export interface CborLimits {
  readonly maxDepth: number;
  readonly maxItems: number;
}

export const DEFAULT_CBOR_LIMITS: CborLimits = { maxDepth: 8, maxItems: 4096 };

interface DecoderState {
  readonly input: Buffer;
  offset: number;
  items: number;
  readonly limits: CborLimits;
}

function readLength(state: DecoderState, additional: number): number | null {
  // The RFC 8949 additional-information table. 24..27 are the extended
  // forms; 28..30 are unassigned; 31 is indefinite.
  if (additional < 24) return additional;
  if (additional === 24) {
    if (state.offset + 1 > state.input.length) return null;
    const value = state.input[state.offset];
    if (value < 24) return null; // non-minimal
    state.offset += 1;
    return value;
  }
  if (additional === 25) {
    if (state.offset + 2 > state.input.length) return null;
    const value = state.input.readUInt16BE(state.offset);
    if (value <= 0xff) return null; // non-minimal
    state.offset += 2;
    return value;
  }
  if (additional === 26) {
    if (state.offset + 4 > state.input.length) return null;
    const value = state.input.readUInt32BE(state.offset);
    if (value <= 0xffff) return null; // non-minimal
    state.offset += 4;
    return value;
  }
  // additional 27 (64-bit lengths) is intentionally unsupported: no
  // App Attest structure needs it, and every oversize input is rejected
  // long before this point by the caller's byte caps.
  return null;
}

function decodeItem(state: DecoderState, depth: number): CborValue | undefined {
  if (depth > state.limits.maxDepth) return undefined;
  state.items += 1;
  if (state.items > state.limits.maxItems) return undefined;
  if (state.offset >= state.input.length) return undefined;
  const initial = state.input[state.offset];
  state.offset += 1;
  const major = initial >> 5;
  const additional = initial & 0x1f;

  switch (major) {
    case 0: {
      const value = readLength(state, additional);
      return value === null ? undefined : value;
    }
    case 1:
      // Negative integers are not part of the App Attest shape.
      return undefined;
    case 2: {
      const length = readLength(state, additional);
      if (length === null) return undefined;
      if (state.offset + length > state.input.length) return undefined;
      const bytes = state.input.subarray(state.offset, state.offset + length);
      state.offset += length;
      return new Uint8Array(bytes);
    }
    case 3: {
      const length = readLength(state, additional);
      if (length === null) return undefined;
      if (state.offset + length > state.input.length) return undefined;
      const bytes = state.input.subarray(state.offset, state.offset + length);
      state.offset += length;
      const text = bytes.toString('utf8');
      // Reject any byte sequence that is not valid UTF-8 (Buffer decoding
      // replaces invalid sequences with U+FFFD, which round-trips wrong).
      if (Buffer.from(text, 'utf8').length !== bytes.length) return undefined;
      return text;
    }
    case 4: {
      const length = readLength(state, additional);
      if (length === null) return undefined;
      const items: CborValue[] = [];
      for (let index = 0; index < length; index += 1) {
        const item = decodeItem(state, depth + 1);
        if (item === undefined) return undefined;
        items.push(item);
      }
      return items;
    }
    case 5: {
      const length = readLength(state, additional);
      if (length === null) return undefined;
      const map: Record<string, CborValue> = {};
      for (let index = 0; index < length; index += 1) {
        const key = decodeItem(state, depth + 1);
        if (typeof key !== 'string') return undefined;
        if (Object.prototype.hasOwnProperty.call(map, key)) return undefined; // duplicate key
        const value = decodeItem(state, depth + 1);
        if (value === undefined) return undefined;
        map[key] = value;
      }
      return map;
    }
    case 7: {
      if (additional === 20) return false;
      if (additional === 21) return true;
      if (additional === 22) return null;
      return undefined;
    }
    default:
      // Major 6 (tags) and everything else.
      return undefined;
  }
}

/**
 * Decodes exactly ONE CBOR item that must consume the ENTIRE input.
 * Returns null on any deviation (including trailing bytes).
 */
export function decodeStrictCbor(input: Buffer, limits: CborLimits = DEFAULT_CBOR_LIMITS): CborValue | null {
  if (!Buffer.isBuffer(input) || input.length === 0) return null;
  const state: DecoderState = { input, offset: 0, items: 0, limits };
  const value = decodeItem(state, 0);
  if (value === undefined) return null;
  if (state.offset !== input.length) return null;
  return value;
}

/** True for a plain (non-array, non-null) CBOR map. */
export function isCborMap(value: CborValue | null): value is CborMap {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Uint8Array);
}
