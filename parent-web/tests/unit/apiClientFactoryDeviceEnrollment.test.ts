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

  it('demoMode false: the real deviceEnrollment client honestly rejects with SERVICE_SESSION_UNAVAILABLE rather than fabricating data (no token-issuance flow wired yet)', async () => {
    vi.doMock('../../src/config/env', () => ({
      config: { apiBaseUrl: 'http://localhost:4001', demoMode: false, deviceEnrollmentLinkBaseUrl: 'http://localhost:4000/enroll' },
    }));
    const { getApiClients } = await import('../../src/api/client');
    const clients = getApiClients();
    await expect(clients.deviceEnrollment.listInvitations('fam-1')).rejects.toMatchObject({
      code: 'SERVICE_SESSION_UNAVAILABLE',
    });
  });
});
