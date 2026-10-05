import { X509Certificate } from 'node:crypto';
import { isCanonicalP256PublicKey } from '../deviceauth/P256DeviceSignatureVerifier.js';
import { DSK_ALGORITHM, sha256Hex } from './FirstDeviceBootstrapProof.js';
import {
  extractKeyDescriptionFromCertificate,
  parseKeyDescription,
  type ParsedKeyDescription,
} from './KeyAttestationDer.js';
import type { AttestationVerdict, AttestationVerifier, FirstDeviceAttestationInput } from './AttestationVerifier.js';

/**
 * Wave 6C: the REAL Android platform-attestation verifier behind the
 * certified Wave-6B-R1 [AttestationVerifier] boundary (owner ruling 11; the
 * R1-02 MUST-NOTs in AttestationVerifier.ts apply to this file verbatim).
 *
 * EVIDENCE FORMAT (produced by the Android client, a single JSON string):
 *
 *   {
 *     "v": 1,
 *     "platform": "ANDROID",
 *     "attemptId": "<16..64 chars of [A-Za-z0-9_-]>",
 *     "chain": ["<unpadded base64url DER>", ...]   // leaf first, 2..6 certs
 *   }
 *
 * WHAT A VERIFIED VERDICT PROVES, AND FROM WHERE:
 *  - The leaf certificate's SPKI is an EC P-256 public key whose canonical
 *    SEC1 uncompressed re-encoding EQUALS the ceremony's expected DSK public
 *    key ([input].expectedDskPublicKey, which is M1-bound: the durable
 *    ceremony row can only ever carry the enrollment attempt's exact DSK).
 *    This is the exact-DSK hinge: it is derived from the certificate bytes,
 *    never echoed back from the input.
 *  - The chain is signed, link by link (issuer-subject linkage + signature +
 *    validity window for every certificate in the chain), up to a pinned
 *    root certificate. Pinned roots arrive ONLY via explicit configuration
 *    (see PlatformAttestationVerifier.ts); there is no default, no
 *    environment-name heuristic, and no permissive fallback anywhere.
 *  - The leaf's KeyDescription extension (OID 1.3.6.1.4.1.11129.2.1.17)
 *    attests, in the TEE-ENFORCED authorization list: key origin GENERATED
 *    (a fresh hardware-generated key, never an imported/copied key),
 *    algorithm EC, curve P-256, purpose includes SIGN, digest includes
 *    SHA-256; and, in the top-level fields, a hardware security level of
 *    TEE or StrongBox (SOFTWARE is rejected -- an emulator or a
 *    software-only keystore can never satisfy this).
 *  - The KeyDescription attestationChallenge equals the byte-exact
 *    UTF-8 encoding of "PCA_ANDROID_DSK_ATTESTATION_V1|<attemptId>" where
 *    attemptId is the correlator INSIDE this evidence packet. This binds the
 *    hardware-signed certificate to this evidence packet's declared
 *    enrollment attempt (byte-recomputable on both sides).
 *
 * DOCUMENTED RESIDUALS (deliberately accepted for Wave 6C, consistent with
 * the certified contract):
 *  - The certified [FirstDeviceAttestationInput] (Wave 6B-R1, frozen) does
 *    not carry the attempt id, so the challenge check above is
 *    packet-self-consistency: the verifier cannot independently re-derive
 *    "the server's attempt" from its inputs. This does NOT weaken acceptance:
 *    (a) the authoritative DSK binding is the leaf-SPKI equality, which is
 *    server-anchored through M1 + the durable ceremony row; (b) freshness
 *    across ceremonies is carried by the DSK-signed bootstrap proof over
 *    challengeId/nonce (the R1 MUST-NOTs explicitly forbid treating the
 *    attestation certificate challenge as the ceremony nonce, because the
 *    key and its attestation record are minted at enrollment); (c) the
 *    evidence digest is bound in BOTH directions by the service (caller <=>
 *    verifier <=> the DSK-signed proof <=> the committed row). Replaying
 *    this evidence into a different ceremony can therefore never authorize
 *    anything -- only the same physical DSK, freshly signing that ceremony's
 *    proof and epoch-1, can.
 *  - App/package identity (attestationApplicationId) is intentionally NOT
 *    parsed or enforced in 6C; it is optional hardening recorded for a
 *    future wave, not part of the certified exact-DSK contract.
 *  - Real-device attestation evidence cannot be produced in CI; the
 *    Wave-6C report keeps REAL_DEVICE_ATTESTATION_GATE open. This verifier
 *    is exercised against locally generated certificate fixtures whose
 *    chains, signatures and extension encodings are fully real DER.
 *
 * This class NEVER throws to its caller and never returns VERIFIED without
 * every check above having passed; any malformed input collapses to
 * REJECTED with a bounded, non-oracle reason token.
 */

export const ANDROID_ATTESTATION_CHALLENGE_PREFIX = 'PCA_ANDROID_DSK_ATTESTATION_V1|';
export const ANDROID_ATTESTATION_EVIDENCE_VERSION = 1;
export const ANDROID_ATTESTATION_PLATFORM = 'ANDROID';

/** Service-side cap (FirstDeviceBootstrapService MAX_ATTESTATION_EVIDENCE_BYTES); re-enforced here defense-in-depth. */
const MAX_EVIDENCE_BYTES = 16_384;
const MIN_CHAIN_CERTS = 2;
const MAX_CHAIN_CERTS = 6;
const MAX_CERT_DER_BYTES = 8_192;
const MAX_ATTEMPT_ID_LENGTH = 64;
const MIN_ATTEMPT_ID_LENGTH = 16;
const ATTEMPT_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const SUPPORTED_KEY_DESCRIPTION_VERSIONS = new Set([1, 2, 3, 4, 100, 200, 300, 400, 500]);

// KeyDescription / AuthorizationList vocabulary (keymint platform schema).
const SECURITY_LEVEL_TEE = 1;
const SECURITY_LEVEL_STRONGBOX = 2;
const KM_PURPOSE_SIGN = 2;
const KM_ALGORITHM_EC = 3;
const KM_ORIGIN_GENERATED = 0;
const KM_DIGEST_SHA256 = 4;
const EC_CURVE_P256 = 1;

interface ParsedEvidence {
  readonly attemptId: string;
  readonly chainDer: readonly Buffer[];
  readonly chain: readonly X509Certificate[];
}

function rejected(reason: string): AttestationVerdict {
  return { status: 'REJECTED', reason };
}

function strictBase64UrlDecode(value: string): Buffer | null {
  if (typeof value !== 'string' || value.length === 0 || !BASE64URL_PATTERN.test(value)) return null;
  const decoded = Buffer.from(value, 'base64url');
  if (decoded.length === 0) return null;
  // Canonical re-encode equality: rejects padding, whitespace and any
  // non-canonical variants (the repository-wide strict base64url surface).
  if (decoded.toString('base64url') !== value) return null;
  return decoded;
}

/** Strict, total parse of the evidence JSON envelope. Returns null on any deviation (never throws). */
function parseEvidence(evidence: string): ParsedEvidence | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(evidence);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (keys.length !== 4 || keys[0] !== 'attemptId' || keys[1] !== 'chain' || keys[2] !== 'platform' || keys[3] !== 'v') {
    return null;
  }
  if (record.v !== ANDROID_ATTESTATION_EVIDENCE_VERSION) return null;
  if (record.platform !== ANDROID_ATTESTATION_PLATFORM) return null;
  const attemptId = record.attemptId;
  if (
    typeof attemptId !== 'string' ||
    attemptId.length < MIN_ATTEMPT_ID_LENGTH ||
    attemptId.length > MAX_ATTEMPT_ID_LENGTH ||
    !ATTEMPT_ID_PATTERN.test(attemptId)
  ) {
    return null;
  }
  const chainValue = record.chain;
  if (!Array.isArray(chainValue) || chainValue.length < MIN_CHAIN_CERTS || chainValue.length > MAX_CHAIN_CERTS) return null;
  const chainDer: Buffer[] = [];
  const chain: X509Certificate[] = [];
  for (const entry of chainValue) {
    if (typeof entry !== 'string') return null;
    const der = strictBase64UrlDecode(entry);
    if (der === null || der.length > MAX_CERT_DER_BYTES) return null;
    let certificate: X509Certificate;
    try {
      certificate = new X509Certificate(der);
    } catch {
      return null;
    }
    // SIGNED-REGION PROVENANCE (Wave-6C Stage-B blocker fix): node's X.509
    // parser tolerates trailing bytes after the outer certificate SEQUENCE,
    // and the KeyDescription extractor byte-searches the raw buffer. Without
    // this equality an attacker could append a fabricated, UNSIGNED
    // KeyDescription envelope after the signed structure and it would be
    // "verified". Every in-chain certificate must be byte-identical to its
    // parsed signed form.
    if (!Buffer.from(certificate.raw).equals(der)) return null;
    chainDer.push(der);
    chain.push(certificate);
  }
  return { attemptId, chainDer, chain };
}

export interface AndroidKeyAttestationVerifierDeps {
  /**
   * Pinned trust anchors. Construction is the CALLER's (composition root's)
   * job and must be strictly fail-closed: with zero anchors there is no
   * verifier at all (PlatformAttestationVerifier answers UNAVAILABLE), so
   * this class may assume at least one anchor and only enforces "chain
   * terminates at a pinned anchor".
   */
  readonly rootCertificates: readonly X509Certificate[];
  readonly rootDer: readonly Buffer[];
}

export class AndroidKeyAttestationVerifier implements AttestationVerifier {
  private readonly rootCertificates: readonly X509Certificate[];
  private readonly rootDer: readonly Buffer[];

  constructor(deps: AndroidKeyAttestationVerifierDeps) {
    if (deps.rootCertificates.length === 0 || deps.rootCertificates.length !== deps.rootDer.length) {
      throw new Error('AndroidKeyAttestationVerifier requires at least one pinned root certificate');
    }
    this.rootCertificates = deps.rootCertificates;
    this.rootDer = deps.rootDer;
  }

  async verifyFirstDeviceAttestation(input: FirstDeviceAttestationInput): Promise<AttestationVerdict> {
    try {
      return this.verifyInner(input);
    } catch {
      // Total parser discipline: any structural surprise is a rejection,
      // never an exception escaping into the ceremony service.
      return rejected('evidence_malformed');
    }
  }

  private verifyInner(input: FirstDeviceAttestationInput): AttestationVerdict {
    if (input.platform !== ANDROID_ATTESTATION_PLATFORM) return rejected('platform_not_android');
    if (input.expectedDskAlgorithm !== DSK_ALGORITHM) return rejected('expected_algorithm_unsupported');
    if (input.attestationEvidence === null) return rejected('evidence_missing');
    if (Buffer.byteLength(input.attestationEvidence, 'utf8') > MAX_EVIDENCE_BYTES) return rejected('evidence_oversized');

    const evidence = parseEvidence(input.attestationEvidence);
    if (evidence === null) return rejected('evidence_malformed');

    // ---- Chain terminal check: the LAST certificate must either BE a pinned
    //      root (byte-identical DER) or be issued by one. Keep in mind the
    //      chain is leaf-first; Android returns leaf..intermediates and may
    //      or may not include the root itself.
    const chain = evidence.chain;
    const last = chain[chain.length - 1];
    const lastDer = evidence.chainDer[evidence.chainDer.length - 1];
    let anchored = false;
    for (let index = 0; index < this.rootCertificates.length; index += 1) {
      const root = this.rootCertificates[index];
      const pinnedDer = this.rootDer[index];
      if (lastDer.equals(pinnedDer)) {
        anchored = true;
        break;
      }
      if (last.checkIssued(root)) {
        // checkIssued covers issuer/subject linkage; verify() covers the
        // actual signature over this certificate by the pinned root key. A
        // linkage match with a bad signature must NOT stop the search: try
        // the REMAINING pins before rejecting (root-order independence; the
        // Stage-B review proved the old early-return rejected a valid chain
        // whenever a wrong-but-name-linked pin came first).
        if (last.verify(root.publicKey)) {
          anchored = true;
          break;
        }
      }
    }
    if (!anchored) return rejected('chain_not_anchored_to_pinned_root');

    // ---- Per-link verification: linkage + signature + validity window for
    //      EVERY certificate (X509Certificate.verify does not check dates).
    for (let index = 0; index < chain.length; index += 1) {
      const certificate = chain[index];
      if (index < chain.length - 1) {
        const issuer = chain[index + 1];
        if (!certificate.checkIssued(issuer)) return rejected('chain_linkage_invalid');
        if (!certificate.verify(issuer.publicKey)) return rejected('chain_signature_invalid');
      }
      if (!this.withinValidity(certificate, input.now)) return rejected('certificate_outside_validity');
    }
    // Leaf must not be a CA; every other in-chain certificate must be one.
    if (chain[0].ca) return rejected('leaf_is_ca');
    for (let index = 1; index < chain.length; index += 1) {
      if (!chain[index].ca) return rejected('non_ca_in_chain');
    }

    // ---- Key identity: derive the canonical DSK public key FROM the
    //      certified leaf SPKI and require exact equality with the (M1-bound)
    //      expected value. This is the exact-DSK hinge; it is never an echo.
    const derived = this.deriveCanonicalPublicKey(chain[0]);
    if (derived === null) return rejected('leaf_key_unsupported');
    if (derived !== input.expectedDskPublicKey || !isCanonicalP256PublicKey(derived)) {
      return rejected('leaf_key_mismatch');
    }

    // ---- KeyDescription: hardware-enforced generation context + challenge.
    const keyDescription = this.parseLeafKeyDescription(evidence.chainDer[0]);
    if (keyDescription === null) return rejected('key_description_malformed');
    if (
      keyDescription.attestationSecurityLevel !== SECURITY_LEVEL_TEE &&
      keyDescription.attestationSecurityLevel !== SECURITY_LEVEL_STRONGBOX
    ) {
      return rejected('security_level_not_hardware');
    }
    if (!SUPPORTED_KEY_DESCRIPTION_VERSIONS.has(keyDescription.attestationVersion)) {
      return rejected('attestation_version_unsupported');
    }
    if (
      keyDescription.keymasterSecurityLevel !== SECURITY_LEVEL_TEE &&
      keyDescription.keymasterSecurityLevel !== SECURITY_LEVEL_STRONGBOX
    ) return rejected('key_security_level_not_hardware');
    const tee = keyDescription.teeEnforced;
    if (!tee.purpose.includes(KM_PURPOSE_SIGN)) return rejected('purpose_missing_sign');
    if (tee.algorithm !== KM_ALGORITHM_EC) return rejected('algorithm_not_ec');
    if (tee.origin !== KM_ORIGIN_GENERATED) return rejected('origin_not_generated');
    if (tee.curve !== EC_CURVE_P256) return rejected('curve_not_p256');
    if (!tee.digest.includes(KM_DIGEST_SHA256)) return rejected('digest_missing_sha256');
    const expectedChallenge = Buffer.from(ANDROID_ATTESTATION_CHALLENGE_PREFIX + evidence.attemptId, 'utf8');
    if (!keyDescription.attestationChallenge.equals(expectedChallenge)) return rejected('challenge_mismatch');

    // ---- VERIFIED. The attested key id label (server-minted, not derivable
    //      from platform evidence) may be echoed ONLY now, conditioned on the
    //      public key and algorithm having been validated from the evidence
    //      (R1-02 MUST-NOT: no blind echo).
    return {
      status: 'VERIFIED',
      evidenceDigest: sha256Hex(input.attestationEvidence),
      attestedDskKeyId: input.expectedDskKeyId,
      attestedDskPublicKey: derived,
      attestedDskAlgorithm: DSK_ALGORITHM,
    };
  }

  private withinValidity(certificate: X509Certificate, now: Date): boolean {
    const notBefore = certificate.validFromDate.getTime();
    const notAfter = certificate.validToDate.getTime();
    const at = now.getTime();
    return at >= notBefore && at <= notAfter;
  }

  /** Canonical SEC1 uncompressed (0x04 || x || y, 65 bytes, unpadded base64url) from an EC P-256 leaf. */
  private deriveCanonicalPublicKey(certificate: X509Certificate): string | null {
    try {
      const key = certificate.publicKey;
      if (key.asymmetricKeyType !== 'ec') return null;
      const jwk = key.export({ format: 'jwk' }) as { crv?: string; x?: string; y?: string };
      if (jwk.crv !== 'P-256' || typeof jwk.x !== 'string' || typeof jwk.y !== 'string') return null;
      const x = Buffer.from(jwk.x, 'base64url');
      const y = Buffer.from(jwk.y, 'base64url');
      if (x.length !== 32 || y.length !== 32) return null;
      return Buffer.concat([Buffer.from([0x04]), x, y]).toString('base64url');
    } catch {
      return null;
    }
  }

  private parseLeafKeyDescription(leafDer: Buffer): ParsedKeyDescription | null {
    try {
      return parseKeyDescription(extractKeyDescriptionFromCertificate(leafDer));
    } catch {
      return null;
    }
  }
}
