// PCA product-completion programme, Writer P0-D: proves RealFamilyAuditDeliveryClient
// genuinely fetches opaque envelopes and hands them to the injected
// decryption boundary -- honestly reporting PENDING_TRUSTED_DECRYPTION
// whenever ANY link in the chain (no trusted browser, no actor-device
// session, network failure, decryption boundary rejection) is unavailable,
// and READY with real entries only once every link succeeds. A genuinely
// empty envelope list is reported as READY/empty, never conflated with a
// pending-decryption state.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RealFamilyAuditDeliveryClient } from '../../src/api/real/realFamilyAuditDeliveryClient';
import type { TrustedBrowserProvider, TrustedBrowserSnapshot } from '../../src/domain/trustedBrowser';
import type { FamilyAuditEnvelopeDecryptionBoundary, OpaqueFamilyAuditEnvelope } from '../../src/api/familyAuditDecryption';
import type { AuditEntrySummary } from '../../src/domain/types';

const TRUSTED_SNAPSHOT: TrustedBrowserSnapshot = {
  state: 'TRUSTED',
  serviceAuthenticated: true,
  browserEndpointId: 'endpoint-a',
  trustSetEpoch: 5,
  acceptedMinEpoch: 5,
  pairingRequestedAtUtc: null,
  lastFingerprint: null,
  actorDeviceSessionToken: 'actor-device-session-token',
};

const NOT_TRUSTED_SNAPSHOT: TrustedBrowserSnapshot = {
  ...TRUSTED_SNAPSHOT,
  state: 'BROWSER_NOT_TRUSTED',
  actorDeviceSessionToken: null,
};

class StubTrustedBrowserProvider implements TrustedBrowserProvider {
  constructor(private readonly snapshot: TrustedBrowserSnapshot) {}
  async getSnapshot() {
    return this.snapshot;
  }
  async beginServiceAuthentication() { return this.snapshot; }
  async requestPairing() { return this.snapshot; }
  async simulateParentApproval() { return this.snapshot; }
  async simulateEpochGoneStale() { return this.snapshot; }
  async simulateRevoke() { return this.snapshot; }
  async reset() { return this.snapshot; }
}

class StubDecryptionBoundary implements FamilyAuditEnvelopeDecryptionBoundary {
  constructor(private readonly impl: (envelope: OpaqueFamilyAuditEnvelope) => Promise<AuditEntrySummary>) {}
  decrypt(envelope: OpaqueFamilyAuditEnvelope) {
    return this.impl(envelope);
  }
}

function fakeEntry(eventId: string): AuditEntrySummary {
  return {
    eventId,
    actionType: 'ADD_VIEWER',
    actorMemberId: 'member-owner',
    targetScope: 'FAMILY',
    trustSetEpoch: 4,
    policyRevision: 1,
    timestampUtc: '2026-01-01T00:00:00.000Z',
    resultStatus: 'SUCCESS',
    reasonCategory: null,
    correlationId: 'corr-1',
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('RealFamilyAuditDeliveryClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports PENDING_TRUSTED_DECRYPTION without ever calling fetch when the browser is not trusted', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const client = new RealFamilyAuditDeliveryClient(
      'https://api.example.test',
      new StubTrustedBrowserProvider(NOT_TRUSTED_SNAPSHOT),
      new StubDecryptionBoundary(async () => fakeEntry('e1')),
    );
    const result = await client.list();
    expect(result).toEqual({ status: 'PENDING_TRUSTED_DECRYPTION' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fetches real opaque envelopes and decrypts each one when trusted, resolving READY with real entries', async () => {
    const envelope = { envelopeId: 'env-1', encryptedPayloadB64: 'ZW5jcnlwdGVk', nonceB64: 'bm9uY2U', keyEpoch: 5, generatedAtUtc: '2026-01-01T00:00:00.000Z' };
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/parent/session')) return Promise.resolve(jsonResponse(200, { familyId: 'fam-1' }));
      if (url.includes('/audit-events')) return Promise.resolve(jsonResponse(200, { envelopes: [envelope] }));
      return Promise.resolve(jsonResponse(404, {}));
    });
    vi.stubGlobal('fetch', fetchMock);

    const decryptCalls: OpaqueFamilyAuditEnvelope[] = [];
    const client = new RealFamilyAuditDeliveryClient(
      'https://api.example.test',
      new StubTrustedBrowserProvider(TRUSTED_SNAPSHOT),
      new StubDecryptionBoundary(async (e) => {
        decryptCalls.push(e);
        return fakeEntry(e.envelopeId);
      }),
    );

    const result = await client.list();
    expect(result.status).toBe('READY');
    if (result.status === 'READY') {
      expect(result.entries).toEqual([fakeEntry('env-1')]);
    }
    expect(decryptCalls).toEqual([envelope]);

    const auditCall = fetchMock.mock.calls.find(([input]) => (typeof input === 'string' ? input : input.toString()).includes('/audit-events'));
    expect(auditCall).toBeTruthy();
    const [, init] = auditCall as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer actor-device-session-token');
  });

  it('reports READY with an empty list when the family genuinely has zero envelopes -- never conflated with pending', async () => {
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/parent/session')) return Promise.resolve(jsonResponse(200, { familyId: 'fam-1' }));
      if (url.includes('/audit-events')) return Promise.resolve(jsonResponse(200, { envelopes: [] }));
      return Promise.resolve(jsonResponse(404, {}));
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = new RealFamilyAuditDeliveryClient(
      'https://api.example.test',
      new StubTrustedBrowserProvider(TRUSTED_SNAPSHOT),
      new StubDecryptionBoundary(async () => {
        throw new Error('must not be called for an empty envelope list');
      }),
    );
    const result = await client.list();
    expect(result).toEqual({ status: 'READY', entries: [] });
  });

  it('reports PENDING_TRUSTED_DECRYPTION (never a partial/crashed result) when the decryption boundary itself rejects', async () => {
    const envelope = { envelopeId: 'env-1', encryptedPayloadB64: 'x', nonceB64: 'y', keyEpoch: 1, generatedAtUtc: '2026-01-01T00:00:00.000Z' };
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/parent/session')) return Promise.resolve(jsonResponse(200, { familyId: 'fam-1' }));
      if (url.includes('/audit-events')) return Promise.resolve(jsonResponse(200, { envelopes: [envelope] }));
      return Promise.resolve(jsonResponse(404, {}));
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = new RealFamilyAuditDeliveryClient(
      'https://api.example.test',
      new StubTrustedBrowserProvider(TRUSTED_SNAPSHOT),
      new StubDecryptionBoundary(async () => {
        throw new Error('CRYPTO_REVIEW_REQUIRED');
      }),
    );
    const result = await client.list();
    expect(result).toEqual({ status: 'PENDING_TRUSTED_DECRYPTION' });
  });

  it('reports PENDING_TRUSTED_DECRYPTION on a non-ok HTTP response, never throwing', async () => {
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/parent/session')) return Promise.resolve(jsonResponse(200, { familyId: 'fam-1' }));
      return Promise.resolve(new Response(null, { status: 500 }));
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = new RealFamilyAuditDeliveryClient(
      'https://api.example.test',
      new StubTrustedBrowserProvider(TRUSTED_SNAPSHOT),
      new StubDecryptionBoundary(async () => fakeEntry('e1')),
    );
    await expect(client.list()).resolves.toEqual({ status: 'PENDING_TRUSTED_DECRYPTION' });
  });
});
