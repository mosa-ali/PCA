import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RealBillingClient } from '../../src/api/real/realBillingClient';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('RealBillingClient (PCA-MYKIDS-BILL-3, MYKIDS_COMMERCIAL_API_V1)', () => {
  const apiBaseUrl = 'https://api.example.test';
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function client(opts?: { token?: string | null; familyId?: string | null; deviceId?: string | null }) {
    const token: string | null = opts && 'token' in opts ? (opts.token as string | null) : 'tok';
    const familyId: string | null = opts && 'familyId' in opts ? (opts.familyId as string | null) : 'fam-1';
    const deviceId: string | null = opts && 'deviceId' in opts ? (opts.deviceId as string | null) : 'device-1';
    return new RealBillingClient(
      apiBaseUrl,
      async () => token,
      async () => familyId,
      async () => deviceId,
    );
  }

  describe('honest gap surfacing (no bearer token / no family context / no device id)', () => {
    it('fails fast with SERVICE_SESSION_UNAVAILABLE when no bearer token is available, without ever calling fetch', async () => {
      const c = client({ token: null });
      await expect(c.getEntitlement()).rejects.toMatchObject({ code: 'SERVICE_SESSION_UNAVAILABLE' });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('fails fast with FAMILY_CONTEXT_UNAVAILABLE when no familyId is available', async () => {
      const c = client({ familyId: null });
      await expect(c.getEntitlement()).rejects.toMatchObject({ code: 'FAMILY_CONTEXT_UNAVAILABLE' });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('fails fast with DEVICE_IDENTITY_UNAVAILABLE for a mutation when no actorDeviceId is available', async () => {
      const c = client({ deviceId: null });
      await expect(c.requestLimitIncrease('MANAGED_DEVICE_LIMIT', 3)).rejects.toMatchObject({ code: 'DEVICE_IDENTITY_UNAVAILABLE' });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('the default constructor (no accessors supplied) also honestly rejects rather than silently omitting the header', async () => {
      const c = new RealBillingClient(apiBaseUrl);
      await expect(c.getEntitlement()).rejects.toMatchObject({ code: 'SERVICE_SESSION_UNAVAILABLE' });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('isPaymentProviderAvailable is false when using the default (no browser-reachable token flow) accessor', () => {
      const c = new RealBillingClient(apiBaseUrl);
      expect(c.isPaymentProviderAvailable()).toBe(false);
    });
  });

  describe('endpoint mapping against the verified backend contract', () => {
    it('getEntitlement calls GET /v1/families/:familyId/commercial/entitlement and never Number()s amountMinor', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(200, {
          tier: 'FREE_STARTER',
          parentMemberLimit: 1,
          parentMemberUsed: 1,
          managedDeviceLimit: 1,
          managedDeviceActive: 1,
          managedDeviceReserved: 0,
          availableDeviceSlots: 0,
          overLimitParentMember: false,
          overLimitManagedDevice: false,
          openRequests: [{ requestId: 'req-1', limitType: 'MANAGED_DEVICE_LIMIT', state: 'QUOTED', targetLimit: 2, awaitingAdminQuote: false }],
        }),
      );
      const result = await client().getEntitlement();
      expect(result.tier).toBe('FREE_STARTER');
      expect(result.openRequests[0].requestId).toBe('req-1');
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`${apiBaseUrl}/v1/families/fam-1/commercial/entitlement`);
      expect(init.method).toBe('GET');
      expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
    });

    it('getRequest calls GET .../commercial/requests/:requestId and reassembles quote money as a BigInt-safe MoneyJson (never Number(amountMinor))', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(200, {
          requestId: 'req-1',
          limitType: 'MANAGED_DEVICE_LIMIT',
          currentLimitAtRequest: 1,
          targetLimit: 3,
          state: 'QUOTED',
          awaitingAdminQuote: false,
          quote: {
            quoteKind: 'STANDARD',
            quoteRef: 'qr-1',
            price: { amountMinor: '899999999999999999999', currencyCode: 'USD' }, // beyond Number.MAX_SAFE_INTEGER on purpose
            priceBookVersion: 1,
            quotedAtUtc: '2026-01-01T00:00:00.000Z',
            expiresAtUtc: null,
          },
          noChargeOverride: false,
          denialReason: null,
          createdAtUtc: '2026-01-01T00:00:00.000Z',
          updatedAtUtc: '2026-01-01T00:00:00.000Z',
        }),
      );
      const request = await client().getRequest('req-1');
      expect(request?.quote?.price.amountMinor).toBe('899999999999999999999');
      expect(BigInt(request!.quote!.price.amountMinor)).toBe(899999999999999999999n);
      const [url] = fetchMock.mock.calls[0] as [string];
      expect(url).toBe(`${apiBaseUrl}/v1/families/fam-1/commercial/requests/req-1`);
    });

    it('getRequest returns null on 404 (NOT_FOUND and CROSS_FAMILY are deliberately indistinguishable per contract)', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(404, { error: 'not_found' }));
      const request = await client().getRequest('nope');
      expect(request).toBeNull();
    });

    it('requestLimitIncrease POSTs actorDeviceId in the body (Owner-authority gate requirement)', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(201, {
          requestId: 'req-2',
          limitType: 'PARENT_MEMBER_LIMIT',
          currentLimitAtRequest: 1,
          targetLimit: 2,
          state: 'PENDING',
          awaitingAdminQuote: false,
          quote: null,
          noChargeOverride: false,
          denialReason: null,
          createdAtUtc: '2026-01-01T00:00:00.000Z',
          updatedAtUtc: '2026-01-01T00:00:00.000Z',
        }),
      );
      await client().requestLimitIncrease('PARENT_MEMBER_LIMIT', 2);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`${apiBaseUrl}/v1/families/fam-1/commercial/requests`);
      expect(init.method).toBe('POST');
      expect(JSON.parse(init.body as string)).toEqual({ limitType: 'PARENT_MEMBER_LIMIT', targetLimit: 2, actorDeviceId: 'device-1' });
    });

    it('a 403 with FAMILY_COMMERCIAL_AUTHORITY_UNAVAILABLE code and a bare 403 both map to the SAME FORBIDDEN error code -- never used to infer role', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(403, { error: 'forbidden', code: 'FAMILY_COMMERCIAL_AUTHORITY_UNAVAILABLE' }));
      const withCode = await client().requestLimitIncrease('MANAGED_DEVICE_LIMIT', 2).catch((e) => e);
      expect(withCode.code).toBe('FORBIDDEN');

      fetchMock.mockResolvedValueOnce(jsonResponse(403, { error: 'forbidden' }));
      const withoutCode = await client().requestLimitIncrease('MANAGED_DEVICE_LIMIT', 2).catch((e) => e);
      expect(withoutCode.code).toBe('FORBIDDEN');
      // Production posture today: AUTHORITY_UNAVAILABLE always -- this
      // client must not behave differently for the two shapes above.
      expect(withCode.message).toBe(withoutCode.message);
    });

    it('beginCheckout POSTs requestId/returnUrl/actorDeviceId and returns the raw CheckoutSession (never itself confirms payment)', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(201, { paymentAttemptId: 'pay-1', provider: 'TEST_SANDBOX', redirectUrl: 'https://provider.example/checkout/1', status: 'PENDING' }),
      );
      const session = await client().beginCheckout('req-1', 'https://mykids.example/return');
      expect(session).toEqual({ paymentAttemptId: 'pay-1', provider: 'TEST_SANDBOX', redirectUrl: 'https://provider.example/checkout/1', status: 'PENDING' });
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`${apiBaseUrl}/v1/families/fam-1/billing/checkout`);
      expect(JSON.parse(init.body as string)).toEqual({ requestId: 'req-1', returnUrl: 'https://mykids.example/return', actorDeviceId: 'device-1' });
    });

    it('getCheckoutStatus calls GET .../billing/checkout/:paymentAttemptId and reassembles money without Number(amountMinor)', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(200, { paymentAttemptId: 'pay-1', status: 'PENDING', amountMinor: '499', currencyCode: 'USD', increaseRequestRef: 'req-1' }),
      );
      const status = await client().getCheckoutStatus('pay-1');
      expect(status).toEqual({ paymentAttemptId: 'pay-1', status: 'PENDING', amount: { amountMinor: '499', currencyCode: 'USD' }, increaseRequestRef: 'req-1' });
      const [url] = fetchMock.mock.calls[0] as [string];
      expect(url).toBe(`${apiBaseUrl}/v1/families/fam-1/billing/checkout/pay-1`);
    });

    it('listPaymentMethods never round-trips a PAN/CVV-shaped field even if the server response were to include one (explicit allowlist copy)', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(200, {
          paymentMethods: [
            {
              paymentMethodId: 'pm-1',
              brand: 'VISA',
              last4: '4242',
              expiryMonth: 12,
              expiryYear: 2030,
              displayLabel: 'Visa •••• 4242',
              // Simulated defect: a server that accidentally leaked raw card
              // data. This client must never surface it.
              pan: '4242424242424242',
              cvv: '123',
            },
          ],
        }),
      );
      const methods = await client().listPaymentMethods();
      expect(methods).toEqual([{ paymentMethodId: 'pm-1', brand: 'VISA', last4: '4242', expiryMonth: 12, expiryYear: 2030, displayLabel: 'Visa •••• 4242' }]);
      expect(JSON.stringify(methods)).not.toMatch(/4242424242424242|123/);
    });

    it('rejects an unsupported currency code from the server rather than silently accepting it', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(200, {
          invoiceId: 'inv-1',
          status: 'PAID',
          total: { amountMinor: '100', currencyCode: 'EUR' },
          createdAtUtc: '2026-01-01T00:00:00.000Z',
          periodStartUtc: null,
          periodEndUtc: null,
          lines: [],
        }),
      );
      await expect(client().getInvoice('inv-1')).rejects.toThrow(/Unsupported currency/);
    });

    it('beginAddPaymentMethod and cancelAutoRenew honestly reject -- no such route exists on MYKIDS_COMMERCIAL_API_V1', async () => {
      await expect(client().beginAddPaymentMethod()).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(client().cancelAutoRenew()).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
