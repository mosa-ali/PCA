import { isCanonicalP256PublicKey } from '../deviceauth/P256DeviceSignatureVerifier.js';

/**
 * Wave 6D (owner freeze 2026-10-04): the canonical App Attest binding
 * transcript for the iOS first-device trust-root ceremony.
 *
 * The App Attest ASSERTION is generated over
 * `clientDataHash = sha256(UTF-8(canonical transcript))`. The transcript
 * binds the Apple-authenticated assertion to the EXACT DSK identity and the
 * CURRENT server ceremony. The server NEVER trusts a client-supplied
 * transcript: it rebuilds these fields from the durable ceremony row + the
 * M1-bound expected DSK triple and compares.
 *
 * FROZEN SHAPE (Option A of the freeze): 10 netstring fields, NO `expiresAt`
 * field — `ceremonyId` + `challengeId` + `nonce` already uniquely bind the
 * statement to the server ceremony, and authoritative expiry is enforced
 * separately by FirstDeviceBootstrapService. This module makes no
 * expiration-binding claim.
 *
 * The attestation object (Apple `attestKey`) is computed ONCE per App Attest
 * key and cannot carry a future ceremony's nonce, so its `clientDataHash`
 * uses the SEPARATE enrollment-stable context below
 * (`PCA_IOS_APPATTEST_ATTESTATION_V1|dskKeyId|dskPublicKey`) whose values are
 * server-authored: `dskKeyId` is the server-minted signingKeyId and
 * `dskPublicKey` is the M1-enrolled key. The server recomputes that value
 * from `expectedDskKeyId` + `expectedDskPublicKey` alone.
 */

export const IOS_ATTESTATION_DOMAIN = 'PCA_IOS_DSK_ATTESTATION_V1';
export const IOS_ATTESTATION_PROTOCOL_VERSION = 1;
export const IOS_ATTESTATION_ALGORITHM = 'ECDSA_P256_SHA256';
/** Upper bound: comfortably above the ~350-byte canonical form, far below any parser budget. */
export const MAX_IOS_ATTESTATION_TRANSCRIPT_BYTES = 2_048;
/** Domain prefix for the enrollment-stable attestation clientDataHash input. */
export const IOS_APPATTEST_ATTESTATION_CLIENT_DATA_PREFIX = 'PCA_IOS_APPATTEST_ATTESTATION_V1';

export interface IosAttestationTranscriptFields {
  familyId: string;
  deviceId: string;
  ceremonyId: string;
  challengeId: string;
  nonce: string;
  dskKeyId: string;
  dskPublicKey: string;
}

export class IosAttestationTranscriptError extends Error {
  readonly code = 'MALFORMED_IOS_ATTESTATION_TRANSCRIPT';
  constructor(message: string) {
    super(`Malformed iOS attestation transcript: ${message}`);
  }
}

const ID_36 = /^[A-Za-z0-9-]{36}$/;
const NONCE_43 = /^[A-Za-z0-9_-]{43}$/;

export function canonicalizeIosAttestationTranscript(fields: IosAttestationTranscriptFields): string {
  const values = [
    IOS_ATTESTATION_DOMAIN,
    String(IOS_ATTESTATION_PROTOCOL_VERSION),
    fields.familyId,
    fields.deviceId,
    fields.ceremonyId,
    fields.challengeId,
    fields.nonce,
    IOS_ATTESTATION_ALGORITHM,
    fields.dskKeyId,
    fields.dskPublicKey,
  ];
  return values.map((value) => `${Buffer.byteLength(value, 'utf8')}:${value}`).join('');
}

function malformed(message: string): IosAttestationTranscriptError {
  return new IosAttestationTranscriptError(message);
}

function validateField(name: string, value: string, pattern: RegExp): void {
  if (!pattern.test(value)) throw malformed(`${name} is not in the canonical form.`);
}

/**
 * Strict decoder mirroring the certified bootstrap-proof discipline: byte
 * length prefixes, exactly 10 fields, full consumption, canonical field
 * domains, and re-encode byte-identity. Any deviation is rejected outright.
 */
export function decodeIosAttestationTranscript(input: unknown): IosAttestationTranscriptFields {
  if (typeof input !== 'string' || input.length === 0) {
    throw malformed('transcript must be a non-empty string.');
  }
  const bytes = Buffer.from(input, 'utf8');
  if (bytes.length > MAX_IOS_ATTESTATION_TRANSCRIPT_BYTES) {
    throw malformed(`transcript exceeds ${MAX_IOS_ATTESTATION_TRANSCRIPT_BYTES} bytes.`);
  }

  const fields: string[] = [];
  let offset = 0;
  while (offset < bytes.length) {
    let colon = offset;
    while (colon < bytes.length && bytes[colon] !== 0x3a) {
      const byte = bytes[colon];
      if (byte < 0x30 || byte > 0x39) throw malformed('length prefix must be digits.');
      colon += 1;
    }
    if (colon === offset) throw malformed('length prefix must not be empty.');
    if (colon >= bytes.length) throw malformed('length prefix is unterminated.');
    const prefix = bytes.toString('ascii', offset, colon);
    if (prefix.length > 1 && prefix.startsWith('0')) {
      throw malformed('length prefix must not have leading zeros.');
    }
    const length = Number(prefix);
    if (!Number.isSafeInteger(length)) throw malformed('length prefix is not a safe integer.');
    const valueStart = colon + 1;
    const valueEnd = valueStart + length;
    if (valueEnd > bytes.length) throw malformed('field extends past the end of the transcript.');
    fields.push(bytes.toString('utf8', valueStart, valueEnd));
    offset = valueEnd;
  }

  if (fields.length !== 10) throw malformed(`expected 10 fields, found ${fields.length}.`);
  const [domain, version, familyId, deviceId, ceremonyId, challengeId, nonce, algorithm, dskKeyId, dskPublicKey] = fields;
  if (domain !== IOS_ATTESTATION_DOMAIN) throw malformed('unexpected domain.');
  if (version !== String(IOS_ATTESTATION_PROTOCOL_VERSION)) throw malformed('unexpected version.');
  validateField('familyId', familyId, ID_36);
  validateField('deviceId', deviceId, ID_36);
  validateField('ceremonyId', ceremonyId, ID_36);
  validateField('challengeId', challengeId, ID_36);
  validateField('nonce', nonce, NONCE_43);
  if (algorithm !== IOS_ATTESTATION_ALGORITHM) throw malformed('unexpected algorithm.');
  validateField('dskKeyId', dskKeyId, ID_36);
  if (!isCanonicalP256PublicKey(dskPublicKey)) throw malformed('dskPublicKey is not canonical.');

  const decoded: IosAttestationTranscriptFields = {
    familyId,
    deviceId,
    ceremonyId,
    challengeId,
    nonce,
    dskKeyId,
    dskPublicKey,
  };
  if (canonicalizeIosAttestationTranscript(decoded) !== input) {
    throw malformed('transcript is not canonical (re-encode mismatch).');
  }
  return decoded;
}

/**
 * The enrollment-stable `clientData` string for the once-per-key Apple
 * ATTESTATION object: `PCA_IOS_APPATTEST_ATTESTATION_V1|<dskKeyId>|<dskPublicKey>`.
 * Callers hash it with SHA-256. The server recomputes it from
 * `expectedDskKeyId` + `expectedDskPublicKey`; the client uses the
 * server-delivered signingKeyId + its own canonical public key.
 */
export function canonicalizeIosAppAttestEnrollmentClientData(dskKeyId: string, dskPublicKey: string): string {
  return `${IOS_APPATTEST_ATTESTATION_CLIENT_DATA_PREFIX}|${dskKeyId}|${dskPublicKey}`;
}
