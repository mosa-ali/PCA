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
    // No browser-reachable bearer-token issuance flow exists yet (see
    // realBillingClient.ts's header) -- isPaymentProviderAvailable must
    // honestly report false, and any call must fail with the distinct
    // SERVICE_SESSION_UNAVAILABLE code, never fixture-shaped data.
    expect(clients.billing.isPaymentProviderAvailable()).toBe(false);
    await expect(clients.billing.getEntitlement()).rejects.toMatchObject({ code: 'SERVICE_SESSION_UNAVAILABLE' });
  });

  it('demoMode false: commercialNotifications is the real, HTTP-backed RealCommercialNotificationClient', async () => {
    vi.doMock('../../src/config/env', () => ({
      config: { apiBaseUrl: 'http://localhost:4001', demoMode: false },
    }));
    const { getApiClients } = await import('../../src/api/client');
    const { RealCommercialNotificationClient } = await import('../../src/api/real/realCommercialNotificationClient');
    const clients = getApiClients();
    expect(clients.commercialNotifications).toBeInstanceOf(RealCommercialNotificationClient);
    await expect(clients.commercialNotifications.list()).rejects.toMatchObject({ code: 'SERVICE_SESSION_UNAVAILABLE' });
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

  it('demoMode false: trustedBrowser and runtimeSync are the real implementations, not Unavailable* stand-ins', async () => {
    vi.doMock('../../src/config/env', () => ({
      config: { apiBaseUrl: 'http://localhost:4001', demoMode: false },
    }));
    const { getApiClients } = await import('../../src/api/client');
    const { RealTrustedBrowserProvider } = await import('../../src/api/real/realTrustedBrowserProvider');
    const { RealParentRuntimeSyncClient } = await import('../../src/api/real/realParentRuntimeSyncClient');
    const { RealDeviceStatusClient } = await import('../../src/api/real/realDeviceStatusClient');
    const { RealRequestClient } = await import('../../src/api/real/realRequestClient');
    const clients = getApiClients();
    expect(clients.trustedBrowser).toBeInstanceOf(RealTrustedBrowserProvider);
    expect(clients.runtimeSync).toBeInstanceOf(RealParentRuntimeSyncClient);
    expect(clients.deviceStatus).toBeInstanceOf(RealDeviceStatusClient);
    expect(clients.requests).toBeInstanceOf(RealRequestClient);
  });
});
