import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('getApiClients deviceEnrollment wiring', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.doUnmock('../../src/config/env');
  });

  it('demoMode true: deviceEnrollment is the Dev fixture client', async () => {
    vi.doMock('../../src/config/env', () => ({
      config: { apiBaseUrl: 'http://localhost:4001', demoMode: true, deviceEnrollmentLinkBaseUrl: 'http://localhost:4000/enroll' },
    }));
    const { getApiClients } = await import('../../src/api/client');
    const { DevDeviceEnrollmentClient } = await import('../../src/api/dev/devDeviceEnrollmentClient');
    const clients = getApiClients();
    expect(clients.deviceEnrollment).toBeInstanceOf(DevDeviceEnrollmentClient);
  });

  it('demoMode false: deviceEnrollment is the Real HTTP client, never the Dev fixture', async () => {
    vi.doMock('../../src/config/env', () => ({
      config: { apiBaseUrl: 'http://localhost:4001', demoMode: false, deviceEnrollmentLinkBaseUrl: 'http://localhost:4000/enroll' },
    }));
    const { getApiClients } = await import('../../src/api/client');
    const { RealDeviceEnrollmentClient } = await import('../../src/api/real/realDeviceEnrollmentClient');
    const { DevDeviceEnrollmentClient } = await import('../../src/api/dev/devDeviceEnrollmentClient');
    const clients = getApiClients();
    expect(clients.deviceEnrollment).toBeInstanceOf(RealDeviceEnrollmentClient);
    expect(clients.deviceEnrollment).not.toBeInstanceOf(DevDeviceEnrollmentClient);
  });

  // Was: "honestly rejects with SERVICE_SESSION_UNAVAILABLE ... (no token-issuance
  // flow wired yet)". That contract is gone. PPR-1 (d4c9b4e) wired this client to
  // the cookie session transport because the restriction it short-circuited on did
  // not exist -- fastifyAuthPlugin accepts the pca_family_session cookie. The
  // factory now constructs it with cookieSession = true, so request()'s
  // SERVICE_SESSION_UNAVAILABLE guard (which fires only on !cookieSession && !token)
  // correctly does NOT fire, and the client really does attempt the call.
  //
  // The guarantee worth pinning is the one the original test was named for: it
  // REJECTS rather than fabricating data. Asserting the specific code the factory
  // path now produces would just be asserting that jsdom has no server behind
  // localhost:4001, which is a property of the test environment, not of the client.
  it('demoMode false: the real deviceEnrollment client rejects rather than fabricating data', async () => {
    vi.doMock('../../src/config/env', () => ({
      config: { apiBaseUrl: 'http://localhost:4001', demoMode: false, deviceEnrollmentLinkBaseUrl: 'http://localhost:4000/enroll' },
    }));
    const { getApiClients } = await import('../../src/api/client');
    const { DeviceEnrollmentError } = await import('../../src/api/deviceEnrollmentClient');
    const clients = getApiClients();
    const outcome = await clients.deviceEnrollment
      .listInvitations('fam-1')
      .then((value) => ({ resolved: true as const, value }), (error: unknown) => ({ resolved: false as const, error }));
    expect(outcome.resolved, 'the real client must never resolve with invented invitations').toBe(false);
    if (outcome.resolved) return;
    expect(outcome.error).toBeInstanceOf(DeviceEnrollmentError);
  });

  // The SERVICE_SESSION_UNAVAILABLE guard still exists and is still load-bearing --
  // it is simply not reachable through the browser factory any more. Exercise it at
  // the seam where it actually lives: bearer mode with no token obtainable.
  it('bearer mode with no obtainable token still fails closed with SERVICE_SESSION_UNAVAILABLE', async () => {
    const { RealDeviceEnrollmentClient } = await import('../../src/api/real/realDeviceEnrollmentClient');
    const bearerOnly = new RealDeviceEnrollmentClient('http://localhost:4001', async () => null, false);
    await expect(bearerOnly.listInvitations('fam-1')).rejects.toMatchObject({
      code: 'SERVICE_SESSION_UNAVAILABLE',
    });
  });
});
