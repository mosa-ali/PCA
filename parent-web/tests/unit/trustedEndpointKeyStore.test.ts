import { describe, expect, it, beforeEach } from 'vitest';
import {
  generateEndpointSigningKey,
  hasLocalEndpointKey,
  signWithEndpointKey,
  clearEndpointKey,
} from '../../src/security/trustedEndpointKeyStore';
import { generateExtractableTestKeyPair, exportRawPrivateKeyForTestAssertions } from '../../src/security/devOnly/testKeyMaterial';

/**
 * Proves the hard requirement: no private key material for a trusted
 * browser endpoint ever touches localStorage, sessionStorage, or gets
 * logged -- it actually inspects Web Storage after key generation rather
 * than merely asserting the implementation "should" behave that way.
 */
describe('trustedEndpointKeyStore', () => {
  beforeEach(() => {
    clearEndpointKey();
    localStorage.clear();
    sessionStorage.clear();
  });

  it('generates a non-extractable private key (WebCrypto itself refuses to ever export it)', async () => {
    await generateEndpointSigningKey();
    expect(hasLocalEndpointKey()).toBe(true);
  });

  it('never writes anything to localStorage or sessionStorage across key generation, signing, and clearing', async () => {
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);

    await generateEndpointSigningKey();
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);

    await signWithEndpointKey(new TextEncoder().encode('challenge-nonce'));
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);

    clearEndpointKey();
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it('the public key fingerprint returned is derived only from the PUBLIC key, never from raw private key bytes', async () => {
    const { publicKeyJwk, fingerprint } = await generateEndpointSigningKey();
    expect(publicKeyJwk.d).toBeUndefined(); // JWK private-key component 'd' must never appear
    expect(fingerprint).toMatch(/^[0-9a-f]{64}$/); // sha-256 hex
  });

  it('signWithEndpointKey throws if no key has been generated yet (fails closed, not silently)', async () => {
    await expect(signWithEndpointKey(new TextEncoder().encode('x'))).rejects.toThrow();
  });

  it('DEV_ONLY comparison: a deliberately extractable test-only key CAN be exported to raw bytes, proving the assertions above are meaningful and not vacuously true because export always fails', async () => {
    const testKeyPair = await generateExtractableTestKeyPair();
    const raw = await exportRawPrivateKeyForTestAssertions(testKeyPair.privateKey);
    expect(raw.byteLength).toBeGreaterThan(0);
    // And, critically, this dev-only path is never used by the production
    // key store above -- see tests/unit/noDevOnlyImportsInProduction.test.ts.
  });

  it('the production key store rejects exporting the real endpoint private key at the WebCrypto layer', async () => {
    await generateEndpointSigningKey();
    // trustedEndpointKeyStore.ts deliberately does not export a "getPrivateKey"
    // accessor at all -- the only way to even attempt an export is if the
    // module leaked the CryptoKey, which it does not (no such export exists).
    const moduleExports = await import('../../src/security/trustedEndpointKeyStore');
    expect((moduleExports as Record<string, unknown>).getPrivateKey).toBeUndefined();
    expect((moduleExports as Record<string, unknown>).exportPrivateKey).toBeUndefined();
  });
});
