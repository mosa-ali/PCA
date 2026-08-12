import assert from 'node:assert/strict';
import test from 'node:test';
import { FetchRuntimeSyncTransport, RuntimeSyncTransportError } from '../dist/transport.js';

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, async json() { return body; } };
}

function buildFakeFetch(handlers) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const key = `${init?.method ?? 'GET'} ${new URL(url).pathname}`;
    const handler = handlers[key];
    if (!handler) throw new Error(`no fake handler for ${key}`);
    return handler(init);
  };
  return { fetchImpl, calls };
}

test('issueChallenge/completeChallenge hit the right routes with the right bodies', async () => {
  const { fetchImpl, calls } = buildFakeFetch({
    'POST /v1/runtime-sync/devices/device-1/challenge': () => jsonResponse(200, { challengeId: 'c1', nonce: 'n1', expiresAt: '2026-01-01T00:00:00.000Z' }),
    'POST /v1/runtime-sync/devices/device-1/session': () => jsonResponse(200, { sessionToken: 'tok1', expiresAt: '2026-01-01T01:00:00.000Z' }),
  });
  const transport = new FetchRuntimeSyncTransport({ baseUrl: 'https://relay.example', fetchImpl });

  const challenge = await transport.issueChallenge('device-1');
  assert.equal(challenge.challengeId, 'c1');
  const session = await transport.completeChallenge('device-1', 'c1', 'sig1');
  assert.equal(session.sessionToken, 'tok1');

  const sessionBody = JSON.parse(calls[1].init.body);
  assert.deepEqual(sessionBody, { challengeId: 'c1', signature: 'sig1' });
});

test('submitOutbound base64-encodes ciphertext and never sends raw bytes', async () => {
  const { fetchImpl, calls } = buildFakeFetch({
    'POST /v1/runtime-sync/outbound': () => jsonResponse(200, { results: [{ messageId: 'm1', outcome: 'QUEUED' }], droppedForBatchBound: [] }),
  });
  const transport = new FetchRuntimeSyncTransport({ baseUrl: 'https://relay.example', fetchImpl });
  const ciphertext = new Uint8Array([1, 2, 3, 255]);
  const result = await transport.submitOutbound('tok1', [
    { messageId: 'm1', recipientDeviceId: 'r1', ciphertext, messageType: 'STATUS_SNAPSHOT', enqueuedAtEpochMillis: 1 },
  ]);
  assert.equal(result.results[0].outcome, 'QUEUED');

  const sentBody = JSON.parse(calls[0].init.body);
  assert.equal(typeof sentBody.items[0].ciphertext, 'string');
  assert.equal(calls[0].init.headers.authorization, 'Bearer tok1');
});

test('listInbound decodes payload from base64 back into bytes', async () => {
  const payloadBytes = new Uint8Array([9, 8, 7]);
  const { fetchImpl } = buildFakeFetch({
    'GET /v1/runtime-sync/inbound': () =>
      jsonResponse(200, {
        applied: [{ messageId: 'm1', senderDeviceId: 's1', messageType: 'STATUS_SNAPSHOT', payload: Buffer.from(payloadBytes).toString('base64') }],
        receipts: [],
        unparseableMessageIds: [],
        droppedForListBound: [],
      }),
  });
  const transport = new FetchRuntimeSyncTransport({ baseUrl: 'https://relay.example', fetchImpl });
  const result = await transport.listInbound('tok1');
  assert.deepEqual([...result.applied[0].payload], [...payloadBytes]);
});

test('a 401 response is surfaced as RuntimeSyncTransportError with code UNAUTHORIZED', async () => {
  const { fetchImpl } = buildFakeFetch({
    'GET /v1/runtime-sync/status': () => jsonResponse(401, { error: 'unauthorized' }),
  });
  const transport = new FetchRuntimeSyncTransport({ baseUrl: 'https://relay.example', fetchImpl });
  await assert.rejects(
    () => transport.getStatus('bad-token'),
    (error) => error instanceof RuntimeSyncTransportError && error.code === 'UNAUTHORIZED',
  );
});

test('a network failure is surfaced as RuntimeSyncTransportError with code NETWORK', async () => {
  const fetchImpl = async () => {
    throw new Error('ECONNREFUSED');
  };
  const transport = new FetchRuntimeSyncTransport({ baseUrl: 'https://relay.example', fetchImpl });
  await assert.rejects(
    () => transport.getStatus('tok1'),
    (error) => error instanceof RuntimeSyncTransportError && error.code === 'NETWORK',
  );
});
