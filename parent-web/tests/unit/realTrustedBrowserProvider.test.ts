import { describe, expect, it } from 'vitest';
import { RealTrustedBrowserProvider } from '../../src/api/real/realTrustedBrowserProvider';
import { hasLocalEndpointKey } from '../../src/security/trustedEndpointKeyStore';

/**
 * Proves that service-login authentication and trusted-browser (endpoint)
 * authentication are genuinely separate states for the REAL provider, not
 * just the dev fixture -- see tests/unit/trustedBrowser.test.ts for the
 * equivalent dev-fixture coverage. This file exercises real WebCrypto key
 * generation (requestPairing), not a simulation.
 */
describe('RealTrustedBrowserProvider', () => {
  it('starts BROWSER_NOT_TRUSTED with no service authentication', async () => {
    const provider = new RealTrustedBrowserProvider();
    const snapshot = await provider.getSnapshot();
    expect(snapshot.state).toBe('BROWSER_NOT_TRUSTED');
    expect(snapshot.serviceAuthenticated).toBe(false);
  });

  it('service-login-authenticated != trusted-browser-authenticated: beginServiceAuthentication flips serviceAuthenticated but never reaches TRUSTED', async () => {
    const provider = new RealTrustedBrowserProvider();
    const afterAuth = await provider.beginServiceAuthentication();
    expect(afterAuth.serviceAuthenticated).toBe(true);
    expect(afterAuth.state).toBe('PAIRING_REQUIRED');
    expect(afterAuth.state).not.toBe('TRUSTED');
  });

  it('requestPairing performs a real (non-fixture) WebCrypto key generation and only reaches PAIRING_PENDING, never TRUSTED', async () => {
    const provider = new RealTrustedBrowserProvider();
    await provider.beginServiceAuthentication();
    const pending = await provider.requestPairing();
    expect(pending.state).toBe('PAIRING_PENDING');
    expect(pending.browserEndpointId).toBeTruthy();
    expect(pending.lastFingerprint).toBeTruthy();
    // A real, non-extractable signing key now genuinely exists in memory --
    // this is not a simulated/fixture fingerprint string.
    expect(hasLocalEndpointKey()).toBe(true);
  });

  it('cannot fabricate TRUSTED status locally: simulateParentApproval honestly rejects (no backend relay exists in this repository slice)', async () => {
    const provider = new RealTrustedBrowserProvider();
    await provider.beginServiceAuthentication();
    await provider.requestPairing();
    await expect(provider.simulateParentApproval()).rejects.toMatchObject({ code: 'NOT_IMPLEMENTED' });
    const snapshot = await provider.getSnapshot();
    expect(snapshot.state).toBe('PAIRING_PENDING');
    expect(snapshot.state).not.toBe('TRUSTED');
  });

  it('reset() clears the in-memory endpoint key and returns to BROWSER_NOT_TRUSTED', async () => {
    const provider = new RealTrustedBrowserProvider();
    await provider.beginServiceAuthentication();
    await provider.requestPairing();
    expect(hasLocalEndpointKey()).toBe(true);
    const reset = await provider.reset();
    expect(reset.state).toBe('BROWSER_NOT_TRUSTED');
    expect(hasLocalEndpointKey()).toBe(false);
  });
});
