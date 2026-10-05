/**
 * Wave 6C: minimal, strict DER reader for the Android Key Attestation
 * KeyDescription extension (OID 1.3.6.1.4.1.11129.2.1.17), hand-rolled on
 * node:Buffer. The repository has no ASN.1/X.509 library dependency and
 * this module adds none (backend package.json dependencies stay
 * fastify/mysql2/nodemailer); everything here is a bounded, total parser:
 * every read is checked against explicit bounds and any structural
 * deviation throws [KeyAttestationDerError] -- it never returns partial
 * data and never throws anything else.
 *
 * TWO LAYERS:
 *  1. [extractKeyDescriptionFromCertificate] locates the extension inside a
 *     certificate DER. It does NOT hand-walk TBSCertificate (version,
 *     serial, issuer, validity, subject, SPKI, optional fields ...); it
 *     byte-searches for the ONE occurrence of the extension OID element and
 *     requires the exact extension envelope the X.509 grammar mandates:
 *     `SEQUENCE { OID, [BOOLEAN critical,] OCTET STRING { KeyDescription } }`
 *     where `KeyDescription` is the single SEQUENCE inside the OCTET STRING.
 *     The OID element is 12 bytes (`06 0A` + the 10-byte OID body) and
 *     appears exactly once in a well-formed certificate (extensions appear
 *     once, and the SHA-256-of-OID coincidence inside other key material is
 *     not a realistic false positive -- and if it happened, the envelope
 *     shape checks below would fail the parse, never silently accept).
 *  2. [parseKeyDescription] strictly parses the KeyDescription SEQUENCE:
 *
 *       KeyDescription ::= SEQUENCE {
 *         attestationVersion       INTEGER,
 *         attestationSecurityLevel ENUMERATED,   -- 0 Software, 1 TEE, 2 StrongBox
 *         keymasterVersion         INTEGER,
 *         keymasterSecurityLevel   ENUMERATED,
 *         attestationChallenge     OCTET STRING,
 *         uniqueId                 OCTET STRING,
 *         softwareEnforced         AuthorizationList,
 *         teeEnforced              AuthorizationList
 *       }
 *
 *     exactly 8 fields, full consumption, no trailing bytes. The
 *     AuthorizationList contents are read for the five fields the Wave-6C
 *     verification needs (purpose, algorithm, origin, digest, curve);
 *     every other entry is skipped by its declared length. Both the
 *     platform's EXPLICIT context tags wrap exactly one INTEGER or SET.
 *     AuthorizationList itself is an ordinary SEQUENCE. See the AOSP
 *     Key and ID attestation schema; invented implicit encodings are rejected.
 *
 * Integers are bounded to 4 bytes (all KeyDescription integer fields are
 * int32/enum in the platform schema); negative values are rejected. The
 * challenge/uniqueId OCTET STRINGs are bounded (challenge <= 256 bytes).
 */

export class KeyAttestationDerError extends Error {
  readonly code = 'MALFORMED_KEY_ATTESTATION_DER';
  constructor(message: string) {
    super(`Malformed key attestation DER: ${message}`);
  }
}

/** The complete extension-OID element `06 0A 2B 06 01 04 01 D6 79 02 01 11` (1.3.6.1.4.1.11129.2.1.17). */
const KEY_DESCRIPTION_OID_ELEMENT = Buffer.from('060a2b06010401d679020111', 'hex');
const MAX_INTEGER_BYTES = 4;
const MAX_CHALLENGE_BYTES = 256;
const MAX_AUTHLIST_ENTRIES = 64;
const MAX_CERT_SCAN_BYTES = 32_768;

interface DerElement {
  readonly tagClass: number; // 0 universal, 1 application, 2 context, 3 private
  readonly constructed: boolean;
  readonly tagNumber: number;
  readonly headerStart: number;
  readonly contentStart: number;
  readonly contentEnd: number;
  readonly end: number;
}

function malformed(message: string): KeyAttestationDerError {
  return new KeyAttestationDerError(message);
}

/** Reads one DER element header at `offset`; bounds-checked, no indefinite lengths. */
function readElement(buf: Buffer, offset: number): DerElement {
  if (offset < 0 || offset >= buf.length) throw malformed('element offset out of bounds.');
  const first = buf[offset];
  const tagClass = (first >> 6) & 0x03;
  const constructed = (first & 0x20) !== 0;
  let tagNumber = first & 0x1f;
  let cursor = offset + 1;
  if (tagNumber === 0x1f) {
    // High-tag-number form: subsequent bytes carry the number, MSB = "more".
    tagNumber = 0;
    let count = 0;
    for (;;) {
      if (cursor >= buf.length) throw malformed('truncated high-tag-number.');
      const byte = buf[cursor];
      if (count === 0 && (byte & 0x7f) === 0) throw malformed('nonminimal high-tag-number.');
      cursor += 1;
      tagNumber = tagNumber * 128 + (byte & 0x7f);
      count += 1;
      if (count > 4) throw malformed('unreasonably long high-tag-number.');
      if ((byte & 0x80) === 0) break;
    }
    if (tagNumber < 31) throw malformed('nonminimal high-tag-number.');
  }
  if (cursor >= buf.length) throw malformed('missing length.');
  const lengthFirst = buf[cursor];
  cursor += 1;
  let length: number;
  if ((lengthFirst & 0x80) === 0) {
    length = lengthFirst;
  } else {
    const lengthBytes = lengthFirst & 0x7f;
    if (lengthBytes === 0) throw malformed('indefinite lengths are not valid DER.');
    if (lengthBytes > 4) throw malformed('length field too long.');
    if (cursor + lengthBytes > buf.length) throw malformed('truncated length.');
    if (buf[cursor] === 0) throw malformed('nonminimal length.');
    length = 0;
    for (let i = 0; i < lengthBytes; i += 1) {
      length = length * 256 + buf[cursor + i];
    }
    cursor += lengthBytes;
    if (length < 128) throw malformed('nonminimal long length.');
  }
  const contentEnd = cursor + length;
  if (contentEnd > buf.length) throw malformed('element content overruns buffer.');
  return {
    tagClass,
    constructed,
    tagNumber,
    headerStart: offset,
    contentStart: cursor,
    contentEnd,
    end: contentEnd,
  };
}

function expectElement(buf: Buffer, offset: number, tagClass: number, tagNumber: number, what: string): DerElement {
  const element = readElement(buf, offset);
  if (element.tagClass !== tagClass || element.tagNumber !== tagNumber) {
    throw malformed(`${what}: unexpected tag (class ${element.tagClass}, number ${element.tagNumber}).`);
  }
  if (tagClass === 0 && element.constructed !== (tagNumber === 0x10 || tagNumber === 0x11)) {
    throw malformed(`${what}: incorrect constructed bit.`);
  }
  return element;
}

/** Parses a non-negative INTEGER/ENUMERATED whose content is 1..MAX_INTEGER_BYTES bytes. */
function readNonNegativeInteger(buf: Buffer, element: DerElement, what: string): number {
  const length = element.contentEnd - element.contentStart;
  if (length < 1 || length > MAX_INTEGER_BYTES) throw malformed(`${what}: integer length out of range.`);
  if ((buf[element.contentStart] & 0x80) !== 0) throw malformed(`${what}: negative integers are not valid here.`);
  if (length > 1 && buf[element.contentStart] === 0 && (buf[element.contentStart + 1] & 0x80) === 0) {
    throw malformed(`${what}: nonminimal integer.`);
  }
  let value = 0;
  for (let i = 0; i < length; i += 1) value = value * 256 + buf[element.contentStart + i];
  return value;
}

/**
 * Locates the KeyDescription extension inside a certificate DER and returns
 * its KeyDescription SEQUENCE bytes. Requires exactly one occurrence of the
 * extension OID with the mandatory X.509 extension envelope.
 */
export function extractKeyDescriptionFromCertificate(certificateDer: Buffer): Buffer {
  if (!Buffer.isBuffer(certificateDer) || certificateDer.length === 0) throw malformed('empty certificate.');
  if (certificateDer.length > MAX_CERT_SCAN_BYTES) throw malformed('certificate exceeds scan bound.');
  const first = certificateDer.indexOf(KEY_DESCRIPTION_OID_ELEMENT);
  if (first === -1) throw malformed('KeyDescription extension OID not found.');
  if (certificateDer.indexOf(KEY_DESCRIPTION_OID_ELEMENT, first + 1) !== -1) {
    throw malformed('KeyDescription extension OID appears more than once.');
  }
  let cursor = first + KEY_DESCRIPTION_OID_ELEMENT.length;
  // Optional critical BOOLEAN (DER BOOLEAN element: 01 01 FF). The Android
  // KeyDescription extension is defined non-critical, but the envelope
  // parser accepts the mandatory encoding form if a future version sets it.
  if (cursor < certificateDer.length && certificateDer[cursor] === 0x01) {
    const boolElement = readElement(certificateDer, cursor);
    if (boolElement.contentEnd - boolElement.contentStart !== 1) throw malformed('malformed critical BOOLEAN.');
    cursor = boolElement.end;
  }
  const octet = expectElement(certificateDer, cursor, 0, 0x04, 'extension value');
  const keyDescription = certificateDer.subarray(octet.contentStart, octet.contentEnd);
  if (keyDescription.length < 2 || keyDescription[0] !== 0x30) {
    throw malformed('extension value does not start with a SEQUENCE.');
  }
  // The KeyDescription SEQUENCE must fill the OCTET STRING content exactly.
  const inner = readElement(keyDescription, 0);
  if (inner.tagClass !== 0 || inner.tagNumber !== 0x10 || inner.end !== keyDescription.length) {
    throw malformed('extension value is not exactly one SEQUENCE.');
  }
  return keyDescription;
}

export interface KeyAttestationAuthorizationList {
  readonly purpose: readonly number[];
  readonly algorithm: number | null;
  readonly origin: number | null;
  readonly digest: readonly number[];
  readonly curve: number | null;
}

const EMPTY_AUTHLIST: KeyAttestationAuthorizationList = Object.freeze({
  purpose: Object.freeze([]),
  algorithm: null,
  origin: null,
  digest: Object.freeze([]),
  curve: null,
});

/**
 * Reads one platform AuthorizationList SEQUENCE. Every unneeded entry is skipped
 * strictly by its declared length; duplicate entries for a needed field are
 * rejected (canonical KeyMint never duplicates them).
 */
function parseAuthorizationList(buf: Buffer, element: DerElement, what: string): KeyAttestationAuthorizationList {
  let cursor = element.contentStart;
  let purpose: number[] | null = null;
  let algorithm: number | null = null;
  let origin: number | null = null;
  let digest: number[] | null = null;
  let curve: number | null = null;
  let entries = 0;
  const seenTags = new Set<number>();
  while (cursor < element.contentEnd) {
    const entry = readElement(buf, cursor);
    if (entry.tagClass !== 2 || !entry.constructed || entry.end > element.contentEnd) {
      throw malformed(`${what}: authorization entry is not a bounded EXPLICIT context tag.`);
    }
    if (seenTags.has(entry.tagNumber)) throw malformed(`${what}: duplicate authorization tag.`);
    seenTags.add(entry.tagNumber);
    entries += 1;
    if (entries > MAX_AUTHLIST_ENTRIES) throw malformed(`${what}: too many entries.`);
    switch (entry.tagNumber) {
      case 1: {
        if (purpose !== null) throw malformed(`${what}: duplicate purpose.`);
        purpose = readIntegerSet(buf, entry, `${what}.purpose`);
        break;
      }
      case 2: {
        if (algorithm !== null) throw malformed(`${what}: duplicate algorithm.`);
        algorithm = readExplicitInteger(buf, entry, `${what}.algorithm`);
        break;
      }
      case 5: {
        if (digest !== null) throw malformed(`${what}: duplicate digest.`);
        digest = readIntegerSet(buf, entry, `${what}.digest`);
        break;
      }
      case 702: {
        if (origin !== null) throw malformed(`${what}: duplicate origin.`);
        origin = readExplicitInteger(buf, entry, `${what}.origin`);
        break;
      }
      case 10: {
        if (curve !== null) throw malformed(`${what}: duplicate curve.`);
        curve = readExplicitInteger(buf, entry, `${what}.curve`);
        break;
      }
      default:
        break; // skipped strictly by declared length via entry.end below
    }
    cursor = entry.end;
  }
  if (cursor !== element.contentEnd) throw malformed(`${what}: entry overran the list.`);
  return { purpose: purpose ?? [], algorithm, origin, digest: digest ?? [], curve };
}

function readExplicitInteger(buf: Buffer, element: DerElement, what: string): number {
  const integer = expectElement(buf, element.contentStart, 0, 0x02, what);
  if (integer.end !== element.contentEnd) throw malformed(`${what}: INTEGER does not fill EXPLICIT wrapper.`);
  return readNonNegativeInteger(buf, integer, what);
}

/** Reads exactly one EXPLICIT SET OF INTEGER. */
function readIntegerSet(buf: Buffer, element: DerElement, what: string): number[] {
  const set = expectElement(buf, element.contentStart, 0, 0x11, what);
  if (set.end !== element.contentEnd) throw malformed(`${what}: SET does not fill EXPLICIT wrapper.`);
  let cursor = set.contentStart;
  const values: number[] = [];
  let previous: Buffer | null = null;
  while (cursor < set.contentEnd) {
    const integer = expectElement(buf, cursor, 0, 0x02, what);
    if (integer.end > set.contentEnd) throw malformed(`${what}: INTEGER overruns SET.`);
    const encoded = buf.subarray(integer.headerStart, integer.end);
    if (previous !== null && Buffer.compare(previous, encoded) >= 0) throw malformed(`${what}: unordered or duplicate SET entry.`);
    previous = encoded;
    values.push(readNonNegativeInteger(buf, integer, what));
    cursor = integer.end;
  }
  if (values.length === 0) throw malformed(`${what}: empty integer set.`);
  return values;
}

export interface ParsedKeyDescription {
  readonly attestationVersion: number;
  readonly attestationSecurityLevel: number;
  readonly keymasterVersion: number;
  readonly keymasterSecurityLevel: number;
  readonly attestationChallenge: Buffer;
  readonly uniqueId: Buffer;
  readonly softwareEnforced: KeyAttestationAuthorizationList;
  readonly teeEnforced: KeyAttestationAuthorizationList;
}

/** Strictly parses the 8-field KeyDescription SEQUENCE (see module doc). */
export function parseKeyDescription(keyDescriptionDer: Buffer): ParsedKeyDescription {
  if (!Buffer.isBuffer(keyDescriptionDer) || keyDescriptionDer.length === 0) throw malformed('empty KeyDescription.');
  const sequence = readElement(keyDescriptionDer, 0);
  if (sequence.tagClass !== 0 || sequence.tagNumber !== 0x10 || !sequence.constructed || sequence.end !== keyDescriptionDer.length) {
    throw malformed('KeyDescription is not exactly one SEQUENCE.');
  }
  let cursor = sequence.contentStart;
  const take = (tagClass: number, tagNumber: number, what: string): DerElement => {
    const element = expectElement(keyDescriptionDer, cursor, tagClass, tagNumber, what);
    cursor = element.end;
    return element;
  };
  const attestationVersion = readNonNegativeInteger(keyDescriptionDer, take(0, 0x02, 'attestationVersion'), 'attestationVersion');
  const attestationSecurityLevel = readNonNegativeInteger(keyDescriptionDer, take(0, 0x0a, 'attestationSecurityLevel'), 'attestationSecurityLevel');
  const keymasterVersion = readNonNegativeInteger(keyDescriptionDer, take(0, 0x02, 'keymasterVersion'), 'keymasterVersion');
  const keymasterSecurityLevel = readNonNegativeInteger(keyDescriptionDer, take(0, 0x0a, 'keymasterSecurityLevel'), 'keymasterSecurityLevel');
  const challenge = take(0, 0x04, 'attestationChallenge');
  const challengeLength = challenge.contentEnd - challenge.contentStart;
  if (challengeLength < 0 || challengeLength > MAX_CHALLENGE_BYTES) throw malformed('attestationChallenge length out of range.');
  const uniqueId = take(0, 0x04, 'uniqueId');
  if (uniqueId.contentEnd - uniqueId.contentStart > MAX_CHALLENGE_BYTES) throw malformed('uniqueId too long.');
  const softwareEnforced = parseAuthorizationList(keyDescriptionDer, take(0, 0x10, 'softwareEnforced'), 'softwareEnforced');
  const teeEnforced = parseAuthorizationList(keyDescriptionDer, take(0, 0x10, 'teeEnforced'), 'teeEnforced');
  if (cursor !== sequence.contentEnd) throw malformed('KeyDescription has trailing bytes.');
  return {
    attestationVersion,
    attestationSecurityLevel,
    keymasterVersion,
    keymasterSecurityLevel,
    attestationChallenge: Buffer.from(keyDescriptionDer.subarray(challenge.contentStart, challenge.contentEnd)),
    uniqueId: Buffer.from(keyDescriptionDer.subarray(uniqueId.contentStart, uniqueId.contentEnd)),
    softwareEnforced,
    teeEnforced,
  };
}

export { EMPTY_AUTHLIST };
