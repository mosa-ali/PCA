import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import test from 'node:test';
import { RelayService } from '../../dist/relay/RelayService.js';
import { MySqlRelayRepository } from '../../dist/relay/MySqlRelayRepository.js';
import { RelayAuthorityChangedError } from '../../dist/relay/RelayRepository.js';
import { MySqlDeviceRepository } from '../../dist/device/MySqlDeviceRepository.js';
import { OutboundRelayService } from '../../dist/runtime-sync/OutboundRelayService.js';
import { closePool, getPool } from '../../dist/db/pool.js';
import { relayQueuePosition, compareRelayQueuePositions } from '../../dist/relay/queuePage.js';
import { encodeRelayContinuation, decodeRelayContinuation } from '../../dist/runtime-sync/relayContinuation.js';

if (!process.env.PCA_DATABASE_URL) throw new Error('PCA_DATABASE_URL is required for backend/test/db tests.');

// Storage-focused DB cases intentionally omit Trust Set fixtures. Production
// uses the default strict repository configuration.
const repository = new MySqlRelayRepository({ allowMissingAuthorityForTests: true });

function buildService(now = () => new Date()) {
  return new RelayService(repository, now);
}

function envelope(overrides = {}) {
  return {
    messageId: randomUUID(),
    familyId: `family-${randomUUID()}`,
    senderDeviceId: `sender-${randomUUID()}`,
    recipientDeviceId: `recipient-${randomUUID()}`,
    ciphertext: Buffer.from('opaque-bytes-' + randomUUID()),
    ...overrides,
  };
}

async function seedOutboundAuthorityFixture() {
  const familyId = randomUUID();
  const senderDeviceId = randomUUID();
  const senderDskKeyId = randomUUID();
  const recipientDeviceId = randomUUID();
  const recipientDskKeyId = randomUUID();
  const createdAt = new Date();
  await getPool().query(
    `INSERT INTO families (family_id, family_reference_hash, created_at) VALUES (?, ?, NOW(3))`,
    [familyId, randomBytes(32)],
  );
  for (const [deviceId, dskKeyId] of [[senderDeviceId, senderDskKeyId], [recipientDeviceId, recipientDskKeyId]]) {
    await getPool().query(
      `INSERT INTO devices (device_id, family_id, platform, status, created_at, revoked_at)
       VALUES (?, ?, 'ANDROID', 'ACTIVE', ?, NULL)`,
      [deviceId, familyId, createdAt],
    );
    await getPool().query(
      `INSERT INTO device_public_keys (device_id, key_id, key_purpose, public_key, status, created_at, revoked_at)
       VALUES (?, ?, 'DSK', ?, 'ACTIVE', ?, NULL)`,
      [deviceId, dskKeyId, `test-key-${randomUUID()}`, createdAt],
    );
  }
  await getPool().query(
    `INSERT INTO family_epoch_floors
       (family_id, minimum_accepted_trust_set_epoch, minimum_accepted_key_epoch, updated_at)
     VALUES (?, 1, 1, NOW(3))`,
    [familyId],
  );
  return {
    familyId,
    senderDeviceId,
    senderDskKeyId,
    recipientDeviceId,
    recipientDskKeyId,
    snapshot: {
      familyId,
      trustSetEpoch: 1,
      keyEpoch: 1,
      sender: { deviceId: senderDeviceId, dskKeyId: senderDskKeyId },
      recipient: { deviceId: recipientDeviceId, dskKeyId: recipientDskKeyId },
    },
  };
}

function outboundItem(fixture, messageId = randomUUID()) {
  return {
    messageId,
    recipientDeviceId: fixture.recipientDeviceId,
    ciphertext: Buffer.from('outbound-authority-' + messageId),
    messageType: 'STATUS_SNAPSHOT',
    enqueuedAtEpochMillis: Date.now(),
  };
}

function buildAuthorizedOutboundService() {
  return new OutboundRelayService(buildService(), new MySqlDeviceRepository());
}

test('MySQL: queue + retrieve by correct recipient, ciphertext stored as opaque blob', async () => {
  const service = buildService();
  const input = envelope();
  await service.queueEnvelope(input);
  const fetched = await service.fetchEnvelope(input.recipientDeviceId, input.messageId);
  assert.equal(fetched.ciphertext.equals(input.ciphertext), true);
});

test('MySQL: messageId uniqueness -- duplicate identical submission is idempotent', async () => {
  const service = buildService();
  const input = envelope();
  const first = await service.queueEnvelope(input);
  const second = await service.queueEnvelope({ ...input });
  assert.equal(first.messageId, second.messageId);
});

test('MySQL: conflicting reuse of messageId with different ciphertext is rejected', async () => {
  const service = buildService();
  const input = envelope();
  await service.queueEnvelope(input);
  await assert.rejects(
    () => service.queueEnvelope({ ...input, ciphertext: Buffer.from('different') }),
    { code: 'CONFLICT' },
  );
});

test('MySQL: identical messageId with changed family, sender, or recipient is a conflict', async () => {
  const service = buildService();
  for (const [field, changedValue] of [
    ['familyId', `other-family-${randomUUID()}`],
    ['senderDeviceId', `other-sender-${randomUUID()}`],
    ['recipientDeviceId', `other-recipient-${randomUUID()}`],
  ]) {
    const input = envelope();
    await service.queueEnvelope(input);
    await assert.rejects(
      () => service.queueEnvelope({ ...input, [field]: changedValue }),
      { code: 'CONFLICT' },
      `${field} changes must not be treated as an exact retry`,
    );
    const fetched = await service.fetchEnvelope(input.recipientDeviceId, input.messageId);
    assert.equal(fetched.familyId, input.familyId);
    assert.equal(fetched.senderDeviceId, input.senderDeviceId);
    assert.equal(fetched.recipientDeviceId, input.recipientDeviceId);
    assert.equal(fetched.ciphertext.equals(input.ciphertext), true);
  }
});

test('MySQL: recipient-scoped retrieval -- wrong recipient cannot read the envelope', async () => {
  const service = buildService();
  const input = envelope();
  await service.queueEnvelope(input);
  await assert.rejects(() => service.fetchEnvelope('someone-else', input.messageId), { code: 'NOT_FOUND' });
});

test('MySQL: trailing-space aliases cannot fetch, acknowledge, list, or idempotently reuse an exact relay identity', async () => {
  const now = new Date();
  const service = buildService(() => now);
  const input = envelope({ messageId: `message-${randomUUID()}`, recipientDeviceId: `recipient-${randomUUID()}` });
  await service.queueEnvelope(input);
  const aliasedMessageId = `${input.messageId} `;
  const aliasedRecipient = `${input.recipientDeviceId} `;
  const aliasedFamily = `${input.familyId} `;

  // The deployed utf8mb4_bin collation is PAD SPACE. A primary-key collision
  // on an alias is a conflict, never proof of an exact idempotent retry.
  await assert.rejects(() => service.queueEnvelope({ ...input, messageId: aliasedMessageId }), { code: 'CONFLICT' });
  await assert.rejects(() => service.fetchEnvelope(input.recipientDeviceId, aliasedMessageId), { code: 'NOT_FOUND' });
  await assert.rejects(() => service.acknowledgeEnvelope(input.recipientDeviceId, aliasedMessageId), { code: 'NOT_FOUND' });

  assert.deepEqual(await service.listQueuedForRecipient(aliasedRecipient), []);
  assert.deepEqual(await repository.listQueuedPageForRecipient(aliasedRecipient, input.familyId, now,
    { after: null, highWater: null, limit: 10 }), { records: [], highWater: null, hasMore: false });
  assert.deepEqual(await repository.listQueuedPageForRecipient(input.recipientDeviceId, aliasedFamily, now,
    { after: null, highWater: null, limit: 10 }), { records: [], highWater: null, hasMore: false });
  assert.deepEqual(await repository.findQueuedForRecipient(input.recipientDeviceId, aliasedFamily,
    [input.messageId], now), []);

  const original = await service.fetchEnvelope(input.recipientDeviceId, input.messageId);
  assert.equal(original.state, 'QUEUED', 'an alias ACK must leave the exact original message queued');
  assert.equal(original.ciphertext.equals(input.ciphertext), true);
});

test('MySQL: TTL expiry makes an envelope unavailable', async () => {
  let now = new Date('2026-01-01T00:00:00.000Z');
  const service = buildService(() => now);
  const input = envelope({ ttlMs: 60_000 });
  await service.queueEnvelope(input);
  now = new Date(now.getTime() + 60_001);
  await assert.rejects(() => service.fetchEnvelope(input.recipientDeviceId, input.messageId), { code: 'EXPIRED' });
});

test('MySQL: acknowledgement is idempotent', async () => {
  const service = buildService();
  const input = envelope();
  await service.queueEnvelope(input);
  const first = await service.acknowledgeEnvelope(input.recipientDeviceId, input.messageId);
  const second = await service.acknowledgeEnvelope(input.recipientDeviceId, input.messageId);
  assert.equal(first.acknowledgedAt.getTime(), second.acknowledgedAt.getTime());
});

test('MySQL AUTHORITY RACE: ACK refuses a stale accepted-head snapshot after Trust Set rotation commits', async () => {
  const service = buildService();
  const familyId = randomUUID();
  const deviceId = randomUUID();
  const keyId = randomUUID();
  const createdAt = new Date();
  await getPool().query(
    `INSERT INTO families (family_id, family_reference_hash, created_at) VALUES (?, ?, NOW(3))`,
    [familyId, randomBytes(32)],
  );
  await getPool().query(
    `INSERT INTO devices (device_id, family_id, platform, status, created_at, revoked_at)
     VALUES (?, ?, 'ANDROID', 'ACTIVE', ?, NULL)`,
    [deviceId, familyId, createdAt],
  );
  await getPool().query(
    `INSERT INTO device_public_keys (device_id, key_id, key_purpose, public_key, status, created_at, revoked_at)
     VALUES (?, ?, 'DSK', ?, 'ACTIVE', ?, NULL)`,
    [deviceId, keyId, `test-key-${randomUUID()}`, createdAt],
  );
  await getPool().query(
    `INSERT INTO family_epoch_floors
       (family_id, minimum_accepted_trust_set_epoch, minimum_accepted_key_epoch, updated_at)
     VALUES (?, 1, 1, NOW(3))`,
    [familyId],
  );
  const input = envelope({ familyId, recipientDeviceId: deviceId });
  await service.queueEnvelope(input);

  // Represents the accepted-head result captured by the route resolver;
  // the epoch append commits before the ACK transaction obtains the floor lock.
  await getPool().query(
    `UPDATE family_epoch_floors
        SET minimum_accepted_trust_set_epoch = 2, updated_at = NOW(3)
      WHERE family_id = ?`,
    [familyId],
  );

  await assert.rejects(
    () => service.acknowledgeEnvelope(deviceId, input.messageId, {
      familyId, dskKeyId: keyId, trustSetEpoch: 1, keyEpoch: 1,
    }),
    RelayAuthorityChangedError,
  );
  assert.equal((await service.fetchEnvelope(deviceId, input.messageId)).state, 'QUEUED');
});

test('MySQL AUTHORITY RACE: ACK refuses a revoked exact DSK without changing relay custody', async () => {
  const service = buildService();
  const familyId = randomUUID();
  const deviceId = randomUUID();
  const keyId = randomUUID();
  const createdAt = new Date();
  await getPool().query(
    `INSERT INTO families (family_id, family_reference_hash, created_at) VALUES (?, ?, NOW(3))`,
    [familyId, randomBytes(32)],
  );
  await getPool().query(
    `INSERT INTO devices (device_id, family_id, platform, status, created_at, revoked_at)
     VALUES (?, ?, 'ANDROID', 'ACTIVE', ?, NULL)`,
    [deviceId, familyId, createdAt],
  );
  await getPool().query(
    `INSERT INTO device_public_keys (device_id, key_id, key_purpose, public_key, status, created_at, revoked_at)
     VALUES (?, ?, 'DSK', ?, 'ACTIVE', ?, NULL)`,
    [deviceId, keyId, `test-key-${randomUUID()}`, createdAt],
  );
  await getPool().query(
    `INSERT INTO family_epoch_floors
       (family_id, minimum_accepted_trust_set_epoch, minimum_accepted_key_epoch, updated_at)
     VALUES (?, 1, 1, NOW(3))`,
    [familyId],
  );
  const input = envelope({ familyId, recipientDeviceId: deviceId });
  await service.queueEnvelope(input);
  await getPool().query(
    `UPDATE device_public_keys SET status = 'REVOKED', revoked_at = NOW(3)
      WHERE device_id = ? AND key_id = ? AND key_purpose = 'DSK'`,
    [deviceId, keyId],
  );

  await assert.rejects(
    () => service.acknowledgeEnvelope(deviceId, input.messageId, {
      familyId, dskKeyId: keyId, trustSetEpoch: 1, keyEpoch: 1,
    }),
    RelayAuthorityChangedError,
  );
  assert.equal((await service.fetchEnvelope(deviceId, input.messageId)).state, 'QUEUED');
});

test('MySQL ACK snapshots the exact recipient authority before waiting for database access', async () => {
  const fixture = await seedOutboundAuthorityFixture();
  const message = outboundItem(fixture);
  const service = buildAuthorizedOutboundService();
  const queued = await service.submitBatch(fixture.senderDeviceId, fixture.familyId, [message], async () => fixture.snapshot);
  assert.deepEqual(queued.results, [{ messageId: message.messageId, outcome: 'QUEUED' }]);

  const authority = {
    familyId: fixture.familyId,
    dskKeyId: fixture.recipientDskKeyId,
    trustSetEpoch: 1,
    keyEpoch: 1,
  };
  const acknowledgement = buildService().acknowledgeEnvelope(fixture.recipientDeviceId, message.messageId, authority);
  // The repository call must capture the route's accepted-session tuple
  // synchronously, before asynchronous pool connection acquisition yields.
  authority.familyId = randomUUID();
  authority.dskKeyId = randomUUID();
  authority.trustSetEpoch = 2;
  authority.keyEpoch = 2;

  const result = await acknowledgement;
  assert.equal(result.state, 'ACKNOWLEDGED');
  assert.equal((await buildService().fetchEnvelope(fixture.recipientDeviceId, message.messageId)).state, 'ACKNOWLEDGED');
});

test('MySQL AUTHORITY RACE: outbound enqueue refuses a sender removed by a committed Trust Set rotation', async () => {
  const fixture = await seedOutboundAuthorityFixture();
  const messageId = randomUUID();
  const service = buildAuthorizedOutboundService();
  const result = await service.submitBatch(fixture.senderDeviceId, fixture.familyId, [outboundItem(fixture, messageId)], async () => {
    // The old epoch authorizes both snapshots, then its committed successor
    // removes the sender before createOrMatchEnvelope obtains the floor lock.
    await getPool().query(
      `UPDATE family_epoch_floors SET minimum_accepted_trust_set_epoch = 2, updated_at = NOW(3)
        WHERE family_id = ?`,
      [fixture.familyId],
    );
    return fixture.snapshot;
  });

  assert.deepEqual(result.results, [{ messageId, outcome: 'AUTHORITY_CHANGED' }]);
  await assert.rejects(() => buildService().fetchEnvelope(fixture.recipientDeviceId, messageId), { code: 'NOT_FOUND' });
});

test('MySQL AUTHORITY RACE: outbound enqueue refuses a recipient removed by a committed Trust Set rotation', async () => {
  const fixture = await seedOutboundAuthorityFixture();
  const messageId = randomUUID();
  const service = buildAuthorizedOutboundService();
  const result = await service.submitBatch(fixture.senderDeviceId, fixture.familyId, [outboundItem(fixture, messageId)], async () => {
    // A successor removing this recipient advances the same family floor;
    // a stale recipient resolver result cannot authorize the relay insert.
    await getPool().query(
      `UPDATE family_epoch_floors SET minimum_accepted_trust_set_epoch = 2, updated_at = NOW(3)
        WHERE family_id = ?`,
      [fixture.familyId],
    );
    return fixture.snapshot;
  });

  assert.deepEqual(result.results, [{ messageId, outcome: 'AUTHORITY_CHANGED' }]);
  await assert.rejects(() => buildService().fetchEnvelope(fixture.recipientDeviceId, messageId), { code: 'NOT_FOUND' });
});

test('MySQL AUTHORITY RACE: outbound enqueue refuses an exact sender DSK revoked after resolution', async () => {
  const fixture = await seedOutboundAuthorityFixture();
  const messageId = randomUUID();
  const service = buildAuthorizedOutboundService();
  const result = await service.submitBatch(fixture.senderDeviceId, fixture.familyId, [outboundItem(fixture, messageId)], async () => {
    await getPool().query(
      `UPDATE device_public_keys SET status = 'REVOKED', revoked_at = NOW(3)
        WHERE device_id = ? AND key_id = ? AND key_purpose = 'DSK'`,
      [fixture.senderDeviceId, fixture.senderDskKeyId],
    );
    return fixture.snapshot;
  });

  assert.deepEqual(result.results, [{ messageId, outcome: 'AUTHORITY_CHANGED' }]);
  await assert.rejects(() => buildService().fetchEnvelope(fixture.recipientDeviceId, messageId), { code: 'NOT_FOUND' });
});

test('MySQL AUTHORITY RACE: outbound enqueue refuses an exact recipient DSK revoked after resolution', async () => {
  const fixture = await seedOutboundAuthorityFixture();
  const messageId = randomUUID();
  const service = buildAuthorizedOutboundService();
  const result = await service.submitBatch(fixture.senderDeviceId, fixture.familyId, [outboundItem(fixture, messageId)], async () => {
    await getPool().query(
      `UPDATE device_public_keys SET status = 'REVOKED', revoked_at = NOW(3)
        WHERE device_id = ? AND key_id = ? AND key_purpose = 'DSK'`,
      [fixture.recipientDeviceId, fixture.recipientDskKeyId],
    );
    return fixture.snapshot;
  });

  assert.deepEqual(result.results, [{ messageId, outcome: 'AUTHORITY_CHANGED' }]);
  await assert.rejects(() => buildService().fetchEnvelope(fixture.recipientDeviceId, messageId), { code: 'NOT_FOUND' });
});

test('MySQL AUTHORITY: active exact sender and recipient snapshots permit creation and idempotent replay', async () => {
  const fixture = await seedOutboundAuthorityFixture();
  const message = outboundItem(fixture);
  const service = buildAuthorizedOutboundService();
  const authorizeRecipient = async () => fixture.snapshot;
  const first = await service.submitBatch(fixture.senderDeviceId, fixture.familyId, [message], authorizeRecipient);
  const replay = await service.submitBatch(fixture.senderDeviceId, fixture.familyId, [message], authorizeRecipient);
  assert.deepEqual(first.results, [{ messageId: message.messageId, outcome: 'QUEUED' }]);
  assert.deepEqual(replay.results, [{ messageId: message.messageId, outcome: 'QUEUED' }]);
  assert.equal((await buildService().fetchEnvelope(fixture.recipientDeviceId, message.messageId)).state, 'QUEUED');
});

test('MySQL AUTHORITY: authorized recipient snapshot permits inbound page and supplement reads', async () => {
  const fixture = await seedOutboundAuthorityFixture();
  const now = new Date();
  const input = envelope({ familyId: fixture.familyId, senderDeviceId: fixture.senderDeviceId,
    recipientDeviceId: fixture.recipientDeviceId, createdAt: now, expiresAt: new Date(now.getTime() + 60_000) });
  await buildService(() => now).queueEnvelope(input);
  const authority = { familyId: fixture.familyId, dskKeyId: fixture.recipientDskKeyId, trustSetEpoch: 1, keyEpoch: 1 };

  const page = await repository.listQueuedPageForRecipient(fixture.recipientDeviceId, fixture.familyId, now,
    { after: null, highWater: null, limit: 10 }, authority);
  const supplement = await repository.findQueuedForRecipient(fixture.recipientDeviceId, fixture.familyId,
    [input.messageId], now, authority);
  assert.deepEqual(page.records.map((record) => record.messageId), [input.messageId]);
  assert.deepEqual(supplement.map((record) => record.messageId), [input.messageId]);
});

test('MySQL AUTHORITY RACE: inbound page and supplement reject a committed Trust Set floor change', async () => {
  const fixture = await seedOutboundAuthorityFixture();
  const now = new Date();
  const input = envelope({ familyId: fixture.familyId, senderDeviceId: fixture.senderDeviceId,
    recipientDeviceId: fixture.recipientDeviceId, createdAt: now, expiresAt: new Date(now.getTime() + 60_000) });
  await buildService(() => now).queueEnvelope(input);
  const authority = { familyId: fixture.familyId, dskKeyId: fixture.recipientDskKeyId, trustSetEpoch: 1, keyEpoch: 1 };
  await getPool().query(
    `UPDATE family_epoch_floors SET minimum_accepted_trust_set_epoch = 2, updated_at = NOW(3) WHERE family_id = ?`,
    [fixture.familyId],
  );

  await assert.rejects(() => repository.listQueuedPageForRecipient(fixture.recipientDeviceId, fixture.familyId, now,
    { after: null, highWater: null, limit: 10 }, authority), RelayAuthorityChangedError);
  await assert.rejects(() => repository.findQueuedForRecipient(fixture.recipientDeviceId, fixture.familyId,
    [input.messageId], now, authority), RelayAuthorityChangedError);
  assert.equal((await buildService(() => now).fetchEnvelope(fixture.recipientDeviceId, input.messageId)).state, 'QUEUED',
    'failed authorized reads never alter relay custody');
});

test('MySQL AUTHORITY RACE: inbound page and supplement reject an exact recipient DSK revocation', async () => {
  const fixture = await seedOutboundAuthorityFixture();
  const now = new Date();
  const input = envelope({ familyId: fixture.familyId, senderDeviceId: fixture.senderDeviceId,
    recipientDeviceId: fixture.recipientDeviceId, createdAt: now, expiresAt: new Date(now.getTime() + 60_000) });
  await buildService(() => now).queueEnvelope(input);
  const authority = { familyId: fixture.familyId, dskKeyId: fixture.recipientDskKeyId, trustSetEpoch: 1, keyEpoch: 1 };
  await getPool().query(
    `UPDATE device_public_keys SET status = 'REVOKED', revoked_at = NOW(3)
      WHERE device_id = ? AND key_id = ? AND key_purpose = 'DSK'`,
    [fixture.recipientDeviceId, fixture.recipientDskKeyId],
  );

  await assert.rejects(() => repository.listQueuedPageForRecipient(fixture.recipientDeviceId, fixture.familyId, now,
    { after: null, highWater: null, limit: 10 }, authority), RelayAuthorityChangedError);
  await assert.rejects(() => repository.findQueuedForRecipient(fixture.recipientDeviceId, fixture.familyId,
    [input.messageId], now, authority), RelayAuthorityChangedError);
  assert.equal((await buildService(() => now).fetchEnvelope(fixture.recipientDeviceId, input.messageId)).state, 'QUEUED',
    'revocation blocks reads without deleting queued ciphertext');
});

test('MySQL CONCURRENCY: duplicate submission race -- many concurrent identical creates resolve consistently', async () => {
  const service = buildService();
  const input = envelope();
  const attempts = await Promise.allSettled(
    Array.from({ length: 20 }, () => service.queueEnvelope({ ...input })),
  );
  assert.equal(attempts.every((a) => a.status === 'fulfilled'), true, 'identical resubmissions must never fail');
  for (const outcome of attempts) assert.equal(outcome.value.ciphertext.equals(input.ciphertext), true);
  const [rows] = await getPool().query(
    `SELECT COUNT(*) AS n FROM relay_envelopes WHERE message_id = ? AND BINARY message_id = BINARY ?`,
    [input.messageId, input.messageId],
  );
  assert.equal(Number(rows[0].n), 1, 'concurrent exact retries must leave one durable row');
});

test('MySQL CONCURRENCY: changed ciphertext racing under one messageId has one winner and one durable row', async () => {
  const service = buildService();
  const input = envelope();
  const conflicting = { ...input, ciphertext: Buffer.from('different-ciphertext-racing-under-same-id') };

  const attempts = await Promise.allSettled([
    service.queueEnvelope(input),
    service.queueEnvelope(conflicting),
  ]);
  const accepted = attempts.filter((attempt) => attempt.status === 'fulfilled');
  const rejected = attempts.filter((attempt) => attempt.status === 'rejected');
  assert.equal(accepted.length, 1, 'exactly one ciphertext may win the messageId uniqueness race');
  assert.equal(rejected.length, 1, 'the changed-bytes loser must be rejected');
  assert.equal(rejected[0].reason?.code, 'CONFLICT', 'conflicting replay must never be reported as success');

  const winner = accepted[0].value;
  const durable = await service.fetchEnvelope(input.recipientDeviceId, input.messageId);
  assert.equal(durable.familyId, input.familyId);
  assert.equal(durable.senderDeviceId, input.senderDeviceId);
  assert.equal(durable.recipientDeviceId, input.recipientDeviceId);
  assert.equal(durable.ciphertext.equals(winner.ciphertext), true, 'the persisted bytes must belong to the one accepted response');

  const [rows] = await getPool().query(
    `SELECT COUNT(*) AS n FROM relay_envelopes WHERE message_id = ? AND BINARY message_id = BINARY ?`,
    [input.messageId, input.messageId],
  );
  assert.equal(Number(rows[0].n), 1, 'a conflicting concurrent retry cannot create a second durable row');
});

test('MySQL CONCURRENCY: ack race -- many concurrent acks on one envelope all resolve to the same acknowledgedAt', async () => {
  const service = buildService();
  const input = envelope();
  await service.queueEnvelope(input);
  const attempts = await Promise.allSettled(
    Array.from({ length: 20 }, () => service.acknowledgeEnvelope(input.recipientDeviceId, input.messageId)),
  );
  assert.equal(attempts.every((a) => a.status === 'fulfilled'), true);
  const timestamps = new Set(attempts.map((a) => a.value.acknowledgedAt.getTime()));
  assert.equal(timestamps.size, 1, 'all concurrent acks must agree on a single winning acknowledgedAt');
});

test('MySQL: keyset ties use exact binary order and survive ACK between pages', async () => {
  const now = new Date();
  const service = buildService(() => now);
  const shared = envelope();
  const prefix = randomUUID();
  const ids = ['A ', 'A!', 'Z', '\uE000', '\u{10000}'].map((suffix) => `${prefix}-${suffix}`);
  for (const messageId of ids) await service.queueEnvelope({ ...shared, messageId });
  const expected = [...ids].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
  const first = await repository.listQueuedPageForRecipient(shared.recipientDeviceId, shared.familyId, now,
    { after: null, highWater: null, limit: 2 });
  assert.deepEqual(first.records.map((record) => record.messageId), expected.slice(0, 2));
  assert.equal(first.hasMore, true);
  for (const record of first.records) await service.acknowledgeEnvelope(shared.recipientDeviceId, record.messageId);
  const second = await repository.listQueuedPageForRecipient(shared.recipientDeviceId, shared.familyId, now,
    { after: relayQueuePosition(first.records.at(-1)), highWater: first.highWater, limit: 100 });
  assert.deepEqual(second.records.map((record) => record.messageId), expected.slice(2));
  assert.equal(second.hasMore, false);
  assert.ok(compareRelayQueuePositions(relayQueuePosition(first.records.at(-1)), relayQueuePosition(second.records[0])) < 0);
});

test('MySQL: finite highwater excludes later arrivals and a fresh sweep sees them', async () => {
  let now = new Date();
  const service = buildService(() => now);
  const shared = envelope();
  for (let i = 0; i < 4; i += 1) await service.queueEnvelope({ ...shared, messageId: `${randomUUID()}-${i}` });
  const first = await repository.listQueuedPageForRecipient(shared.recipientDeviceId, shared.familyId, now,
    { after: null, highWater: null, limit: 2 });
  now = new Date(now.getTime() + 10);
  const late = `${randomUUID()}-late`;
  await service.queueEnvelope({ ...shared, messageId: late });
  const tail = await repository.listQueuedPageForRecipient(shared.recipientDeviceId, shared.familyId, now,
    { after: relayQueuePosition(first.records.at(-1)), highWater: first.highWater, limit: 100 });
  assert.equal(tail.records.length, 2);
  assert.equal(tail.records.some((record) => record.messageId === late), false);
  assert.equal(tail.hasMore, false);
  const fresh = await repository.listQueuedPageForRecipient(shared.recipientDeviceId, shared.familyId, now,
    { after: null, highWater: null, limit: 100 });
  assert.equal(fresh.records.length, 5); // no navigation operation acknowledges retained ciphertext
  assert.equal(fresh.records.some((record) => record.messageId === late), true);
});

test('MySQL: base pages and exact supplements cannot cross recipient or family', async () => {
  const now = new Date();
  const service = buildService(() => now);
  const own = envelope();
  const foreign = { ...own, messageId: randomUUID(), familyId: `foreign-${randomUUID()}` };
  await service.queueEnvelope(own);
  await service.queueEnvelope(foreign);
  const page = await repository.listQueuedPageForRecipient(own.recipientDeviceId, own.familyId, now,
    { after: null, highWater: null, limit: 100 });
  assert.deepEqual(page.records.map((record) => record.messageId), [own.messageId]);
  const found = await repository.findQueuedForRecipient(own.recipientDeviceId, own.familyId, [own.messageId, foreign.messageId], now);
  assert.deepEqual(found.map((record) => record.messageId), [own.messageId]);
  assert.deepEqual(await repository.findQueuedForRecipient(`wrong-${randomUUID()}`, own.familyId, [own.messageId], now), []);
});

test('MySQL: supported escaped message IDs retain exact positions and bounded cursors', async () => {
  const now = new Date();
  const service = buildService(() => now);
  const shared = envelope();
  const prefix = randomUUID().slice(0, 8);
  const ids = ['a', 'm', 'z'].map((lead) => lead + prefix + '\u0001'.repeat(119));
  for (const messageId of ids) await service.queueEnvelope({ ...shared, messageId });
  const first = await repository.listQueuedPageForRecipient(shared.recipientDeviceId, shared.familyId, now,
    { after: null, highWater: null, limit: 1 });
  assert.equal(first.records[0].messageId, ids[0]);
  const scope = { familyId: shared.familyId, recipientDeviceId: shared.recipientDeviceId, sessionIncarnation: 'a'.repeat(64) };
  const cursor = encodeRelayContinuation({ version: 1, scope, after: relayQueuePosition(first.records[0]),
    highWater: first.highWater, startedAtMs: now.getTime() });
  assert.ok(cursor.length > 2048);
  const navigation = decodeRelayContinuation(cursor, scope, now);
  const tail = await repository.listQueuedPageForRecipient(shared.recipientDeviceId, shared.familyId, now,
    { after: navigation.after, highWater: navigation.highWater, limit: 100 });
  assert.deepEqual(tail.records.map((record) => record.messageId), ids.slice(1));
});

test.after(async () => {
  await closePool();
});
