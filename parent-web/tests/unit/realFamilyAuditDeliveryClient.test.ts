// PCA product-completion programme, Writer P0-D: proves RealFamilyAuditDeliveryClient
// genuinely fetches opaque envelopes and hands them to the injected
// decryption boundary -- honestly reporting PENDING_TRUSTED_DECRYPTION
// whenever the Parent session, network, decryption boundary, or feed completeness
// is unavailable, and READY with real entries only once every link succeeds.
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

function auditPage(envelopes: OpaqueFamilyAuditEnvelope[], complete = true, nextCursor: string | null = null) {
  return { envelopes, complete, nextCursor };
}

function envelopeBatch(prefix: string, count: number, startAt = 0): OpaqueFamilyAuditEnvelope[] {
  return Array.from({ length: count }, (_, index) => ({
    envelopeId: `${prefix}-${String(startAt + index).padStart(4, '0')}`,
    encryptedPayloadB64: 'YQ',
    nonceB64: 'bg',
    keyEpoch: 1,
    generatedAtUtc: '2026-01-01T00:00:00.000Z',
  }));
}

describe('RealFamilyAuditDeliveryClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports pending when the Parent session cannot be resolved, without requiring browser trust', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const client = new RealFamilyAuditDeliveryClient(
      'https://api.example.test',
      new StubTrustedBrowserProvider(NOT_TRUSTED_SNAPSHOT),
      new StubDecryptionBoundary(async () => fakeEntry('e1')),
    );
    const result = await client.list();
    expect(result).toEqual({ status: 'PENDING_TRUSTED_DECRYPTION' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('fetches real opaque envelopes and decrypts each one when trusted, resolving READY with real entries', async () => {
    const envelope = { envelopeId: 'env-1', encryptedPayloadB64: 'ZW5jcnlwdGVk', nonceB64: 'bm9uY2U', keyEpoch: 5, generatedAtUtc: '2026-01-01T00:00:00.000Z' };
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/parent/session')) return Promise.resolve(jsonResponse(200, { familyId: 'fam-1' }));
      if (url.includes('/audit-events')) return Promise.resolve(jsonResponse(200, auditPage([envelope])));
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
    expect(init.credentials).toBe('include');
  });

  it('accepts persisted envelope boundaries and rejects malformed or oversized fields before decryption', async () => {
    const validAtLimit = {
      envelopeId: 'e'.repeat(200),
      encryptedPayloadB64: 'x'.repeat(4_194_304),
      nonceB64: 'n'.repeat(64),
      keyEpoch: 2_147_483_647,
      generatedAtUtc: '2026-01-01T00:00:00.000Z',
    };
    const fetchFor = (envelope: unknown) => vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/parent/session')) return Promise.resolve(jsonResponse(200, { familyId: 'fam-1' }));
      if (url.includes('/audit-events')) return Promise.resolve(jsonResponse(200, auditPage([envelope as OpaqueFamilyAuditEnvelope])));
      return Promise.resolve(jsonResponse(404, {}));
    });
    const decryptAtLimit = vi.fn(async () => fakeEntry(validAtLimit.envelopeId));
    vi.stubGlobal('fetch', fetchFor(validAtLimit));
    const validClient = new RealFamilyAuditDeliveryClient(
      'https://api.example.test',
      new StubTrustedBrowserProvider(TRUSTED_SNAPSHOT),
      new StubDecryptionBoundary(decryptAtLimit),
    );
    await expect(validClient.list()).resolves.toEqual({ status: 'READY', entries: [fakeEntry(validAtLimit.envelopeId)] });
    expect(decryptAtLimit).toHaveBeenCalledTimes(1);

    const invalidEnvelopes = [
      { ...validAtLimit, encryptedPayloadB64: 'x'.repeat(4_194_305) },
      { ...validAtLimit, encryptedPayloadB64: 'opaque-é' },
      { ...validAtLimit, nonceB64: 'n'.repeat(65) },
      { ...validAtLimit, nonceB64: 'nonce-é' },
      { ...validAtLimit, envelopeId: 'e'.repeat(201) },
      { ...validAtLimit, keyEpoch: 2_147_483_648 },
    ];
    for (const invalid of invalidEnvelopes) {
      const decrypt = vi.fn(async () => fakeEntry('invalid'));
      vi.stubGlobal('fetch', fetchFor(invalid));
      const invalidClient = new RealFamilyAuditDeliveryClient(
        'https://api.example.test',
        new StubTrustedBrowserProvider(TRUSTED_SNAPSHOT),
        new StubDecryptionBoundary(decrypt),
      );
      await expect(invalidClient.list()).resolves.toEqual({ status: 'PENDING_TRUSTED_DECRYPTION' });
      expect(decrypt).not.toHaveBeenCalled();
    }
  });

  it('reports pending for an empty envelope list until feed completeness is established', async () => {
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/parent/session')) return Promise.resolve(jsonResponse(200, { familyId: 'fam-1' }));
      if (url.includes('/audit-events')) return Promise.resolve(jsonResponse(200, auditPage([])));
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
    expect(result).toEqual({ status: 'PENDING_TRUSTED_DECRYPTION' });
  });

  it('reports PENDING_TRUSTED_DECRYPTION (never a partial/crashed result) when the decryption boundary itself rejects', async () => {
    const envelope = { envelopeId: 'env-1', encryptedPayloadB64: 'x', nonceB64: 'y', keyEpoch: 1, generatedAtUtc: '2026-01-01T00:00:00.000Z' };
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/parent/session')) return Promise.resolve(jsonResponse(200, { familyId: 'fam-1' }));
      if (url.includes('/audit-events')) return Promise.resolve(jsonResponse(200, auditPage([envelope])));
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

  it('follows opaque cursors oldest-first and returns READY only after the terminal complete page', async () => {
    const firstPage = envelopeBatch('env-a', 500);
    const finalEnvelope = { envelopeId: 'env-z-0000', encryptedPayloadB64: 'b', nonceB64: 'n', keyEpoch: 1, generatedAtUtc: '2026-01-02T00:00:00.000Z' };
    const auditUrls: string[] = [];
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/parent/session')) return Promise.resolve(jsonResponse(200, { familyId: 'fam-1' }));
      if (url.includes('/audit-events')) {
        auditUrls.push(url);
        return Promise.resolve(jsonResponse(200, auditUrls.length === 1
          ? auditPage(firstPage, false, 'v1:cursor/a')
          : auditPage([finalEnvelope], true, null)));
      }
      return Promise.resolve(jsonResponse(404, {}));
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = new RealFamilyAuditDeliveryClient(
      'https://api.example.test',
      new StubTrustedBrowserProvider(TRUSTED_SNAPSHOT),
      new StubDecryptionBoundary(async (envelope) => fakeEntry(envelope.envelopeId)),
    );
    const result = await client.list();
    expect(result.status).toBe('READY');
    if (result.status === 'READY') {
      expect(result.entries).toHaveLength(501);
      expect(result.entries[0]).toEqual(fakeEntry(firstPage[0]!.envelopeId));
      expect(result.entries[500]).toEqual(fakeEntry(finalEnvelope.envelopeId));
    }
    expect(auditUrls).toHaveLength(2);
    expect(new URL(auditUrls[1]!).searchParams.get('cursor')).toBe('v1:cursor/a');
  });

  it('accepts equal-time envelopes in binary UTF-8 ID order across pages', async () => {
    // UTF-8 byte order places U+E000 before U+10000; JavaScript UTF-16 string
    // order does the opposite, so this also proves the server comparator is used.
    const ordered = [
      { envelopeId: '\uE000', encryptedPayloadB64: 'YQ', nonceB64: 'bg', keyEpoch: 1, generatedAtUtc: '2026-01-01T00:00:00.000Z' },
      { envelopeId: '\u{10000}', encryptedPayloadB64: 'Yg', nonceB64: 'bg', keyEpoch: 1, generatedAtUtc: '2026-01-01T00:00:00.000Z' },
    ];
    const firstPage = [...envelopeBatch('env-a', 499), ordered[0]!];
    let auditCalls = 0;
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/parent/session')) return Promise.resolve(jsonResponse(200, { familyId: 'fam-1' }));
      if (url.includes('/audit-events')) {
        auditCalls += 1;
        return Promise.resolve(jsonResponse(200, auditCalls === 1
          ? auditPage(firstPage, false, 'v1:equal-time')
          : auditPage([ordered[1]!], true, null)));
      }
      return Promise.resolve(jsonResponse(404, {}));
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = new RealFamilyAuditDeliveryClient(
      'https://api.example.test',
      new StubTrustedBrowserProvider(TRUSTED_SNAPSHOT),
      new StubDecryptionBoundary(async (envelope) => fakeEntry(envelope.envelopeId)),
    );
    const result = await client.list();
    expect(result.status).toBe('READY');
    if (result.status === 'READY') {
      expect(result.entries).toEqual([...firstPage, ordered[1]!].map((item) => fakeEntry(item.envelopeId)));
    }
    expect(auditCalls).toBe(2);
  });

  it('fails closed when an equal-time page reverses binary UTF-8 ID order', async () => {
    const reversed = [
      { envelopeId: '\u{10000}', encryptedPayloadB64: 'Yg', nonceB64: 'bg', keyEpoch: 1, generatedAtUtc: '2026-01-01T00:00:00.000Z' },
      { envelopeId: '\uE000', encryptedPayloadB64: 'YQ', nonceB64: 'bg', keyEpoch: 1, generatedAtUtc: '2026-01-01T00:00:00.000Z' },
    ];
    const firstPage = [...envelopeBatch('env-a', 499), reversed[0]!];
    let auditCalls = 0;
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/parent/session')) return Promise.resolve(jsonResponse(200, { familyId: 'fam-1' }));
      if (url.includes('/audit-events')) {
        auditCalls += 1;
        return Promise.resolve(jsonResponse(200, auditCalls === 1
          ? auditPage(firstPage, false, 'v1:reversed-time')
          : auditPage([reversed[1]!], true, null)));
      }
      return Promise.resolve(jsonResponse(404, {}));
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = new RealFamilyAuditDeliveryClient(
      'https://api.example.test',
      new StubTrustedBrowserProvider(TRUSTED_SNAPSHOT),
      new StubDecryptionBoundary(async (envelope) => fakeEntry(envelope.envelopeId)),
    );
    await expect(client.list()).resolves.toEqual({ status: 'PENDING_TRUSTED_DECRYPTION' });
    expect(auditCalls).toBe(2);
  });

  it('keeps incomplete or failed later pages pending without exposing earlier decrypted entries', async () => {
    const envelopes = envelopeBatch('env-first', 500);
    for (const laterPage of [
      jsonResponse(200, auditPage([], false, null)),
      new Response(null, { status: 503 }),
    ]) {
      let auditCalls = 0;
      const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('/api/parent/session')) return Promise.resolve(jsonResponse(200, { familyId: 'fam-1' }));
        if (url.includes('/audit-events')) {
          auditCalls += 1;
          return Promise.resolve(auditCalls === 1 ? jsonResponse(200, auditPage(envelopes, false, 'v1:next')) : laterPage);
        }
        return Promise.resolve(jsonResponse(404, {}));
      });
      vi.stubGlobal('fetch', fetchMock);
      const client = new RealFamilyAuditDeliveryClient(
        'https://api.example.test',
        new StubTrustedBrowserProvider(TRUSTED_SNAPSHOT),
        new StubDecryptionBoundary(async () => fakeEntry('e1')),
      );
      await expect(client.list()).resolves.toEqual({ status: 'PENDING_TRUSTED_DECRYPTION' });
    }
  });

  it('rejects repeated cursors and malformed terminal cursor metadata', async () => {
    const firstBatch = envelopeBatch('env-first', 500);
    const secondBatch = envelopeBatch('env-second', 500);
    for (const replies of [
      [auditPage(firstBatch, false, 'v1:repeat'), auditPage(secondBatch, false, 'v1:repeat')],
      [auditPage(firstBatch, true, 'v1:unexpected')],
    ]) {
      let auditCalls = 0;
      const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('/api/parent/session')) return Promise.resolve(jsonResponse(200, { familyId: 'fam-1' }));
        if (url.includes('/audit-events')) return Promise.resolve(jsonResponse(200, replies[auditCalls++] ?? auditPage([], true, null)));
        return Promise.resolve(jsonResponse(404, {}));
      });
      vi.stubGlobal('fetch', fetchMock);
      const client = new RealFamilyAuditDeliveryClient(
        'https://api.example.test',
        new StubTrustedBrowserProvider(TRUSTED_SNAPSHOT),
        new StubDecryptionBoundary(async (item) => fakeEntry(item.envelopeId)),
      );
      await expect(client.list()).resolves.toEqual({ status: 'PENDING_TRUSTED_DECRYPTION' });
    }
  });

  it('fails closed above 500 envelopes per page, while allowing a terminal confirmation at the 10,000-envelope cap', async () => {
    const envelope = { envelopeId: 'env-1', encryptedPayloadB64: 'a', nonceB64: 'n', keyEpoch: 1, generatedAtUtc: '2026-01-01T00:00:00.000Z' };
    const oversizedFetch = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/parent/session')) return Promise.resolve(jsonResponse(200, { familyId: 'fam-1' }));
      const oversizedPage = auditPage(Array.from({ length: 501 }, (_, index) => ({ ...envelope, envelopeId: `env-${index}` })));
      return Promise.resolve(jsonResponse(200, oversizedPage));
    });
    vi.stubGlobal('fetch', oversizedFetch);
    const client = new RealFamilyAuditDeliveryClient(
      'https://api.example.test',
      new StubTrustedBrowserProvider(TRUSTED_SNAPSHOT),
      new StubDecryptionBoundary(async (item) => fakeEntry(item.envelopeId)),
    );
    await expect(client.list()).resolves.toEqual({ status: 'PENDING_TRUSTED_DECRYPTION' });

    let auditCalls = 0;
    const cappedFeedFetch = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/parent/session')) return Promise.resolve(jsonResponse(200, { familyId: 'fam-1' }));
      auditCalls += 1;
      if (auditCalls === 21) return Promise.resolve(jsonResponse(200, auditPage([], true, null)));
      const items = envelopeBatch(`env-${auditCalls}`, 500, 0)
        .map((item) => ({ ...item, generatedAtUtc: `2026-01-${String(auditCalls).padStart(2, '0')}T00:00:00.000Z` }));
      return Promise.resolve(jsonResponse(200, auditPage(items, false, `v1:${auditCalls}`)));
    });
    vi.stubGlobal('fetch', cappedFeedFetch);
    const cappedResult = await client.list();
    expect(cappedResult.status).toBe('READY');
    if (cappedResult.status === 'READY') expect(cappedResult.entries).toHaveLength(10_000);
    expect(auditCalls).toBe(21);

    auditCalls = 0;
    const overCapFetch = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/parent/session')) return Promise.resolve(jsonResponse(200, { familyId: 'fam-1' }));
      auditCalls += 1;
      if (auditCalls === 21) {
        const extra = { envelopeId: 'env-extra', encryptedPayloadB64: 'YQ', nonceB64: 'bg', keyEpoch: 1, generatedAtUtc: '2026-02-01T00:00:00.000Z' };
        return Promise.resolve(jsonResponse(200, auditPage([extra], true, null)));
      }
      const items = envelopeBatch(`over-${auditCalls}`, 500, 0)
        .map((item) => ({ ...item, generatedAtUtc: `2026-01-${String(auditCalls).padStart(2, '0')}T00:00:00.000Z` }));
      return Promise.resolve(jsonResponse(200, auditPage(items, false, `v1:over:${auditCalls}`)));
    });
    vi.stubGlobal('fetch', overCapFetch);
    await expect(client.list()).resolves.toEqual({ status: 'PENDING_TRUSTED_DECRYPTION' });
    expect(auditCalls).toBe(21);
  });
});
