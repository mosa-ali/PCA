import assert from 'node:assert/strict';
import test from 'node:test';
import { RuntimeSyncClient, RuntimeSyncClientError } from '../dist/runtimeSyncClient.js';

function fakeTransport(overrides = {}) {
  return {
    async issueChallenge() { return { challengeId: 'c1', nonce: 'nonce-1', expiresAt: '2026-01-02T00:00:00.000Z' }; },
    async completeChallenge() { return { sessionToken: 'tok1', expiresAt: '2026-01-02T00:00:00.000Z' }; },
    async submitOutbound() { return { results: [{ messageId: 'm1', outcome: 'QUEUED' }], droppedForBatchBound: [] }; },
    async listInbound() { return { applied: [], receipts: [], unparseableMessageIds: [], droppedForListBound: [] }; },
    async acknowledgeInbound() {},
    async getStatus() { return { connectionState: 'LIVE' }; },
    ...overrides,
  };
}

test('operations before authenticate() throw RuntimeSyncClientError, never reach the transport', async () => {
  const client = new RuntimeSyncClient(fakeTransport(), () => new Date('2026-01-01T00:00:00.000Z'));
  await assert.rejects(() => client.sendEnvelope({ messageId: 'm1', recipientDeviceId: 'r1', ciphertext: new Uint8Array(), messageType: 'STATUS_SNAPSHOT', enqueuedAtEpochMillis: 1 }), RuntimeSyncClientError);
  await assert.rejects(() => client.retrieve(), RuntimeSyncClientError);
});

test('authenticate() signs the challenge nonce and stores the resulting session', async () => {
  const client = new RuntimeSyncClient(fakeTransport(), () => new Date('2026-01-01T00:00:00.000Z'));
  let signedNonce = null;
  await client.authenticate('device-1', async (nonce) => { signedNonce = nonce; return 'sig-1'; });
  assert.equal(signedNonce, 'nonce-1');
  assert.equal(client.isAuthenticated(), true);
});

test('an expired session is no longer considered authenticated', async () => {
  const client = new RuntimeSyncClient(fakeTransport(), () => new Date('2026-01-01T00:00:00.000Z'));
  await client.authenticate('device-1', async () => 'sig-1');
  const laterClient = new RuntimeSyncClient(fakeTransport(), () => new Date('2027-01-01T00:00:00.000Z'));
  await laterClient.authenticate('device-1', async () => 'sig-1');
  assert.equal(laterClient.isAuthenticated(), false);
});

test('connection state is honestly derived: never LIVE before any successful sync', async () => {
  const client = new RuntimeSyncClient(fakeTransport(), () => new Date('2026-01-01T00:00:00.000Z'));
  await client.authenticate('device-1', async () => 'sig-1');
  assert.equal(client.getConnectionState(), 'STALE');
});

test('connection state becomes LIVE only after a successful retrieve/send, and reverts to SYNC_PENDING once pendingCount is set', async () => {
  const client = new RuntimeSyncClient(fakeTransport(), () => new Date('2026-01-01T00:00:00.000Z'));
  await client.authenticate('device-1', async () => 'sig-1');
  await client.retrieve();
  assert.equal(client.getConnectionState(), 'LIVE');

  client.setPendingCount(3);
  assert.equal(client.getConnectionState(), 'SYNC_PENDING');
  assert.equal(client.getPendingCount(), 3);
});

test('sendEnvelope forwards a single item and returns its outcome', async () => {
  const client = new RuntimeSyncClient(fakeTransport(), () => new Date('2026-01-01T00:00:00.000Z'));
  await client.authenticate('device-1', async () => 'sig-1');
  const outcome = await client.sendEnvelope({ messageId: 'm1', recipientDeviceId: 'r1', ciphertext: new Uint8Array(), messageType: 'STATUS_SNAPSHOT', enqueuedAtEpochMillis: 1 });
  assert.equal(outcome.outcome, 'QUEUED');
});

test('fetchRemoteStatus delegates to the transport using the current session token', async () => {
  let capturedToken = null;
  const client = new RuntimeSyncClient(
    fakeTransport({ async getStatus(token) { capturedToken = token; return { connectionState: 'STALE' }; } }),
    () => new Date('2026-01-01T00:00:00.000Z'),
  );
  await client.authenticate('device-1', async () => 'sig-1');
  const state = await client.fetchRemoteStatus();
  assert.equal(state, 'STALE');
  assert.equal(capturedToken, 'tok1');
});
