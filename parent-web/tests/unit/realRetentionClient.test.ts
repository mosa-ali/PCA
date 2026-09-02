// PCA-FR-093: proves RealRetentionClient genuinely reaches
// backend/src/http/routes/retentionRoutes.ts over the browser's existing
// `pca_family_session` HttpOnly cookie.
//
// This client used to short-circuit every call with
// SERVICE_SESSION_UNAVAILABLE before ever calling fetch, on the premise
// that the backend accepted ONLY `Authorization: Bearer`. That premise was
// false: backend/src/auth/fastifyAuthPlugin.ts's createRequireServiceSession
// accepts either the Bearer header or the session cookie, and requires the
// double-submit CSRF header (`x-pca-csrf-token` vs the `pca_family_csrf`
// cookie, backend/src/parentaccount/cookies.ts) only for non-GET requests.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RealRetentionClient, RetentionApiError } from '../../src/api/real/realRetentionClient';
import type { RetentionPolicySettings } from '../../src/domain/retention';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const POLICY: RetentionPolicySettings = {
  generalWindow: '1_MONTH',
  locationMode: 'CURRENT_LAST_ONLY',
  timezone: 'Asia/Riyadh',
};

const DEFAULTS = {
  generalWindow: '1_MONTH',
  availableWindows: ['14_DAYS', '1_MONTH', '3_MONTHS', '6_MONTHS', '9_MONTHS'],
  locationMode: 'CURRENT_LAST_ONLY',
};

describe('RealRetentionClient', () => {
  const apiBaseUrl = 'https://api.example.test';
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    document.cookie = 'pca_family_csrf=; Max-Age=0; path=/';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.cookie = 'pca_family_csrf=; Max-Age=0; path=/';
  });

  /** Browser wiring, matching ../../src/api/client.ts's buildRealClients(). */
  function cookieClient(familyId: string | null = 'fam-1') {
    return new RealRetentionClient(apiBaseUrl, undefined, async () => familyId, true);
  }

  describe('cookie-session transport (the browser wiring)', () => {
    it('getDefaults genuinely calls the real route with browser credentials -- it no longer short-circuits before fetch', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(200, DEFAULTS));

      const defaults = await cookieClient().getDefaults();

      expect(defaults).toEqual(DEFAULTS);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`${apiBaseUrl}/v1/retention-policy/defaults`);
      expect(init.method).toBe('GET');
      expect(init.credentials).toBe('include');
      const headers = init.headers as Record<string, string>;
      expect(headers.Authorization).toBeUndefined();
      // GET is exempt from the server's double-submit check, so no CSRF
      // header is invented for it.
      expect(headers['X-PCA-CSRF-Token']).toBeUndefined();
    });

    it('a mutating call sends the double-submit CSRF header carrying the pca_family_csrf cookie value', async () => {
      document.cookie = 'pca_family_csrf=csrf-token-value; path=/';
      fetchMock.mockResolvedValueOnce(jsonResponse(200, { policy: POLICY, accepted: true }));

      await cookieClient().submitPolicy(POLICY);

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`${apiBaseUrl}/v1/families/fam-1/retention-policy`);
      expect(init.method).toBe('POST');
      expect(init.credentials).toBe('include');
      const headers = init.headers as Record<string, string>;
      expect(headers['X-PCA-CSRF-Token']).toBe('csrf-token-value');
      expect(headers['Content-Type']).toBe('application/json');
      expect(JSON.parse(init.body as string)).toEqual(POLICY);
    });

    it('deleteNow and requestExport also carry the CSRF header (every non-GET route the server double-submit-checks)', async () => {
      document.cookie = 'pca_family_csrf=csrf-token-value; path=/';
      fetchMock.mockResolvedValueOnce(
        jsonResponse(200, { actionId: 'a-1', idempotent: false, plan: { toDelete: [], retainedCount: 0 }, deliveryStatus: 'DELETE_PENDING_REMOTE_DEVICE' }),
      );
      await cookieClient().deleteNow('a-1');
      fetchMock.mockResolvedValueOnce(jsonResponse(202, { exportId: 'x-1', status: 'PENDING_CRYPTO_REVIEW', disclosures: [] }));
      await cookieClient().requestExport();

      for (const call of fetchMock.mock.calls as Array<[string, RequestInit]>) {
        expect((call[1].headers as Record<string, string>)['X-PCA-CSRF-Token']).toBe('csrf-token-value');
      }
      expect((fetchMock.mock.calls[0] as [string, RequestInit])[0]).toBe(`${apiBaseUrl}/v1/families/fam-1/delete-now`);
      expect((fetchMock.mock.calls[1] as [string, RequestInit])[0]).toBe(`${apiBaseUrl}/v1/families/fam-1/export-requests`);
    });

    it('sends an empty CSRF header rather than inventing a value when the cookie is absent -- the server then fails closed with 403', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(403, { error: 'csrf_mismatch' }));

      await expect(cookieClient().submitPolicy(POLICY)).rejects.toMatchObject({ code: 'FORBIDDEN' });

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect((init.headers as Record<string, string>)['X-PCA-CSRF-Token']).toBe('');
    });
  });

  describe('honest failure when no session exists', () => {
    it('the default constructor (no bearer token, no cookie mode) fails fast with SERVICE_SESSION_UNAVAILABLE, without ever calling fetch', async () => {
      const client = new RealRetentionClient(apiBaseUrl);
      await expect(client.getDefaults()).rejects.toMatchObject({ code: 'SERVICE_SESSION_UNAVAILABLE' });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('bearer mode with a null token still fails fast rather than silently omitting the header', async () => {
      const client = new RealRetentionClient(apiBaseUrl, async () => null, async () => 'fam-1');
      await expect(client.getDefaults()).rejects.toBeInstanceOf(RetentionApiError);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('cookie mode with no signed-in family session fails a family-scoped call with FAMILY_CONTEXT_UNAVAILABLE, without calling fetch', async () => {
      await expect(cookieClient(null).submitPolicy(POLICY)).rejects.toMatchObject({ code: 'FAMILY_CONTEXT_UNAVAILABLE' });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('a fetch failure is reported as NETWORK_ERROR, never as a missing session', async () => {
      fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
      await expect(cookieClient().getDefaults()).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
    });
  });

  describe('bearer transport is retained for non-browser callers', () => {
    it('attaches Authorization and does NOT send browser credentials', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(200, DEFAULTS));
      const client = new RealRetentionClient(apiBaseUrl, async () => 'tok', async () => 'fam-1');

      await client.getDefaults();

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
      expect(init.credentials).toBeUndefined();
    });
  });

  describe('honest status mapping (never a fixture fallback)', () => {
    it('maps 401 to UNAUTHORIZED', async () => {
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 401 }));
      await expect(cookieClient().getDefaults()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    });

    it('maps 403 to FORBIDDEN', async () => {
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 403 }));
      await expect(cookieClient().requestExport()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    it('maps 429 to RATE_LIMITED', async () => {
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 429 }));
      await expect(cookieClient().deleteNow('a-1')).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    });
  });
});
