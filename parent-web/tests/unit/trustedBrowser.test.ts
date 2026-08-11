import { describe, expect, it } from 'vitest';
import { canTransition } from '../../src/domain/trustedBrowser';
import { DevTrustedBrowserProvider } from '../../src/api/dev/devTrustedBrowserProvider';

describe('trusted browser state machine', () => {
  it('permits the documented forward flow', () => {
    expect(canTransition('BROWSER_NOT_TRUSTED', 'PAIRING_REQUIRED')).toBe(true);
    expect(canTransition('PAIRING_REQUIRED', 'PAIRING_PENDING')).toBe(true);
    expect(canTransition('PAIRING_PENDING', 'TRUSTED')).toBe(true);
    expect(canTransition('TRUSTED', 'EPOCH_STALE')).toBe(true);
    expect(canTransition('TRUSTED', 'REVOKED')).toBe(true);
    expect(canTransition('EPOCH_STALE', 'TRUSTED')).toBe(true);
    expect(canTransition('REVOKED', 'PAIRING_REQUIRED')).toBe(true);
  });

  it('rejects illegal jumps', () => {
    expect(canTransition('BROWSER_NOT_TRUSTED', 'TRUSTED')).toBe(false);
    expect(canTransition('REVOKED', 'TRUSTED')).toBe(false);
  });

  it('service sign-in alone does not grant TRUSTED state', async () => {
    const provider = new DevTrustedBrowserProvider();
    const afterAuth = await provider.beginServiceAuthentication();
    expect(afterAuth.serviceAuthenticated).toBe(true);
    expect(afterAuth.state).not.toBe('TRUSTED');
    expect(afterAuth.state).toBe('PAIRING_REQUIRED');
  });

  it('reaches TRUSTED only after pairing + parent approval', async () => {
    const provider = new DevTrustedBrowserProvider();
    await provider.reset();
    await provider.beginServiceAuthentication();
    const pending = await provider.requestPairing();
    expect(pending.state).toBe('PAIRING_PENDING');
    const trusted = await provider.simulateParentApproval();
    expect(trusted.state).toBe('TRUSTED');
  });

  it('revoke removes trust and requires re-pairing', async () => {
    const provider = new DevTrustedBrowserProvider();
    await provider.reset();
    await provider.beginServiceAuthentication();
    await provider.requestPairing();
    await provider.simulateParentApproval();
    const revoked = await provider.simulateRevoke();
    expect(revoked.state).toBe('REVOKED');
  });
});
