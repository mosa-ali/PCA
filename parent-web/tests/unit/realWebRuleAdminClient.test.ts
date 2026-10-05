// PCA-SEC-023: until Web Rules has an encrypted API/storage/delivery
// contract, the real-mode adapter must reject before any request is sent.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RealWebRuleAdminClient } from '../../src/api/real/realWebRuleAdminClient';

describe('RealWebRuleAdminClient (family crypto gate closed)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    ['listRules', (client: RealWebRuleAdminClient) => client.listRules('child-1')],
    ['setRule', (client: RealWebRuleAdminClient) => client.setRule('child-1', 'sensitive.example', 'DENY')],
    ['removeRule', (client: RealWebRuleAdminClient) => client.removeRule('child-1', 'sensitive.example', 'DENY')],
  ])('%s rejects before any fetch while family crypto is not ready', async (_operation, invoke) => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const client = new RealWebRuleAdminClient();

    await expect(invoke(client)).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
