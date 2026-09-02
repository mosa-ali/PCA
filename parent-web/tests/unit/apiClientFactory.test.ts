import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

/**
 * Verifies the corrected demo-mode discipline documented in
 * src/api/client.ts. Previously, demo mode OFF fell back to fixtures on
 * ANY construction failure (a production-fallback bug: a real backend
 * being unreachable/not-yet-implemented would silently render as a
 * working demo). Now:
 *  - demo mode ON -> fixtures, unchanged.
 *  - demo mode OFF -> the real ServiceAuthClient plus explicit
 *    "unavailable" providers for interfaces with no real backend yet,
 *    never fixtures, and isFixtureBacked is false.
 *  - demo mode OFF + an unexpected construction failure -> propagates
 *    (the caller/AppErrorBoundary sees it), never silently swallowed into
 *    a fixture bundle.
 */
describe('getApiClients demo-mode discipline', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.doUnmock('../../src/config/env');
    vi.doUnmock('../../src/api/real/unavailableProviders');
  });

  it('uses fixtures directly (isFixtureBacked: true) when demoMode is explicitly true', async () => {
    vi.doMock('../../src/config/env', () => ({
      config: { apiBaseUrl: 'http://localhost:4001', demoMode: true },
    }));
    const { getApiClients } = await import('../../src/api/client');
    const { DevServiceAuthClient } = await import('../../src/api/dev/devServiceAuthClient');
    const clients = getApiClients();
    expect(clients.isFixtureBacked).toBe(true);
    expect(clients.serviceAuth).toBeInstanceOf(DevServiceAuthClient);
  });

  it('never falls back to fixtures when demoMode is false: serviceAuth is the real client, isFixtureBacked is false', async () => {
    vi.doMock('../../src/config/env', () => ({
      config: { apiBaseUrl: 'http://localhost:4001', demoMode: false },
    }));
    const { getApiClients } = await import('../../src/api/client');
    const { RealServiceAuthClient } = await import('../../src/api/real/realServiceAuthClient');
    const clients = getApiClients();
    expect(clients.isFixtureBacked).toBe(false);
    expect(clients.serviceAuth).toBeInstanceOf(RealServiceAuthClient);
  });

  it('demoMode false: parentFamilyData is the real, crypto-gated provider, not a dev fixture', async () => {
    vi.doMock('../../src/config/env', () => ({
      config: { apiBaseUrl: 'http://localhost:4001', demoMode: false },
    }));
    const { getApiClients } = await import('../../src/api/client');
    const { DevParentFamilyDataGateway } = await import('../../src/api/dev/devParentFamilyDataGateway');
    const { RealParentFamilyDataGateway } = await import('../../src/api/real/realParentFamilyDataGateway');
    const clients = getApiClients();
    expect(clients.parentFamilyData).toBeInstanceOf(RealParentFamilyDataGateway);
    expect(clients.parentFamilyData).not.toBeInstanceOf(DevParentFamilyDataGateway);
  });

  it('demoMode false: the real parentFamilyData provider rejects with EndpointNotTrustedError rather than returning fixture-shaped data (this browser has never paired)', async () => {
    vi.doMock('../../src/config/env', () => ({
      config: { apiBaseUrl: 'http://localhost:4001', demoMode: false },
    }));
    const { getApiClients } = await import('../../src/api/client');
    const clients = getApiClients();
    await expect(clients.parentFamilyData.getScreenTime('child-amir')).rejects.toMatchObject({
      code: 'ENDPOINT_NOT_TRUSTED',
    });
  });

  it('demoMode false: an unavailable familyAuthority provider denies permission by default (fail closed), never grants', async () => {
    vi.doMock('../../src/config/env', () => ({
      config: { apiBaseUrl: 'http://localhost:4001', demoMode: false },
    }));
    const { getApiClients } = await import('../../src/api/client');
    const clients = getApiClients();
    const result = await clients.familyAuthority.checkPermission('EDIT_CHILD_POLICY');
    expect(result.allowed).toBe(false);
  });

  it('demoMode false: billing is the real, HTTP-backed RealBillingClient (PCA-MYKIDS-BILL-3) -- never UnavailableBillingClient', async () => {
    vi.doMock('../../src/config/env', () => ({
      config: { apiBaseUrl: 'http://localhost:4001', demoMode: false },
    }));
    const { getApiClients } = await import('../../src/api/client');
    const { RealBillingClient } = await import('../../src/api/real/realBillingClient');
    const clients = getApiClients();
    expect(clients.billing).toBeInstanceOf(RealBillingClient);
    // The real client now uses the existing HttpOnly family-session cookie;
    // it never falls back to fixtures when that session is absent.
    expect(clients.billing.isPaymentProviderAvailable()).toBe(true);
  });

  it('demoMode false: commercialNotifications is the real, HTTP-backed RealCommercialNotificationClient', async () => {
    vi.doMock('../../src/config/env', () => ({
      config: { apiBaseUrl: 'http://localhost:4001', demoMode: false },
    }));
    const { getApiClients } = await import('../../src/api/client');
    const { RealCommercialNotificationClient } = await import('../../src/api/real/realCommercialNotificationClient');
    const clients = getApiClients();
    expect(clients.commercialNotifications).toBeInstanceOf(RealCommercialNotificationClient);
  });

  it('demoMode true: billing is the fixture-backed DevBillingClient', async () => {
    vi.doMock('../../src/config/env', () => ({
      config: { apiBaseUrl: 'http://localhost:4001', demoMode: true },
    }));
    const { getApiClients } = await import('../../src/api/client');
    const { DevBillingClient } = await import('../../src/api/dev/devBillingClient');
    const clients = getApiClients();
    expect(clients.billing).toBeInstanceOf(DevBillingClient);
    expect(clients.billing.isPaymentProviderAvailable()).toBe(true);
  });

  it('demoMode false + a forced real-client construction failure surfaces as a thrown error, NOT a silent fixture fallback', async () => {
    vi.doMock('../../src/config/env', () => ({
      config: { apiBaseUrl: 'http://localhost:4001', demoMode: false },
    }));
    vi.doMock('../../src/api/real/unavailableProviders', async () => {
      const actual = await vi.importActual<typeof import('../../src/api/real/unavailableProviders')>(
        '../../src/api/real/unavailableProviders',
      );
      return {
        ...actual,
        UnavailableFamilyAuthorityGateway: class {
          constructor() {
            throw new Error('simulated programmer-error construction failure');
          }
        },
      };
    });
    const { getApiClients } = await import('../../src/api/client');
    expect(() => getApiClients()).toThrow(/simulated programmer-error construction failure/);
  });

  it('the runtime sync client and real service auth client are both wired into the module (no missing exports)', async () => {
    const runtimeSyncModule = await import('../../src/api/dev/devRuntimeSyncClient');
    const realAuthModule = await import('../../src/api/real/realServiceAuthClient');
    const realSyncModule = await import('../../src/api/real/realParentRuntimeSyncClient');
    expect(runtimeSyncModule.DevRuntimeSyncClient).toBeTypeOf('function');
    expect(realAuthModule.RealServiceAuthClient).toBeTypeOf('function');
    expect(realSyncModule.RealParentRuntimeSyncClient).toBeTypeOf('function');
  });

  it('demoMode false: trustedBrowser, deviceStatus and requests are the real implementations, not Unavailable* stand-ins', async () => {
    vi.doMock('../../src/config/env', () => ({
      config: { apiBaseUrl: 'http://localhost:4001', demoMode: false },
    }));
    const { getApiClients } = await import('../../src/api/client');
    const { RealTrustedBrowserProvider } = await import('../../src/api/real/realTrustedBrowserProvider');
    const { RealDeviceStatusClient } = await import('../../src/api/real/realDeviceStatusClient');
    const { RealRequestClient } = await import('../../src/api/real/realRequestClient');
    const clients = getApiClients();
    expect(clients.trustedBrowser).toBeInstanceOf(RealTrustedBrowserProvider);
    expect(clients.deviceStatus).toBeInstanceOf(RealDeviceStatusClient);
    expect(clients.requests).toBeInstanceOf(RealRequestClient);
    // runtimeSync is deliberately NOT asserted here -- see the dedicated
    // describe block below: it is now PARTIALLY real (RealParentRuntimeSyncClient),
    // not a plain Real*/Unavailable* dichotomy this assertion list assumes.
  });
});

/**
 * Regression guard for the parent runtime-sync relay wiring.
 *
 * buildRealClients() used to wire a DIFFERENT RealParentRuntimeSyncClient in
 * production that targeted `/api/sync/*`, a surface this backend never
 * served at all -- the only runtime-sync API the backend shipped at the
 * time was `/v1/runtime-sync/*`, the DEVICE-facing relay behind a
 * device-session challenge/signature, a different API with a different
 * caller. A real-browser sweep proved the consequence: every Dashboard,
 * ChildOverview and ScreenTimePage load fired real 404s at the backend.
 * That was fixed by wiring UnavailableParentRuntimeSyncClient instead (every
 * method honestly rejects).
 *
 * Since then, backend/src/http/routes/parentRuntimeSyncRoutes.ts shipped a
 * genuine PARENT-session-authenticated, read-only counterpart to the
 * device-facing status route, scoped to one of the caller's own family's
 * devices. ../../src/api/real/realParentRuntimeSyncClient.ts's
 * RealParentRuntimeSyncClient now targets it for the 3 read-only
 * bookkeeping methods (getConnectionStatus/getLastSuccessfulSync/
 * getPendingDeliveryStatus) -- it extends UnavailableParentRuntimeSyncClient
 * and inherits its fail-closed behavior for the 3 mutating envelope methods
 * unchanged (submitCiphertextEnvelope/listQueuedForEndpoint/
 * acknowledgeEnvelope still need the not-yet-built, crypto-review-gated
 * parent-sdk E2EE client).
 */
describe('parent runtime-sync client: read-only status is real; mutating envelope methods remain fail-closed', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.doUnmock('../../src/config/env');
    vi.unstubAllGlobals();
  });

  it('demoMode false: runtimeSync is the RealParentRuntimeSyncClient wired against the new parent-facing status route', async () => {
    vi.doMock('../../src/config/env', () => ({
      config: { apiBaseUrl: 'http://localhost:4001', demoMode: false },
    }));
    const { getApiClients } = await import('../../src/api/client');
    const { RealParentRuntimeSyncClient } = await import(
      '../../src/api/real/realParentRuntimeSyncClient'
    );
    const clients = getApiClients();
    expect(clients.runtimeSync).toBeInstanceOf(RealParentRuntimeSyncClient);
  });

  it('demoMode false: the 3 mutating envelope methods still honestly reject with NOT_IMPLEMENTED -- the parent-sdk E2EE crypto client remains unbuilt', async () => {
    vi.doMock('../../src/config/env', () => ({
      config: { apiBaseUrl: 'http://localhost:4001', demoMode: false },
    }));
    const fetchSpy = vi.fn(() => Promise.reject(new Error('no network call expected for a fail-closed mutating method')));
    vi.stubGlobal('fetch', fetchSpy);
    const { getApiClients } = await import('../../src/api/client');
    const { ServiceUnavailableError } = await import('../../src/api/unavailable');
    const clients = getApiClients();

    await expect(
      clients.runtimeSync.submitCiphertextEnvelope({ targetEndpointId: 'device-1', policyRevision: 1, payloadCiphertextBase64: 'AA==' }),
    ).rejects.toBeInstanceOf(ServiceUnavailableError);
    await expect(clients.runtimeSync.listQueuedForEndpoint('device-1')).rejects.toBeInstanceOf(ServiceUnavailableError);
    await expect(clients.runtimeSync.acknowledgeEnvelope('envelope-1')).rejects.toBeInstanceOf(ServiceUnavailableError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('every UnavailableParentRuntimeSyncClient port method rejects with a NOT_IMPLEMENTED ServiceUnavailableError and issues no network request (base-class behavior, unchanged)', async () => {
    const fetchSpy = vi.fn(() => Promise.reject(new Error('no network call expected')));
    vi.stubGlobal('fetch', fetchSpy);
    const { UnavailableParentRuntimeSyncClient } = await import(
      '../../src/api/real/unavailableProviders'
    );
    const { ServiceUnavailableError } = await import('../../src/api/unavailable');
    const client = new UnavailableParentRuntimeSyncClient();

    const calls: Array<[string, () => Promise<unknown>]> = [
      ['submitCiphertextEnvelope', () =>
        client.submitCiphertextEnvelope({
          targetEndpointId: 'endpoint-1',
          policyRevision: 1,
          payloadCiphertextBase64: 'AA==',
        })],
      ['listQueuedForEndpoint', () => client.listQueuedForEndpoint('endpoint-1')],
      ['acknowledgeEnvelope', () => client.acknowledgeEnvelope('envelope-1')],
      ['getConnectionStatus', () => client.getConnectionStatus()],
      ['getLastSuccessfulSync', () => client.getLastSuccessfulSync()],
      ['getPendingDeliveryStatus', () => client.getPendingDeliveryStatus('endpoint-1')],
    ];

    for (const [name, call] of calls) {
      const error = await call().then(
        () => {
          throw new Error(`${name} resolved; it must reject while the relay is unbuilt`);
        },
        (e: unknown) => e,
      );
      expect(error, name).toBeInstanceOf(ServiceUnavailableError);
      expect((error as { code: string }).code, name).toBe('NOT_IMPLEMENTED');
      expect((error as Error).message, name).toContain(`ParentRuntimeSyncClient.${name}`);
    }

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('the rejection maps to the honest localized copy, not the generic unknown-error sentence', async () => {
    const { UnavailableParentRuntimeSyncClient } = await import(
      '../../src/api/real/unavailableProviders'
    );
    const { userFacingErrorKey } = await import('../../src/i18n/errorMessages');
    const client = new UnavailableParentRuntimeSyncClient();
    const error = await client.getPendingDeliveryStatus('endpoint-1').catch((e: unknown) => e);
    expect(userFacingErrorKey(error)).toBe('errors.serviceUnavailable');

    // The pre-fix behaviour for comparison: the real client threw a bare Error
    // on the 404, which this mapper cannot name, so a parent saw errors.unknown.
    expect(userFacingErrorKey(new Error('getPendingDeliveryStatus: unexpected status 404'))).toBeNull();
  });

  it('implements the whole ParentRuntimeSyncClient port -- no method silently missing', async () => {
    const { UnavailableParentRuntimeSyncClient } = await import(
      '../../src/api/real/unavailableProviders'
    );
    const client = new UnavailableParentRuntimeSyncClient();
    for (const method of [
      'submitCiphertextEnvelope',
      'listQueuedForEndpoint',
      'acknowledgeEnvelope',
      'getConnectionStatus',
      'getLastSuccessfulSync',
      'getPendingDeliveryStatus',
    ]) {
      expect(client[method as keyof typeof client], method).toBeTypeOf('function');
    }
  });
});
