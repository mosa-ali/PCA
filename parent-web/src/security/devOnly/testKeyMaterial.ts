// TEST/DEV_ONLY -- raw key-material inspection helper.
//
// This file exists ONLY so tests can prove properties about generated key
// material (e.g. "the private key is genuinely non-extractable" or "no raw
// bytes ever reach Web Storage") without any production code path ever
// needing to see raw key bytes. It is intentionally kept in its own
// `devOnly/` directory and is NEVER imported from anywhere under
// src/api/real/**, src/security/trustedEndpointKeyStore.ts, or any other
// production module -- see tests/unit/noDevOnlyImportsInProduction.test.ts,
// which greps the production source tree and fails the build if that ever
// changes.
//
// guardNotProduction() is a defense-in-depth runtime check: even if this
// module were ever mistakenly imported from a production bundle, calling
// its exports outside a test/dev context throws immediately instead of
// doing anything.
import { config } from '../../config/env';

function guardNotProduction(): void {
  const isTestOrDev = config.demoMode === true || (typeof process !== 'undefined' && process.env?.NODE_ENV === 'test');
  if (!isTestOrDev) {
    throw new Error(
      'testKeyMaterial.ts is a TEST/DEV_ONLY helper and must never execute outside demoMode/test -- refusing to run.',
    );
  }
}

/** TEST/DEV_ONLY: generates an EXTRACTABLE keypair purely so a test can export and inspect raw bytes. Never use this key for anything a real trusted-endpoint key is used for. */
export async function generateExtractableTestKeyPair(): Promise<CryptoKeyPair> {
  guardNotProduction();
  return crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
}

/** TEST/DEV_ONLY: exports the raw private key bytes (PKCS8) of a test-only extractable key, so a test can assert what "raw key material" would look like and confirm it is absent from storage. */
export async function exportRawPrivateKeyForTestAssertions(privateKey: CryptoKey): Promise<ArrayBuffer> {
  guardNotProduction();
  return crypto.subtle.exportKey('pkcs8', privateKey);
}
