import { verify as cryptoVerify, createHash, X509Certificate } from 'node:crypto';
import { isCanonicalP256PublicKey } from '../deviceauth/P256DeviceSignatureVerifier.js';
import { DSK_ALGORITHM, sha256Hex } from './FirstDeviceBootstrapProof.js';
import {
  IOS_APPATTEST_ATTESTATION_CLIENT_DATA_PREFIX,
  IOS_ATTESTATION_ALGORITHM,
  IOS_ATTESTATION_DOMAIN,
  IOS_ATTESTATION_PROTOCOL_VERSION,
  canonicalizeIosAppAttestEnrollmentClientData,
  canonicalizeIosAttestationTranscript,
  decodeIosAttestationTranscript,
} from './IosAttestationTranscript.js';
import { decodeStrictCbor, isCborMap, type CborMap, type CborValue } from './AppleAppAttestCbor.js';
import { extractAppAttestNonce } from './AppleAppAttestDer.js';
import type { AttestationVerdict, AttestationVerifier, FirstDeviceAttestationInput } from './AttestationVerifier.js';

/**
 * Wave 6D: the REAL iOS platform-attestation verifier behind the certified
 * Wave-6B-R1 [AttestationVerifier] boundary (owner ruling 11; the R1-02
 * MUST-NOTs in AttestationVerifier.ts apply to this file verbatim).
 *
 * ARCHITECTURE (frozen Wave 6D): the trust root is the SECURE ENCLAVE
 * P-256 DSK (bootstrap proof + epoch-1 signer). Apple App Attest is the
 * platform-authenticity attestor:
 *
 *  - The App Attest ATTESTATION proves a genuine Apple device, running
 *    THIS app (TeamID.BundleID), minted a fresh key -- and, through the
 *    ENROLLMENT-STABLE clientDataHash
 *    sha256("PCA_IOS_APPATTEST_ATTESTATION_V1|<dskKeyId>|<dskPublicKey>"),
 *    binds that platform statement to the exact DSK the ceremony expects.
 *    Both the DSK id and public key come from the durable ceremony row
 *    (M1-bound) -- the client cannot choose the attested content.
 *  - The App Attest ASSERTION (counter >= 1) signs, via
 *    sha256(authData || sha256(transcript)), the canonical 10-field
 *    PCA_IOS_DSK_ATTESTATION_V1 transcript that itself contains the same
 *    DSK, family/device/ceremony/challenge/nonce and algorithm. The
 *    transcript is REBUILT SERVER-SIDE from the durable ceremony inputs
 *    and must match the evidence byte for byte.
 *  - The App Attest key is structurally different from the DSK (it signs
 *    only Apple-app-scoped statements, never arbitrary bytes), so it can
 *    never be a signing oracle for the trust root; conversely the proven
 *    DSK is the SAME key that must independently sign the bootstrap proof
 *    and epoch-1 (verified elsewhere). Acyclic by construction.
 *
 * WHAT A VERIFIED VERDICT PROVES:
 *  - credCert (x5c[0]) is chained to a pinned Apple App Attest root, with
 *    raw-DER byte equality per chain link (the Wave-6C Stage-B X.509
 *    hardening pattern);
 *  - the credential public key (from the certificate AND re-cross-checked
 *    inside authData's COSE key) hashes to the envelope keyId and to
 *    authData's credId;
 *  - nonce_1 = sha256(authData_1 || clientDataHash_1) equals the nonce in
 *    credCert's extension OID 1.2.840.113635.100.8.2;
 *  - rpIdHash = sha256(appId) in both authData values;
 *  - attestation counter == 0; assertion counter >= 1 (no durable counter
 *    state exists in Wave 6D by design -- one-time root + payload-digest
 *    idempotency carry replay protection at the commit layer);
 *  - aaguid matches the configured Apple environment;
 *  - the assertion signature verifies (ES256, DER) over nonce_2;
 *  - the attested DSK public key -- canonical SEC1 uncompressed -- EQUALS
 *    input.expectedDskPublicKey (the exact-DSK hinge; never a blind echo).
 *
 * Returned attested values are parsed FROM the validated evidence (the
 * strict transcript decoder), never copied from the input.
 *
 * This class NEVER throws to its caller and never returns VERIFIED without
 * every check above; any malformed input collapses to REJECTED with a
 * bounded, non-oracle reason token. Wave 6D does not parse the receipt
 * field (its validation is an Apple-server concern, explicitly out of
 * scope per the frozen architecture); the field is required to be present
 * as bytes.
 */

export const IOS_APPATTEST_EVIDENCE_VERSION = 1;
export const IOS_APPATTEST_EVIDENCE_PLATFORM = 'IOS';
export const IOS_APPATTEST_PRODUCTION_AAGUID = 'appattest\u0000\u0000\u0000\u0000\u0000\u0000\u0000';
export const IOS_APPATTEST_DEVELOPMENT_AAGUID = 'appattestdevelop';

export type AppleAppAttestEnvironment = 'production' | 'development';

export interface AppleAppAttestVerifierOptions {
  readonly rootCertificates: readonly X509Certificate[];
  readonly rootDer: readonly Buffer[];
  /** TeamID.BundleID, e.g. "ABCDE12345.com.pca.app". */
  readonly appId: string;
  readonly environment: AppleAppAttestEnvironment;
}

/** Service-side cap (FirstDeviceBootstrapService MAX_ATTESTATION_EVIDENCE_BYTES); re-enforced defense-in-depth. */
const MAX_EVIDENCE_BYTES = 16_384;
const MAX_ATTESTATION_BYTES = 12_288;
const MAX_ASSERTION_BYTES = 1_024;
const MAX_TRANSCRIPT_BYTES = 2_048;
const MAX_CERT_DER_BYTES = 8_192;
const MIN_CHAIN_CERTS = 1;
const MAX_CHAIN_CERTS = 3;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const APP_ID_PATTERN = /^[A-Z0-9]{10}\.[A-Za-z0-9.-]+$/;

/** TeamID.BundleID shape check shared by the factory (lane gating) and the verifier. */
export function isValidAppleAppId(appId: string): boolean {
  return typeof appId === 'string' && APP_ID_PATTERN.test(appId);
}

const ATTESTATION_KEYS = ['attStmt', 'authData', 'fmt'];
const ASSERTION_KEYS = ['authenticatorData', 'signature'];
const ATTEST_STMT_KEYS = ['receipt', 'x5c'];
const ENVELOPE_KEYS = ['assertion', 'attestation', 'keyId', 'platform', 'transcript', 'v'];

const COSE_PREFIX = Buffer.from([0xa5, 0x01, 0x02, 0x03, 0x26, 0x20, 0x01, 0x21, 0x58, 0x20]);
const COSE_MIDDLE = Buffer.from([0x22, 0x58, 0x20]);
const AUTH_DATA_FIXED_BYTES = 164; // 32+1+4+16+2+32+77

interface ParsedEnvelope {
  readonly keyIdBytes: Buffer;
  readonly attestationBytes: Buffer;
  readonly assertionBytes: Buffer;
  readonly transcript: string;
}

function rejected(reason: string): AttestationVerdict {
  return { status: 'REJECTED', reason };
}

function strictBase64UrlDecode(value: unknown): Buffer | null {
  if (typeof value !== 'string' || value.length === 0 || !BASE64URL_PATTERN.test(value)) return null;
  const decoded = Buffer.from(value, 'base64url');
  if (decoded.length === 0) return null;
  if (decoded.toString('base64url') !== value) return null;
  return decoded;
}

function sha256(data: Buffer): Buffer {
  return createHash('sha256').update(data).digest();
}

function parseEnvelope(evidence: string): ParsedEnvelope | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(evidence);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (keys.length !== ENVELOPE_KEYS.length) return null;
  for (let index = 0; index < ENVELOPE_KEYS.length; index += 1) {
    if (keys[index] !== ENVELOPE_KEYS[index]) return null;
  }
  if (record.v !== IOS_APPATTEST_EVIDENCE_VERSION) return null;
  if (record.platform !== IOS_APPATTEST_EVIDENCE_PLATFORM) return null;
  const keyIdBytes = strictBase64UrlDecode(record.keyId);
  if (keyIdBytes === null || keyIdBytes.length !== 32) return null;
  const attestationBytes = strictBase64UrlDecode(record.attestation);
  if (attestationBytes === null || attestationBytes.length > MAX_ATTESTATION_BYTES) return null;
  const assertionBytes = strictBase64UrlDecode(record.assertion);
  if (assertionBytes === null || assertionBytes.length > MAX_ASSERTION_BYTES) return null;
  const transcript = record.transcript;
  if (typeof transcript !== 'string' || transcript.length === 0) return null;
  if (Buffer.byteLength(transcript, 'utf8') > MAX_TRANSCRIPT_BYTES) return null;
  return { keyIdBytes, attestationBytes, assertionBytes, transcript };
}

function mapWithExactKeys(value: CborValue | null, expectedKeys: readonly string[]): CborMap | null {
  if (!isCborMap(value)) return null;
  const keys = Object.keys(value).sort();
  if (keys.length !== expectedKeys.length) return null;
  for (let index = 0; index < expectedKeys.length; index += 1) {
    if (keys[index] !== expectedKeys[index]) return null;
  }
  return value;
}

function asBytes(value: CborValue | undefined): Buffer | null {
  if (value === undefined || !(value instanceof Uint8Array)) return null;
  return Buffer.from(value);
}

/** Canonical SEC1 (0x04||X||Y, 65 bytes) point from a certificate's public key. */
function sec1PointFromCertificate(certificate: X509Certificate): Buffer | null {
  try {
    const jwk = certificate.publicKey.export({ format: 'jwk' }) as { crv?: string; x?: string; y?: string };
    if (jwk.crv !== 'P-256' || typeof jwk.x !== 'string' || typeof jwk.y !== 'string') return null;
    const x = strictBase64UrlDecode(jwk.x);
    const y = strictBase64UrlDecode(jwk.y);
    if (x === null || y === null || x.length !== 32 || y.length !== 32) return null;
    return Buffer.concat([Buffer.from([0x04]), x, y]);
  } catch {
    return null;
  }
}

export class AppleAppAttestVerifier implements AttestationVerifier {
  private readonly rootCertificates: readonly X509Certificate[];
  private readonly rootDer: readonly Buffer[];
  private readonly appId: string;
  private readonly environment: AppleAppAttestEnvironment;

  constructor(options: AppleAppAttestVerifierOptions) {
    this.rootCertificates = options.rootCertificates;
    this.rootDer = options.rootDer;
    this.appId = options.appId;
    this.environment = options.environment;
  }

  async verifyFirstDeviceAttestation(input: FirstDeviceAttestationInput): Promise<AttestationVerdict> {
    try {
      return this.verify(input);
    } catch {
      // No exception shape may ever escape, and no exception text is
      // surfaced (bounded, non-oracle reasons only).
      return rejected('verification_exception');
    }
  }

  private verify(input: FirstDeviceAttestationInput): AttestationVerdict {
    // 0. Platform routing sanity.
    if (input.platform !== 'IOS') return rejected('platform_mismatch');
    if (input.expectedDskAlgorithm !== DSK_ALGORITHM) return rejected('dsk_algorithm_unsupported');
    if (!isValidAppleAppId(this.appId)) return rejected('app_id_not_configured');
    if (this.rootCertificates.length === 0 || this.rootDer.length !== this.rootCertificates.length) {
      return rejected('trust_anchor_missing');
    }

    // 1. Evidence presence and the certified 16 KiB budget.
    const evidence = input.attestationEvidence;
    if (typeof evidence !== 'string' || evidence.length === 0) return rejected('evidence_missing');
    if (Buffer.byteLength(evidence, 'utf8') > MAX_EVIDENCE_BYTES) return rejected('evidence_too_large');

    // 2. Strict envelope parse (exact key set, canonical base64url, bounds).
    const envelope = parseEnvelope(evidence);
    if (envelope === null) return rejected('evidence_malformed');

    // 3. Server-side rebuild of the expected transcript from durable
    //    ceremony inputs (M1-bound expected DSK; client values never trusted).
    let expectedTranscript: string;
    try {
      expectedTranscript = canonicalizeIosAttestationTranscript({
        familyId: input.familyId,
        deviceId: input.deviceId,
        ceremonyId: input.ceremonyId,
        challengeId: input.challengeId,
        nonce: input.nonce,
        dskKeyId: input.expectedDskKeyId,
        dskPublicKey: input.expectedDskPublicKey,
      });
    } catch {
      return rejected('invalid_expected_dsk');
    }

    // 4. Evidence transcript must be the byte-exact expected transcript.
    if (envelope.transcript !== expectedTranscript) return rejected('transcript_mismatch');

    // 5. Strictly decode the transcript: the attested values come from the
    //    EVIDENCE bytes, never from the input (no blind echo).
    let parsedTranscript;
    try {
      parsedTranscript = decodeIosAttestationTranscript(envelope.transcript);
    } catch {
      return rejected('evidence_malformed');
    }
    // The strict decoder itself enforces the algorithm field byte-exactly;
    // the remaining checks re-pin the exact DSK and its canonical encoding.
    if (parsedTranscript.dskPublicKey !== input.expectedDskPublicKey) return rejected('dsk_public_key_mismatch');
    if (!isCanonicalP256PublicKey(parsedTranscript.dskPublicKey)) return rejected('dsk_public_key_mismatch');

    // 6. Assertion structure.
    const assertion = mapWithExactKeys(decodeStrictCbor(envelope.assertionBytes), ASSERTION_KEYS);
    if (assertion === null) return rejected('assertion_malformed');
    const assertionSignature = asBytes(assertion.signature);
    const assertionAuthData = asBytes(assertion.authenticatorData);
    if (assertionSignature === null || assertionAuthData === null) return rejected('assertion_malformed');
    if (assertionAuthData.length !== 37) return rejected('assertion_malformed');

    // 7. Assertion authenticator data: rpIdHash and counter (>= 1).
    const appIdHash = sha256(Buffer.from(this.appId, 'utf8'));
    if (!assertionAuthData.subarray(0, 32).equals(appIdHash)) return rejected('assertion_rp_id_mismatch');
    const assertionCounter = assertionAuthData.readUInt32BE(33);
    if (assertionCounter < 1) return rejected('assertion_counter_invalid');

    // 8. Attestation structure.
    const attestation = mapWithExactKeys(decodeStrictCbor(envelope.attestationBytes), ATTESTATION_KEYS);
    if (attestation === null) return rejected('attestation_malformed');
    if (attestation.fmt !== 'apple-appattest') return rejected('attestation_fmt_mismatch');
    const attStmt = mapWithExactKeys(attestation.attStmt as CborValue, ATTEST_STMT_KEYS);
    if (attStmt === null) return rejected('attestation_malformed');
    const receipt = asBytes(attStmt.receipt);
    if (receipt === null || receipt.length === 0) return rejected('attestation_malformed');
    const x5cValue = attStmt.x5c;
    if (!Array.isArray(x5cValue) || x5cValue.length < MIN_CHAIN_CERTS || x5cValue.length > MAX_CHAIN_CERTS) {
      return rejected('attestation_malformed');
    }
    const authData = asBytes(attestation.authData);
    if (authData === null || authData.length < AUTH_DATA_FIXED_BYTES) return rejected('attestation_malformed');

    // 9. Certificate chain: parse, byte-identity guard, issuer linkage,
    //    signatures, validity windows, and a pinned-root anchor.
    const chainDer: Buffer[] = [];
    for (const entry of x5cValue) {
      const der = asBytes(entry);
      if (der === null || der.length === 0 || der.length > MAX_CERT_DER_BYTES) return rejected('certificate_chain_invalid');
      chainDer.push(der);
    }
    const chain: X509Certificate[] = [];
    for (const der of chainDer) {
      try {
        const certificate = new X509Certificate(der);
        // Raw-DER byte identity: node's X.509 parser tolerates trailing
        // bytes after the outer SEQUENCE (Wave-6C Stage-B finding); only
        // byte-exact re-encodings may enter the trust path.
        if (!Buffer.from(certificate.raw).equals(der)) return rejected('certificate_chain_invalid');
        chain.push(certificate);
      } catch {
        return rejected('certificate_chain_invalid');
      }
    }
    const now = input.now;
    for (const certificate of chain) {
      const validFrom = new Date(certificate.validFrom);
      const validTo = new Date(certificate.validTo);
      if (!(validFrom <= now && now <= validTo)) return rejected('certificate_expired');
    }
    for (let index = 0; index < chain.length - 1; index += 1) {
      const child = chain[index];
      const issuer = chain[index + 1];
      if (!child.checkIssued(issuer)) return rejected('certificate_chain_invalid');
      let verified = false;
      try {
        verified = child.verify(issuer.publicKey);
      } catch {
        verified = false;
      }
      if (!verified) return rejected('certificate_chain_invalid');
    }
    const top = chain[chain.length - 1];
    let anchored = false;
    for (let index = 0; index < this.rootCertificates.length; index += 1) {
      const root = this.rootCertificates[index];
      try {
        if (!Buffer.from(root.raw).equals(this.rootDer[index])) continue;
        if (!top.checkIssued(root)) continue;
        if (top.verify(root.publicKey)) {
          anchored = true;
          break;
        }
      } catch {
        // Fail closed for this candidate root; try the next one.
      }
    }
    if (!anchored) return rejected('trust_anchor_missing');

    // 10. Credential key: canonical SEC1 point from credCert.
    const credCert = chain[0];
    const credPoint = sec1PointFromCertificate(credCert);
    if (credPoint === null) return rejected('attestation_malformed');

    // 11. authData fixed layout: credId and COSE key cross-checks.
    const credIdLength = authData.readUInt16BE(53);
    if (credIdLength !== 32) return rejected('attestation_malformed');
    const credId = authData.subarray(55, 87);
    const coseKey = authData.subarray(87, AUTH_DATA_FIXED_BYTES);
    if (!coseKey.subarray(0, COSE_PREFIX.length).equals(COSE_PREFIX)) return rejected('attestation_malformed');
    if (!coseKey.subarray(42, 42 + COSE_MIDDLE.length).equals(COSE_MIDDLE)) return rejected('attestation_malformed');
    const coseX = coseKey.subarray(10, 42);
    const coseY = coseKey.subarray(45, 77);
    if (!coseX.equals(credPoint.subarray(1, 33)) || !coseY.equals(credPoint.subarray(33, 65))) {
      return rejected('attestation_key_mismatch');
    }
    if (authData.length > AUTH_DATA_FIXED_BYTES) {
      // Trailing bytes are only tolerated as ONE well-formed CBOR item
      // (authenticator extensions) that consumes the remainder exactly.
      if (decodeStrictCbor(Buffer.from(authData.subarray(AUTH_DATA_FIXED_BYTES))) === null) {
        return rejected('attestation_malformed');
      }
    }

    // 12. keyId: sha256(canonical SEC1 point) == envelope keyId == credId.
    const keyIdDigest = sha256(credPoint);
    if (!keyIdDigest.equals(envelope.keyIdBytes)) return rejected('key_id_mismatch');
    if (!keyIdDigest.equals(credId)) return rejected('key_id_mismatch');

    // 13. rpIdHash and counter of the attestation.
    if (!authData.subarray(0, 32).equals(appIdHash)) return rejected('attestation_rp_id_mismatch');
    if (authData.readUInt32BE(33) !== 0) return rejected('attestation_counter_nonzero');

    // 14. aaguid must match the configured Apple environment.
    const aaguid = authData.subarray(37, 53).toString('utf8');
    const expectedAaguid = this.environment === 'production'
      ? IOS_APPATTEST_PRODUCTION_AAGUID
      : IOS_APPATTEST_DEVELOPMENT_AAGUID;
    if (aaguid !== expectedAaguid) return rejected('aaguid_mismatch');

    // 15. Attestation nonce: sha256(authData || clientDataHash_1) must equal
    //     the nonce inside credCert's extension. clientDataHash_1 is
    //     enrollment-stable and derived from the EXPECTED (M1-bound) DSK.
    let clientData1: string;
    try {
      clientData1 = canonicalizeIosAppAttestEnrollmentClientData(
        input.expectedDskKeyId,
        input.expectedDskPublicKey,
      );
    } catch {
      return rejected('invalid_expected_dsk');
    }
    const expectedNonce1 = sha256(Buffer.concat([authData, sha256(Buffer.from(clientData1, 'utf8'))]));
    const certNonce = extractAppAttestNonce(credCert);
    if (certNonce === null || !certNonce.equals(expectedNonce1)) return rejected('attestation_nonce_mismatch');

    // 16. Assertion signature: ES256 over the WebAuthn/App-Attest signing
    //     input `authenticatorData_2 || clientDataHash_2` -- i.e. ECDSA over
    //     digest sha256(concat), which Node expresses EXACTLY as
    //     verify('sha256', concat, key, sig). (Measured Node-EC semantics:
    //     both 'sha256' and null treat the input as the MESSAGE and hash it;
    //     verify('sha256', concat) is therefore the one equation real
    //     devices produce -- a probe-verified discrimination the kill
    //     matrix pins from both sides.)
    const clientDataHash2 = sha256(Buffer.from(envelope.transcript, 'utf8'));
    const assertionSigningInput = Buffer.concat([assertionAuthData, clientDataHash2]);
    let signatureValid = false;
    try {
      signatureValid = cryptoVerify('sha256', assertionSigningInput, credCert.publicKey, assertionSignature);
    } catch {
      signatureValid = false;
    }
    if (!signatureValid) return rejected('assertion_signature_invalid');

    // 17. EXACT DSK binding (defense-in-depth on top of step 5).
    if (parsedTranscript.dskPublicKey !== input.expectedDskPublicKey) return rejected('dsk_public_key_mismatch');
    if (parsedTranscript.dskKeyId !== input.expectedDskKeyId) return rejected('transcript_mismatch');
    if (parsedTranscript.familyId !== input.familyId || parsedTranscript.deviceId !== input.deviceId) {
      return rejected('transcript_mismatch');
    }
    if (parsedTranscript.ceremonyId !== input.ceremonyId || parsedTranscript.challengeId !== input.challengeId) {
      return rejected('transcript_mismatch');
    }
    if (parsedTranscript.nonce !== input.nonce) return rejected('transcript_mismatch');

    // VERIFIED: attested values are the ones parsed out of the validated
    // evidence; the digest is over the exact raw evidence string.
    return {
      status: 'VERIFIED',
      evidenceDigest: sha256Hex(evidence),
      attestedDskKeyId: parsedTranscript.dskKeyId,
      attestedDskPublicKey: parsedTranscript.dskPublicKey,
      attestedDskAlgorithm: IOS_ATTESTATION_ALGORITHM,
    };
  }
}

export const IOS_ATTESTATION_ARCHITECTURE_FACTS = {
  domain: IOS_ATTESTATION_DOMAIN,
  protocolVersion: IOS_ATTESTATION_PROTOCOL_VERSION,
  algorithm: IOS_ATTESTATION_ALGORITHM,
} as const;
