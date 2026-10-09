import { afterEach, describe, expect, it, vi } from 'vitest';
import { RealSchedulePolicyClient } from '../../src/api/real/realSchedulePolicyClient';
import type { SchedulePolicyEnvelopeInput } from '../../src/api/schedulePolicyAuthoring';
import type { TrustedBrowserProvider, TrustedBrowserSnapshot } from '../../src/domain/trustedBrowser';

const ENVELOPE: SchedulePolicyEnvelopeInput = {
  protocolMajor: 1,
  protocolMinor: 0,
  messageId: 'policy-message-1',
  familyId: 'family-1',
  senderDeviceId: 'parent-device-1',
  recipientDeviceId: 'child-device-1',
  senderKeyId: 'parent-key-1',
  messageType: 'POLICY_UPDATE',
  trustSetEpoch: 7,
  keyEpoch: 5,
  sequenceOrNonce: 'sequence-1',
  issuedAt: '2026-01-07T09:00:00.000Z',
  expiresAt: '2026-01-07T09:05:00.000Z',
  semanticVersion: '2.3.0',
  correlationId: null,
  payload: 'b3BhcXVlLWVuY3J5cHRlZC1wb2xpY3k=',
  signature: 'opaque-signature',
};

const TRUSTED_SNAPSHOT: TrustedBrowserSnapshot = {
  state: 'TRUSTED',
  serviceAuthenticated: true,
  browserEndpointId: 'parent-device-1',
  trustSetEpoch: 7,
  acceptedMinEpoch: 5,
  pairingRequestedAtUtc: null,
  lastFingerprint: null,
  actorDeviceSessionToken: 'device-session-token',
};

function trustedBrowser(snapshot: TrustedBrowserSnapshot = TRUSTED_SNAPSHOT): TrustedBrowserProvider {
  return {
    async getSnapshot() { return snapshot; },
    async beginServiceAuthentication() { return snapshot; },
    async requestPairing() { return snapshot; },
    async simulateParentApproval() { return snapshot; },
    async simulateEpochGoneStale() { return snapshot; },
    async simulateRevoke() { return snapshot; },
    async reset() { return snapshot; },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('RealSchedulePolicyClient canonical FamilyEnvelope transport', () => {
  it('posts the exact signed envelope and reports only its exact queued messageId', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ status: 'PENDING', messageId: ENVELOPE.messageId }),
      { status: 202, headers: { 'Content-Type': 'application/json' } },
    ));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('document', { cookie: 'pca_family_csrf=csrf-a' });

    const result = await new RealSchedulePolicyClient('https://api.example/', trustedBrowser())
      .submit('family-1', 'child-1', ENVELOPE);

    expect(result).toEqual({ status: 'PENDING', messageId: ENVELOPE.messageId });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.example/api/parent/families/family-1/children/child-1/schedule-policy');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
    expect(init.headers).toEqual({
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: 'Bearer device-session-token',
      'X-PCA-CSRF-Token': 'csrf-a',
    });
    expect(init.body).toBe(JSON.stringify(ENVELOPE));
    expect(JSON.parse(String(init.body))).toEqual(ENVELOPE);
  });

  it('rejects the obsolete partial ciphertext/nonce/keyEpoch shape before network access', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const partial = {
      recipientDeviceId: 'child-device-1',
      ciphertextB64: 'YWJjZGVmZ2g',
      nonceB64: 'MDEyMzQ1Njc4OTAxMjM0NQ',
      keyEpoch: 5,
    } as unknown as SchedulePolicyEnvelopeInput;

    await expect(new RealSchedulePolicyClient('https://api.example', trustedBrowser())
      .submit('family-1', 'child-1', partial)).rejects.toThrow('ENCRYPTION_UNAVAILABLE');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('binds the envelope sender to the trusted browser endpoint before sending', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const otherEndpoint = { ...TRUSTED_SNAPSHOT, browserEndpointId: 'other-parent-device' };

    await expect(new RealSchedulePolicyClient('https://api.example', trustedBrowser(otherEndpoint))
      .submit('family-1', 'child-1', ENVELOPE)).rejects.toThrow('ENCRYPTION_UNAVAILABLE');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a pending response that names another messageId', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ status: 'PENDING', messageId: 'different-message' }),
      { status: 202, headers: { 'Content-Type': 'application/json' } },
    ));
    vi.stubGlobal('fetch', fetchMock);

    await expect(new RealSchedulePolicyClient('https://api.example', trustedBrowser())
      .submit('family-1', 'child-1', ENVELOPE)).rejects.toThrow('SCHEDULE_POLICY_RESPONSE_INVALID');
  });

  it('fails closed when the endpoint is not trusted or lacks a device session token', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const stale = { ...TRUSTED_SNAPSHOT, state: 'EPOCH_STALE' as const };
    await expect(new RealSchedulePolicyClient('https://api.example', trustedBrowser(stale))
      .submit('family-1', 'child-1', ENVELOPE)).rejects.toThrow('TRUSTED_BROWSER_REQUIRED');

    const noToken = { ...TRUSTED_SNAPSHOT, actorDeviceSessionToken: null };
    await expect(new RealSchedulePolicyClient('https://api.example', trustedBrowser(noToken))
      .submit('family-1', 'child-1', ENVELOPE)).rejects.toThrow('ACTOR_DEVICE_SESSION_UNAVAILABLE');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
