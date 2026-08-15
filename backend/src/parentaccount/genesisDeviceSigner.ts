import { generateKeyPairSync, createPublicKey, sign as cryptoSign, verify as cryptoVerify, type KeyObject } from 'node:crypto';
import type { DeviceSignatureVerifier } from '../deviceauth/DeviceSignatureVerifier.js';

/**
 * INTERPRETATION NOTE (flagged in WRITER57's final report as an open
 * architecture question, not a unilateral decision): PCA-ADD-IDENT-009/010
 * requires the first verified parent of a new family to trigger the
 * EXISTING genesis-anchored Owner-attestation bootstrap
 * (FamilyOwnerAttestationChainEngine.bootstrapFamilyAuthority), which is a
 * self-signed-by-the-genesis-DEVICE ceremony (PCA-DEC-025 Option A).
 * PCA-ADD-IDENT-010 simultaneously requires that first registration "MUST
 * NOT require an existing trusted family device" -- but a plain
 * email+password browser registration has no device DSK keypair of its own
 * at all (WebAuthn/passkey, Option A of PCA_IMPL_DECISION_003, is
 * explicitly deferred this round). This module bridges that gap the only
 * way available without inventing a new authority primitive: it generates
 * a single ephemeral Ed25519 keypair, uses it to self-sign the genesis
 * anchor and revision-1 Owner attestation exactly as a real genesis DEVICE
 * would, and then the private key is discarded immediately (never
 * persisted, never logged, out of scope of `this` after the synchronous
 * call returns) -- the browser session is treated as "device 1" for the
 * one-time genesis ceremony only, and every subsequent authority check
 * still goes through the SAME unmodified
 * FamilyOwnerAttestationChainEngine.resolveCurrentOwner verification path
 * every other caller uses; nothing here special-cases parent-registration
 * callers at read time.
 *
 * This does NOT select CRYPTO_SUITE (PCA-DEC-020, still
 * WAITING_HUMAN_SECURITY_REVIEW) -- the verifier actually injected in
 * production (main.ts, Coordinator-owned) remains
 * RejectingDeviceSignatureVerifier today, so this signer's real Ed25519
 * signature is structurally correct but is REJECTED in production exactly
 * like every other crypto-gated surface in this codebase, which is the
 * correct fail-closed posture, not a bug. `createEd25519DeviceSignatureVerifier`
 * below exists so this lane's OWN tests can prove the bootstrap call
 * genuinely reaches BOOTSTRAPPED under a real verifier -- it is never wired
 * into production by this lane.
 */
export interface GenesisDeviceKeyMaterial {
  publicKeyBase64: string;
  privateKey: KeyObject;
}

export function generateEphemeralGenesisDeviceKeyPair(): GenesisDeviceKeyMaterial {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicKeyBase64 = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  return { publicKeyBase64, privateKey };
}

export function signWithGenesisDeviceKey(privateKey: KeyObject, message: string): string {
  const signature = cryptoSign(null, Buffer.from(message, 'utf8'), privateKey);
  return signature.toString('base64');
}

function importPublicKeyFromBase64(publicKeyBase64: string): KeyObject | null {
  try {
    return createPublicKey({ key: Buffer.from(publicKeyBase64, 'base64'), format: 'der', type: 'spki' });
  } catch {
    return null;
  }
}

/**
 * TEST/REFERENCE-ONLY verifier matching `signWithGenesisDeviceKey`'s real
 * Ed25519 scheme -- proves this lane's bootstrap wiring is structurally
 * correct end-to-end. NOT wired into production by this lane (see this
 * file's header); CRYPTO_SUITE selection remains PCA-DEC-020's decision.
 */
export function createEd25519DeviceSignatureVerifier(): DeviceSignatureVerifier {
  return {
    async verify(publicKey: string, message: string, signature: string): Promise<boolean> {
      const keyObject = importPublicKeyFromBase64(publicKey);
      if (!keyObject) return false;
      try {
        return cryptoVerify(null, Buffer.from(message, 'utf8'), keyObject, Buffer.from(signature, 'base64'));
      } catch {
        return false;
      }
    },
  };
}
