// Generic family crypto readiness does not authorize readable Web Rules
// DTOs. Force that shared gate READY to prove this adapter remains
// unavailable until PCA-SEC-023-compliant encrypted storage/delivery exists.
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@pca/parent-sdk-browser-runtime', async () => {
  const actual = await vi.importActual<typeof import('@pca/parent-sdk-browser-runtime')>('@pca/parent-sdk-browser-runtime');
  return { ...actual, getCryptoGateDecision: () => ({ status: 'READY' as const, reason: 'test override' }) };
});

const { RealWebRuleAdminClient } = await import('../../src/api/real/realWebRuleAdminClient');
const { ServiceUnavailableError } = await import('../../src/api/unavailable');

describe('RealWebRuleAdminClient mutations (generic crypto gate READY)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('listRules remains unavailable and sends no readable-rule request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const client = new RealWebRuleAdminClient();

    await expect(client.listRules('child-1')).rejects.toBeInstanceOf(ServiceUnavailableError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('setRule cannot send a plaintext domain even when generic crypto is ready', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const client = new RealWebRuleAdminClient();
    const sensitiveDomain = 'sensitive-family-policy.example';

    const error = await client.setRule('child-1', sensitiveDomain, 'DENY').catch((value: unknown) => value);
    expect(error).toBeInstanceOf(ServiceUnavailableError);
    expect(String(error)).not.toContain(sensitiveDomain);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('removeRule cannot send a plaintext domain even when generic crypto is ready', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const client = new RealWebRuleAdminClient();
    const sensitiveDomain = 'sensitive-family-policy.example';

    const error = await client.removeRule('child-1', sensitiveDomain, 'DENY').catch((value: unknown) => value);
    expect(error).toBeInstanceOf(ServiceUnavailableError);
    expect(String(error)).not.toContain(sensitiveDomain);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
