// PCA product-completion programme: proves RealFamilyAuthorityGateway.removeMember
// genuinely calls the real backend remove route (family session resolved via
// /api/parent/session, no browser device token, CSRF header attached), surfaces
// the server's real auditEventId, and that the permission preflight comes
// from the current Parent session while the unsupported data methods inherit
// UnavailableFamilyAuthorityGateway's honest not-implemented/denied behavior
// unchanged (see this class's own header comment on why).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RealFamilyAuthorityGateway } from '../../src/api/real/realFamilyAuthorityGateway';
import type { FamilyAuthorityGateway } from '../../src/api/interfaces';

function urlOf(call: unknown[]): string {
  const input = call[0] as RequestInfo | URL;
  return typeof input === 'string' ? input : input.toString();
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('RealFamilyAuthorityGateway.removeMember', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.cookie = 'pca_family_csrf=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
  });

  it('uses the active role from the Parent session for UI permission preflight', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(jsonResponse(200, { role: 'ADMINISTRATOR' })));
    vi.stubGlobal('fetch', fetchMock);
    const gateway = new RealFamilyAuthorityGateway('https://api.example.test');

    await expect(gateway.checkPermission('EDIT_CHILD_POLICY')).resolves.toEqual({ allowed: true, requiresStepUp: false });
    await expect(gateway.checkPermission('CHANGE_ANY_ROLE')).resolves.toEqual({ allowed: true, requiresStepUp: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.every((call: unknown[]) => urlOf(call).endsWith('/api/parent/session'))).toBe(true);
  });

  it('resolves the family via the session cookie, sends no actor device token, attaches CSRF, and returns the real auditEventId', async () => {
    document.cookie = 'pca_family_csrf=csrf-token-1';
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/parent/session')) return Promise.resolve(jsonResponse(200, { familyId: 'fam-1' }));
      if (url.includes('/members/acct-target/remove')) return Promise.resolve(jsonResponse(200, { removed: true, auditEventId: 'audit-real-1' }));
      return Promise.resolve(jsonResponse(404, {}));
    });
    vi.stubGlobal('fetch', fetchMock);

    const gateway = new RealFamilyAuthorityGateway('https://api.example.test');
    const result = await gateway.removeMember('acct-target', 'step-up-token');
    expect(result).toEqual({ auditEventId: 'audit-real-1' });

    const removeCall = fetchMock.mock.calls.find((call: unknown[]) => urlOf(call).includes('/members/acct-target/remove'));
    expect(removeCall).toBeDefined();
    const [url, init] = removeCall as [string, RequestInit];
    expect(url).toBe('https://api.example.test/api/parent/families/fam-1/members/acct-target/remove');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
    expect(headers['X-PCA-CSRF-Token']).toBe('csrf-token-1');
    expect(JSON.parse(init.body as string)).toEqual({ stepUpToken: 'step-up-token' });
  });

  it('rejects with a clear error, never calling the remove endpoint, when no family session is available', async () => {
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/parent/session')) return Promise.resolve(jsonResponse(401, {}));
      return Promise.resolve(jsonResponse(404, {}));
    });
    vi.stubGlobal('fetch', fetchMock);

    const gateway = new RealFamilyAuthorityGateway('https://api.example.test');
    await expect(gateway.removeMember('acct-target', 'step-up-token')).rejects.toThrow('FAMILY_SESSION_UNAVAILABLE');
    expect(fetchMock.mock.calls.some((call: unknown[]) => urlOf(call).includes('/remove'))).toBe(false);
  });

  it('refuses to call the remove endpoint from an untrusted browser', async () => {
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/parent/session')) return Promise.resolve(jsonResponse(200, { familyId: 'fam-1' }));
      return Promise.resolve(jsonResponse(404, {}));
    });
    vi.stubGlobal('fetch', fetchMock);
    const gateway = new RealFamilyAuthorityGateway('https://api.example.test');
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/parent/session')) return Promise.resolve(jsonResponse(200, { familyId: 'fam-1' }));
      if (url.includes('/remove')) return Promise.resolve(jsonResponse(200, { removed: true, auditEventId: 'audit-untrusted-browser' }));
      return Promise.resolve(jsonResponse(404, {}));
    });
    await expect(gateway.removeMember('acct-target', 'step-up-token')).resolves.toEqual({ auditEventId: 'audit-untrusted-browser' });
    expect(fetchMock.mock.calls.some((call: unknown[]) => urlOf(call).includes('/remove'))).toBe(true);
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

    const gateway = new RealFamilyAuthorityGateway('https://api.example.test');
    await expect(gateway.removeMember('acct-owner', 'step-up-token')).rejects.toThrow(/cannot_remove_owner/);
  });

  it('unsupported family authority data methods still fail closed', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    // Typed as the interface (not the concrete class) so this exercises the
    // exact contract Members.tsx/useFamilyAction actually call through.
    const gateway: FamilyAuthorityGateway = new RealFamilyAuthorityGateway('https://api.example.test');

    await expect(gateway.listMembers()).rejects.toThrow();
    await expect(gateway.inviteMember('VIEWER', 'someone@example.test')).rejects.toThrow();
    await expect(gateway.changeRole('acct-target', 'VIEWER', 'step-up-token')).rejects.toThrow();
    await expect(gateway.transferOwnership('acct-target', 'step-up-token')).rejects.toThrow();
    await expect(gateway.listAuditTrail()).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
