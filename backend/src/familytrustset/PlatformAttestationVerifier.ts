import { X509Certificate } from 'node:crypto';
import type { AttestationVerdict, AttestationVerifier, FirstDeviceAttestationInput } from './AttestationVerifier.js';
import { AndroidKeyAttestationVerifier } from './AndroidKeyAttestationVerifier.js';

/**
 * Wave 6C: the production attestation composition for the first-device
 * trust-root ceremony. One policy-approved platform verifier exists --
 * ANDROID (AndroidKeyAttestationVerifier) -- and it is active ONLY when
 * explicit trust configuration is present. Everything else fails closed:
 *
 *  - ANDROID with no configured pinned roots  -> UNAVAILABLE (never VERIFIED);
 *  - IOS (Wave 6D, not yet implemented)       -> UNAVAILABLE;
 *  - any other platform value                 -> UNAVAILABLE.
 *
 * CONFIGURATION (strictly operator-controlled; no secrets, no defaults):
 *   PCA_ANDROID_ATTESTATION_ROOTS_PEM
 *     A PEM bundle (one or more CERTIFICATE blocks) of the pinned Android
 *     Key Attestation root certificate(s) -- e.g. the published Google
 *     hardware-attestation roots, the exact set is an operator decision
 *     recorded at deployment. Absent, empty, or malformed => the Android
 *     lane stays UNAVAILABLE. There is deliberately no fallback root, no
 *     network fetch, and no "trust anything" branch anywhere in this file.
 *
 * This module is pure composition: it constructs the real verifier and
 * routes by the attempt's platform. It NEVER contains a permissive branch,
 * and test doubles are constructed only by tests through the service's own
 * dependency injection (pinned out of production composition by
 * test/tooling/ftsProductionWiring.test.mjs).
 */

export const ANDROID_ATTESTATION_ROOTS_ENV = 'PCA_ANDROID_ATTESTATION_ROOTS_PEM';

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

  constructor(android: AttestationVerifier | null) {
    this.android = android;
  }

  async verifyFirstDeviceAttestation(input: FirstDeviceAttestationInput): Promise<AttestationVerdict> {
    if (input.platform === 'ANDROID') {
      if (this.android === null) return { status: 'UNAVAILABLE' };
      return this.android.verifyFirstDeviceAttestation(input);
    }
    // IOS is Wave 6D (not authorized); any unknown platform is refused the
    // same way. There is no verifier that may answer VERIFIED here.
    return { status: 'UNAVAILABLE' };
  }
}

/**
 * Composition-root factory (pinned by ftsProductionWiring.test.mjs): builds
 * the platform router from explicit environment configuration. Malformed
 * configuration is treated exactly like absent configuration -- the
 * Android lane is UNAVAILABLE and no ceremony can ever reach the commit --
 * so a misconfigured deployment can refuse service but can never mis-accept.
 */
export function createPlatformAttestationVerifier(env: Record<string, string | undefined>): PlatformAttestationVerifier {
  const raw = env[ANDROID_ATTESTATION_ROOTS_ENV];
  const parsed = typeof raw === 'string' && raw.trim().length > 0 ? parsePemCertificateBundle(raw) : null;
  if (parsed === null) return new PlatformAttestationVerifier(null);
  return new PlatformAttestationVerifier(
    new AndroidKeyAttestationVerifier({ rootCertificates: parsed.certificates, rootDer: parsed.der }),
  );
}
