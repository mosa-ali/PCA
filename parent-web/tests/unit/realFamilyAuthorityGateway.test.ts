// PCA product-completion programme: proves RealFamilyAuthorityGateway.removeMember
// genuinely calls the real backend remove route (family session resolved via
// /api/parent/session, actor identity from a verified device session token,
// CSRF header attached), surfaces the server's real auditEventId, and that
// every OTHER FamilyAuthorityGateway method still inherits
// UnavailableFamilyAuthorityGateway's honest not-implemented/denied behavior
// unchanged (see this class's own header comment on why).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RealFamilyAuthorityGateway } from '../../src/api/real/realFamilyAuthorityGateway';
import type { FamilyAuthorityGateway } from '../../src/api/interfaces';
import type { TrustedBrowserProvider, TrustedBrowserSnapshot } from '../../src/domain/trustedBrowser';

function urlOf(call: unknown[]): string {
  const input = call[0] as RequestInfo | URL;
  return typeof input === 'string' ? input : input.toString();
}

const TRUSTED_SNAPSHOT: TrustedBrowserSnapshot = {
  state: 'TRUSTED',
  serviceAuthenticated: true,
  browserEndpointId: 'endpoint-a',
  trustSetEpoch: 5,
  acceptedMinEpoch: 5,
  pairingRequestedAtUtc: null,
  lastFingerprint: null,
  actorDeviceSessionToken: 'actor-device-session-token',
};

class StubTrustedBrowserProvider implements TrustedBrowserProvider {
  constructor(private readonly snapshot: TrustedBrowserSnapshot) {}
  async getSnapshot() {
    return this.snapshot;
  }
  async beginServiceAuthentication() { return this.snapshot; }
  async requestPairing() { return this.snapshot; }
  async simulateParentApproval() { return this.snapshot; }
  async simulateEpochGoneStale() { return this.snapshot; }
  async simulateRevoke() { return this.snapshot; }
  async reset() { return this.snapshot; }
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('RealFamilyAuthorityGateway.removeMember', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.cookie = 'pca_family_csrf=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
  });

  it('resolves the family via the session cookie, attaches the actor device token and CSRF header, and returns the real auditEventId', async () => {
    document.cookie = 'pca_family_csrf=csrf-token-1';
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/parent/session')) return Promise.resolve(jsonResponse(200, { familyId: 'fam-1' }));
      if (url.includes('/members/acct-target/remove')) return Promise.resolve(jsonResponse(200, { removed: true, auditEventId: 'audit-real-1' }));
      return Promise.resolve(jsonResponse(404, {}));
    });
    vi.stubGlobal('fetch', fetchMock);

    const gateway = new RealFamilyAuthorityGateway('https://api.example.test', new StubTrustedBrowserProvider(TRUSTED_SNAPSHOT));
    const result = await gateway.removeMember('acct-target');
    expect(result).toEqual({ auditEventId: 'audit-real-1' });

    const removeCall = fetchMock.mock.calls.find((call: unknown[]) => urlOf(call).includes('/members/acct-target/remove'));
    expect(removeCall).toBeDefined();
    const [url, init] = removeCall as [string, RequestInit];
    expect(url).toBe('https://api.example.test/api/parent/families/fam-1/members/acct-target/remove');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer actor-device-session-token');
    expect(headers['X-PCA-CSRF-Token']).toBe('csrf-token-1');
  });

  it('rejects with a clear error, never calling the remove endpoint, when no family session is available', async () => {
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/parent/session')) return Promise.resolve(jsonResponse(401, {}));
      return Promise.resolve(jsonResponse(404, {}));
    });
    vi.stubGlobal('fetch', fetchMock);

    const gateway = new RealFamilyAuthorityGateway('https://api.example.test', new StubTrustedBrowserProvider(TRUSTED_SNAPSHOT));
    await expect(gateway.removeMember('acct-target')).rejects.toThrow('FAMILY_SESSION_UNAVAILABLE');
    expect(fetchMock.mock.calls.some((call: unknown[]) => urlOf(call).includes('/remove'))).toBe(false);
  });

  it('refuses to call the remove endpoint from an untrusted browser', async () => {
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/parent/session')) return Promise.resolve(jsonResponse(200, { familyId: 'fam-1' }));
      return Promise.resolve(jsonResponse(404, {}));
    });
    vi.stubGlobal('fetch', fetchMock);
    const untrusted = new StubTrustedBrowserProvider({ ...TRUSTED_SNAPSHOT, state: 'BROWSER_NOT_TRUSTED', actorDeviceSessionToken: null });

    const gateway = new RealFamilyAuthorityGateway('https://api.example.test', untrusted);
    await expect(gateway.removeMember('acct-target')).rejects.toThrow('TRUSTED_BROWSER_REQUIRED');
    expect(fetchMock.mock.calls.some((call: unknown[]) => urlOf(call).includes('/remove'))).toBe(false);
  });

  it('surfaces the server\'s real error code (e.g. cannot_remove_owner) in the thrown error, never a fabricated success', async () => {
    document.cookie = 'pca_family_csrf=csrf-token-1';
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/parent/session')) return Promise.resolve(jsonResponse(200, { familyId: 'fam-1' }));
      if (url.includes('/remove')) return Promise.resolve(jsonResponse(409, { error: 'cannot_remove_owner' }));
      return Promise.resolve(jsonResponse(404, {}));
    });
    vi.stubGlobal('fetch', fetchMock);

    const gateway = new RealFamilyAuthorityGateway('https://api.example.test', new StubTrustedBrowserProvider(TRUSTED_SNAPSHOT));
    await expect(gateway.removeMember('acct-owner')).rejects.toThrow(/cannot_remove_owner/);
  });

  it('every other FamilyAuthorityGateway method still honestly rejects/denies, unchanged (removeMember is the only real one)', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    // Typed as the interface (not the concrete class) so this exercises the
    // exact contract Members.tsx/useFamilyAction actually call through.
    const gateway: FamilyAuthorityGateway = new RealFamilyAuthorityGateway('https://api.example.test', new StubTrustedBrowserProvider(TRUSTED_SNAPSHOT));

    await expect(gateway.checkPermission('REMOVE_NON_OWNER_PARENT')).resolves.toMatchObject({ allowed: false });
    await expect(gateway.listMembers()).rejects.toThrow();
    await expect(gateway.inviteMember('VIEWER', 'someone@example.test')).rejects.toThrow();
    await expect(gateway.changeRole('acct-target', 'VIEWER')).rejects.toThrow();
    await expect(gateway.transferOwnership('acct-target')).rejects.toThrow();
    await expect(gateway.listAuditTrail()).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
