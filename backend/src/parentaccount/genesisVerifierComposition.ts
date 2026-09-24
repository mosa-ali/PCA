import type { DeviceSignatureVerifier } from '../deviceauth/DeviceSignatureVerifier.js';
import { P256DeviceSignatureVerifier } from '../deviceauth/P256DeviceSignatureVerifier.js';
import { RejectingDeviceSignatureVerifier } from '../runtime-sync/RejectingCryptoVerifiers.js';

/**
 * Selects the device-signature verifier for the Parent family-genesis ceremony
 * ONLY (GenesisChallengeService proof + ParentGenesisService anchor/attestation).
 * Every other signature consumer in main.ts (device sessions, envelopes, the
 * commercial owner-authority engine, removal decisions) is unaffected.
 *
 * DEFAULT IS FAIL-CLOSED. PCA-DEC-020 records production activation of a real
 * verifier as gated on independent cryptographic review; this switch does not
 * record or imply that review. Production activation is an explicit owner act:
 * setting PCA_GENESIS_DEVICE_SIGNATURE_VERIFIER=P256 on the backend app.
 *
 *   unset / '' / 'REJECTING' -> RejectingDeviceSignatureVerifier; every genesis
 *                               route answers 503 genesis_unavailable
 *   'P256'                   -> P256DeviceSignatureVerifier (SEC1 uncompressed
 *                               P-256 key, low-S IEEE-P1363 ECDSA/SHA-256 over
 *                               the canonical netstring message)
 *   anything else            -> boot fails; a typo must never silently mean
 *                               either "enabled" or "disabled"
 *
 * `available` is derived from the selected INSTANCE, so the route capability flag
 * can never drift from the verifier actually composed.
 */
export const GENESIS_VERIFIER_ENV = 'PCA_GENESIS_DEVICE_SIGNATURE_VERIFIER';

export class InvalidGenesisVerifierConfigError extends Error {
  constructor(value: string) {
    super(`${GENESIS_VERIFIER_ENV} must be exactly "P256" or "REJECTING" (got ${JSON.stringify(value)}).`);
    this.name = 'InvalidGenesisVerifierConfigError';
  }
}

export interface GenesisVerifierComposition {
  verifier: DeviceSignatureVerifier;
  available: boolean;
  mode: 'P256' | 'REJECTING';
}

export function resolveGenesisSignatureVerifier(env: NodeJS.ProcessEnv = process.env): GenesisVerifierComposition {
  const raw = env[GENESIS_VERIFIER_ENV];
  let verifier: DeviceSignatureVerifier;
  let mode: GenesisVerifierComposition['mode'];
  if (raw === undefined || raw === '' || raw === 'REJECTING') {
    verifier = new RejectingDeviceSignatureVerifier();
    mode = 'REJECTING';
  } else if (raw === 'P256') {
    verifier = new P256DeviceSignatureVerifier();
    mode = 'P256';
  } else {
    throw new InvalidGenesisVerifierConfigError(raw);
  }
  return { verifier, available: !(verifier instanceof RejectingDeviceSignatureVerifier), mode };
}
