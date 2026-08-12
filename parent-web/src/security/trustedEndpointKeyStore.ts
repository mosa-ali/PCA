// Production browser-endpoint key material handling. This is REAL WebCrypto
// -- not a fixture -- but it never persists raw private key material
// anywhere JS-reachable storage could leak it from: the private CryptoKey
// this module generates is created with `extractable: false`, so the
// browser's WebCrypto implementation itself refuses to ever export its raw
// bytes (crypto.subtle.exportKey on a non-extractable key throws), and this
// module additionally never calls exportKey on the private key. The key is
// held only in an in-memory module-scope handle for the lifetime of the tab
// -- it is NEVER written to localStorage, sessionStorage, a cookie, or a
// log statement.
//
// PRODUCTION_NOTE: persisting the non-extractable CryptoKey object itself
// across reloads (e.g. via IndexedDB, which supports structured-cloning
// CryptoKey handles without ever exposing raw bytes) is a reasonable future
// enhancement, but is out of scope for this change and would need its own
// review -- today, a page reload requires re-pairing (state resets to
// BROWSER_NOT_TRUSTED), which is the safe default, not a regression.
//
// See docs/architecture/09_SECURITY_PRIVACY_E2EE.md Section 7 and
// ./secureStorage.ts (the pre-existing dev-only stub this module replaces
// for the production code path).

const SIGNING_ALGORITHM = { name: 'ECDSA', namedCurve: 'P-256' } as const;
const SIGN_ALGORITHM = { name: 'ECDSA', hash: 'SHA-256' } as const;

export interface EndpointKeyMaterial {
  privateKey: CryptoKey;
  publicKey: CryptoKey;
}

export interface EndpointPublicKeyInfo {
  publicKeyJwk: JsonWebKey;
  /** SHA-256 fingerprint of the exported public key JWK, hex-encoded. The public key is not secret -- this is safe to display/compare. */
  fingerprint: string;
}

/** In-memory only. Never serialized, never assigned to any Web Storage API, never logged. Module-private by convention -- no export. */
let currentKeyMaterial: EndpointKeyMaterial | null = null;

function assertWebCryptoAvailable(): void {
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    throw new Error(
      'WebCrypto (crypto.subtle) is not available in this browser context -- trusted-endpoint key material cannot be generated.',
    );
  }
}

async function sha256Hex(input: BufferSource): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', input);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Generates a fresh non-extractable ECDSA P-256 signing keypair for this
 * browser endpoint. Any previously held key material is discarded first
 * (clearEndpointKey), so at most one endpoint keypair is ever held in
 * memory at a time.
 */
export async function generateEndpointSigningKey(): Promise<EndpointPublicKeyInfo> {
  assertWebCryptoAvailable();
  clearEndpointKey();

  const keyPair = await crypto.subtle.generateKey(SIGNING_ALGORITHM, false, ['sign', 'verify']);
  const privateKey = keyPair.privateKey;
  const publicKey = keyPair.publicKey;

  // Defensive assertion: WebCrypto must honor extractable: false. If a
  // future browser bug or polyfill ever returned an extractable private
  // key, fail loudly rather than silently holding key material that could
  // be exported.
  if (privateKey.extractable) {
    currentKeyMaterial = null;
    throw new Error(
      'Generated endpoint private key was unexpectedly extractable -- refusing to hold it. This indicates a WebCrypto ' +
        'implementation bug, not a configuration this module ever requests.',
    );
  }

  currentKeyMaterial = { privateKey, publicKey };

  const publicKeyJwk = await crypto.subtle.exportKey('jwk', publicKey);
  const publicKeyBytes = new TextEncoder().encode(JSON.stringify(publicKeyJwk));
  const fingerprint = await sha256Hex(publicKeyBytes);

  return { publicKeyJwk, fingerprint };
}

export function hasLocalEndpointKey(): boolean {
  return currentKeyMaterial !== null;
}

/** Signs arbitrary data with the in-memory, non-extractable private key. Throws if no key has been generated yet (call generateEndpointSigningKey first). */
export async function signWithEndpointKey(data: BufferSource): Promise<ArrayBuffer> {
  assertWebCryptoAvailable();
  if (!currentKeyMaterial) {
    throw new Error('No trusted-endpoint key material is held in this browser context -- generate one first.');
  }
  return crypto.subtle.sign(SIGN_ALGORITHM, currentKeyMaterial.privateKey, data);
}

/** Discards the in-memory key handle (e.g. on REVOKED or explicit reset). Does not throw if nothing was held. */
export function clearEndpointKey(): void {
  currentKeyMaterial = null;
}
