import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

/**
 * Verifies the demo-mode discipline documented in src/api/client.ts: a
 * non-demo build with no reachable backend must still be flagged
 * isFixtureBacked: true (so DemoBanner etc. never masquerade fixture data
 * as real), never silently pretend to be a real/production client bundle.
 */
describe('getApiClients demo-mode discipline', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.doUnmock('../../src/config/env');
  });

  it('falls back to fixtures (and reports isFixtureBacked: true) when demoMode is false and no backend exists', async () => {
    vi.doMock('../../src/config/env', () => ({
      config: { apiBaseUrl: 'http://localhost:4001', demoMode: false },
    }));
    const { getApiClients } = await import('../../src/api/client');
    const clients = getApiClients();
    expect(clients.isFixtureBacked).toBe(true);
  });

  it('uses fixtures directly (isFixtureBacked: true) when demoMode is explicitly true', async () => {
    vi.doMock('../../src/config/env', () => ({
      config: { apiBaseUrl: 'http://localhost:4001', demoMode: true },
    }));
    const { getApiClients } = await import('../../src/api/client');
    const clients = getApiClients();
    expect(clients.isFixtureBacked).toBe(true);
  });

  it('the runtime sync client and real service auth client are both wired into the module (no missing exports)', async () => {
    const runtimeSyncModule = await import('../../src/api/dev/devRuntimeSyncClient');
    const realAuthModule = await import('../../src/api/real/realServiceAuthClient');
    expect(runtimeSyncModule.DevRuntimeSyncClient).toBeTypeOf('function');
    expect(realAuthModule.RealServiceAuthClient).toBeTypeOf('function');
  });
});
