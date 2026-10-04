import { X509Certificate } from 'node:crypto';
import type { AttestationVerdict, AttestationVerifier, FirstDeviceAttestationInput } from './AttestationVerifier.js';
import { AndroidKeyAttestationVerifier } from './AndroidKeyAttestationVerifier.js';
import { AppleAppAttestVerifier, isValidAppleAppId, type AppleAppAttestEnvironment } from './AppleAppAttestVerifier.js';

/**
 * Wave 6C/6D: the production attestation composition for the first-device
 * trust-root ceremony. Policy-approved platform verifiers exist for
 * ANDROID (AndroidKeyAttestationVerifier, Wave 6C) and IOS
 * (AppleAppAttestVerifier, Wave 6D), and each lane is active ONLY when its
 * explicit trust configuration is present. Everything else fails closed:
 *
 *  - ANDROID with no configured pinned roots  -> UNAVAILABLE (never VERIFIED);
 *  - IOS with incomplete/invalid configuration -> UNAVAILABLE;
 *  - any other platform value                 -> UNAVAILABLE.
 *
 * CONFIGURATION (strictly operator-controlled; no secrets, no defaults):
 *   PCA_ANDROID_ATTESTATION_ROOTS_PEM
 *     A PEM bundle (one or more CERTIFICATE blocks) of the pinned Android
 *     Key Attestation root certificate(s). Absent/empty/malformed => the
 *     Android lane stays UNAVAILABLE.
 *   PCA_IOS_APPATTEST_ROOT_PEM
 *     The pinned Apple App Attest root certificate (PEM). Absent, empty or
 *     malformed => the iOS lane stays UNAVAILABLE; there is deliberately no
 *     implicit Apple root, no network fetch and no "trust anything" branch.
 *   PCA_IOS_APPATTEST_APP_ID
 *     TeamID.BundleID (e.g. "ABCDE12345.com.pca.app"); validated strictly.
 *   PCA_IOS_APPATTEST_ENVIRONMENT
 *     Exactly "production" or "development"; anything else leaves the iOS
 *     lane UNAVAILABLE (a misconfigured deployment can refuse service but
 *     can never mis-accept).
 *
 * This module is pure composition: it constructs the real verifiers and
 * routes by the attempt's platform. It NEVER contains a permissive branch,
 * and test doubles are constructed only by tests through the service's own
 * dependency injection (pinned out of production composition by
 * test/tooling/ftsProductionWiring.test.mjs).
 */

export const ANDROID_ATTESTATION_ROOTS_ENV = 'PCA_ANDROID_ATTESTATION_ROOTS_PEM';
export const IOS_APPATTEST_ROOT_PEM_ENV = 'PCA_IOS_APPATTEST_ROOT_PEM';
export const IOS_APPATTEST_APP_ID_ENV = 'PCA_IOS_APPATTEST_APP_ID';
export const IOS_APPATTEST_ENVIRONMENT_ENV = 'PCA_IOS_APPATTEST_ENVIRONMENT';

export interface ParsedCertificateBundle {
  readonly certificates: readonly X509Certificate[];
  readonly der: readonly Buffer[];
}

/**
 * Strict-enough PEM-bundle parser (Wave-6C Stage-B hardening): splits on
 * CERTIFICATE blocks, requires at least one, requires EVERY `BEGIN` marker
 * to be consumed by a matched block (so a truncated trailing block can
 * never be silently ignored), and parses each block with node:crypto.
 * Non-PEM text AROUND blocks is tolerated by design -- only block counts
 * and block contents are trusted; the direction of every ambiguity is
 * fail-closed for callers (fewer/no roots => no verifier at all).
 * Returns null (callers fail closed) instead of throwing.
 */
export function parsePemCertificateBundle(pem: string): ParsedCertificateBundle | null {
  if (typeof pem !== 'string' || pem.trim().length === 0) return null;
  const blocks = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g);
  if (blocks === null || blocks.length === 0) return null;
  const beginCount = (pem.match(/-----BEGIN CERTIFICATE-----/g) ?? []).length;
  if (beginCount !== blocks.length) return null;
  const certificates: X509Certificate[] = [];
  const der: Buffer[] = [];
  for (const block of blocks) {
    try {
      const certificate = new X509Certificate(block);
      certificates.push(certificate);
      der.push(Buffer.from(certificate.raw));
    } catch {
      return null;
    }
  }
  return { certificates, der };
}

export class PlatformAttestationVerifier implements AttestationVerifier {
  private readonly android: AttestationVerifier | null;
  private readonly ios: AttestationVerifier | null;

  constructor(android: AttestationVerifier | null, ios: AttestationVerifier | null = null) {
    this.android = android;
    this.ios = ios;
  }

  async verifyFirstDeviceAttestation(input: FirstDeviceAttestationInput): Promise<AttestationVerdict> {
    if (input.platform === 'ANDROID') {
      if (this.android === null) return { status: 'UNAVAILABLE' };
      return this.android.verifyFirstDeviceAttestation(input);
    }
    if (input.platform === 'IOS') {
      if (this.ios === null) return { status: 'UNAVAILABLE' };
      return this.ios.verifyFirstDeviceAttestation(input);
    }
    // Any unknown platform is refused the same way. There is no verifier
    // that may answer VERIFIED here.
    return { status: 'UNAVAILABLE' };
  }
}

/**
 * Composition-root factory (pinned by ftsProductionWiring.test.mjs): builds
 * the platform router from explicit environment configuration. Malformed
 * configuration is treated exactly like absent configuration -- the lane is
 * UNAVAILABLE and no ceremony can ever reach the commit -- so a misconfigured
 * deployment can refuse service but can never mis-accept.
 */
export function createPlatformAttestationVerifier(env: Record<string, string | undefined>): PlatformAttestationVerifier {
  const rawAndroid = env[ANDROID_ATTESTATION_ROOTS_ENV];
  const parsedAndroid = typeof rawAndroid === 'string' && rawAndroid.trim().length > 0 ? parsePemCertificateBundle(rawAndroid) : null;
  const android = parsedAndroid === null
    ? null
    : new AndroidKeyAttestationVerifier({ rootCertificates: parsedAndroid.certificates, rootDer: parsedAndroid.der });
  return new PlatformAttestationVerifier(android, createIosVerifier(env));
}

function createIosVerifier(env: Record<string, string | undefined>): AppleAppAttestVerifier | null {
  const rawRoot = env[IOS_APPATTEST_ROOT_PEM_ENV];
  const parsedRoot = typeof rawRoot === 'string' && rawRoot.trim().length > 0 ? parsePemCertificateBundle(rawRoot) : null;
  if (parsedRoot === null) return null;
  const rawAppId = env[IOS_APPATTEST_APP_ID_ENV];
  const appId = typeof rawAppId === 'string' ? rawAppId.trim() : '';
  // A malformed app id is treated exactly like absent configuration: the
  // lane stays UNAVAILABLE rather than existing in a half-configured state.
  if (!isValidAppleAppId(appId)) return null;
  const rawEnvironment = env[IOS_APPATTEST_ENVIRONMENT_ENV];
  if (rawEnvironment !== 'production' && rawEnvironment !== 'development') return null;
  const environment: AppleAppAttestEnvironment = rawEnvironment;
  const verifier = new AppleAppAttestVerifier({
    rootCertificates: parsedRoot.certificates,
    rootDer: parsedRoot.der,
    appId,
    environment,
  });
  return verifier;
}
