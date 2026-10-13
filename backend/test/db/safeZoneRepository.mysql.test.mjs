import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import test, { after } from 'node:test';
import mysql from 'mysql2/promise';
import { closePool, getPool } from '../../dist/db/pool.js';
import { MySqlSafeZoneRepository } from '../../dist/location/MySqlSafeZoneRepository.js';
import { SafeZoneAuthorityChangedError, SafeZoneError } from '../../dist/location/SafeZoneRepository.js';

if (!process.env.PCA_DATABASE_URL) throw new Error('PCA_DATABASE_URL is required for backend/test/db tests.');

const repository = new MySqlSafeZoneRepository();

function newZone(familyId = randomUUID()) {
  return {
    familyId,
    recipientEndpointId: randomUUID(),
    ciphertextB64: 'AQID',
    nonceB64: 'AAECAwQFBgcICQoL',
    keyEpoch: 2,
  };
}

async function seedMutationAuthority() {
  const familyId = randomUUID();
  const actorDeviceId = randomUUID();
  const actorDskKeyId = randomUUID();
  const recipientDeviceId = randomUUID();
  const recipientDskKeyId = randomUUID();
  const createdAt = new Date();
  await getPool().query(
    `INSERT INTO families (family_id, family_reference_hash, created_at) VALUES (?, ?, NOW(3))`,
    [familyId, randomBytes(32)],
  );
  for (const [deviceId, dskKeyId] of [[actorDeviceId, actorDskKeyId], [recipientDeviceId, recipientDskKeyId]]) {
    await getPool().query(
      `INSERT INTO devices (device_id, family_id, platform, status, created_at, revoked_at)
       VALUES (?, ?, 'ANDROID', 'ACTIVE', ?, NULL)`,
      [deviceId, familyId, createdAt],
    );
    await getPool().query(
      `INSERT INTO device_public_keys (device_id, key_id, key_purpose, public_key, status, created_at, revoked_at)
       VALUES (?, ?, 'DSK', ?, 'ACTIVE', ?, NULL)`,
      [deviceId, dskKeyId, `safe-zone-test-key-${randomUUID()}`, createdAt],
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
    recipientDeviceId,
    actorDskKeyId,
    recipientDskKeyId,
    snapshot: {
      familyId,
      trustSetEpoch: 1,
      keyEpoch: 1,
      actor: { deviceId: actorDeviceId, dskKeyId: actorDskKeyId },
      recipient: { deviceId: recipientDeviceId, dskKeyId: recipientDskKeyId },
    },
  };
}

after(async () => {
  await closePool();
});

test('MySQL Safe Zone: key epoch may advance with a complete ciphertext/nonce pair and cannot roll back', async () => {
  const created = await repository.create(newZone());
  const advanced = await repository.update(created.familyId, created.zoneId, {
    ciphertextB64: 'BAUG',
    nonceB64: 'EBESExQVFhcYGRob',
    keyEpoch: 4,
  });

  assert.equal(advanced.keyEpoch, 4);
  assert.equal(advanced.revision, created.revision + 1);
  assert.equal(advanced.ciphertextB64, 'BAUG');
  assert.equal(advanced.nonceB64, 'EBESExQVFhcYGRob');
  assert.equal(advanced.deliveryState, 'PENDING_OFFLINE');

  await assert.rejects(
    () => repository.update(created.familyId, created.zoneId, {
      ciphertextB64: 'BwgJ',
      nonceB64: 'ICEiIyQlJicoKSor',
      keyEpoch: 3,
    }),
    (error) => error instanceof SafeZoneError && error.code === 'INVALID_INPUT',
  );

  const [afterRejectedRollback] = await repository.list(created.familyId);
  assert.equal(afterRejectedRollback.keyEpoch, 4);
  assert.equal(afterRejectedRollback.revision, advanced.revision);
  assert.equal(afterRejectedRollback.ciphertextB64, advanced.ciphertextB64);
  assert.equal(afterRejectedRollback.nonceB64, advanced.nonceB64);
});

test('MySQL Safe Zone AUTHORITY RACE: committed head rotation and exact DSK revocation block mutations transactionally', async () => {
  const fixture = await seedMutationAuthority();
  const created = await repository.create({
    ...newZone(fixture.familyId),
    recipientEndpointId: fixture.recipientDeviceId,
    keyEpoch: 1,
  }, fixture.snapshot);

  // Simulate a valid accepted epoch append completing after route resolution
  // but before the Safe Zone repository opens its transaction.
  await getPool().query(
    `UPDATE family_epoch_floors
        SET minimum_accepted_trust_set_epoch = 2, updated_at = NOW(3)
      WHERE family_id = ?`,
    [fixture.familyId],
  );
  await assert.rejects(
    () => repository.create({ ...newZone(fixture.familyId), recipientEndpointId: fixture.recipientDeviceId, keyEpoch: 1 }, fixture.snapshot),
    SafeZoneAuthorityChangedError,
  );
  await assert.rejects(
    () => repository.update(fixture.familyId, created.zoneId, {
      ciphertextB64: 'BAUG', nonceB64: 'EBESExQVFhcYGRob', keyEpoch: 1,
    }, fixture.snapshot),
    SafeZoneAuthorityChangedError,
  );
  await assert.rejects(
    () => repository.remove(fixture.familyId, created.zoneId, fixture.snapshot),
    SafeZoneAuthorityChangedError,
  );
  const [afterRotation] = await repository.list(fixture.familyId);
  assert.equal(afterRotation.zoneId, created.zoneId);
  assert.equal(afterRotation.revision, created.revision);
  assert.equal(afterRotation.ciphertextB64, created.ciphertextB64);

  // With the expected floor still current, a revoked exact session DSK is
  // independently rejected before delete can alter the retained row.
  await getPool().query(
    `UPDATE family_epoch_floors
        SET minimum_accepted_trust_set_epoch = 1, updated_at = NOW(3)
      WHERE family_id = ?`,
    [fixture.familyId],
  );
  await getPool().query(
    `UPDATE device_public_keys SET status = 'REVOKED', revoked_at = NOW(3)
      WHERE device_id = ? AND key_id = ? AND key_purpose = 'DSK'`,
    [fixture.snapshot.actor.deviceId, fixture.actorDskKeyId],
  );
  await assert.rejects(
    () => repository.remove(fixture.familyId, created.zoneId, fixture.snapshot),
    SafeZoneAuthorityChangedError,
  );
  await getPool().query(
    `UPDATE device_public_keys SET status = 'ACTIVE', revoked_at = NULL
      WHERE device_id = ? AND key_id = ? AND key_purpose = 'DSK'`,
    [fixture.snapshot.actor.deviceId, fixture.actorDskKeyId],
  );
  await getPool().query(
    `UPDATE device_public_keys SET status = 'REVOKED', revoked_at = NOW(3)
      WHERE device_id = ? AND key_id = ? AND key_purpose = 'DSK'`,
    [fixture.recipientDeviceId, fixture.recipientDskKeyId],
  );
  await assert.rejects(
    () => repository.remove(fixture.familyId, created.zoneId, fixture.snapshot),
    SafeZoneAuthorityChangedError,
  );
  assert.equal((await repository.list(fixture.familyId)).length, 1);
});

test('MySQL Safe Zone snapshots nested authority before waiting for the transaction floor lock', async () => {
  const fixture = await seedMutationAuthority();
  const authority = {
    ...fixture.snapshot,
    actor: { ...fixture.snapshot.actor },
    recipient: { ...fixture.snapshot.recipient },
  };
  const lock = await mysql.createConnection({ uri: process.env.PCA_DATABASE_URL, timezone: 'Z' });
  await lock.beginTransaction();
  try {
    await lock.execute(
      `SELECT family_id FROM family_epoch_floors WHERE family_id = ? FOR UPDATE`,
      [fixture.familyId],
    );
    const pending = repository.create({
      ...newZone(fixture.familyId), recipientEndpointId: fixture.recipientDeviceId, keyEpoch: 1,
    }, authority);
    await new Promise((resolve) => setTimeout(resolve, 100));
    authority.trustSetEpoch = 2;
    authority.actor.deviceId = 'mutated-actor';
    authority.actor.dskKeyId = 'mutated-actor-key';
    authority.recipient.dskKeyId = 'mutated-recipient-key';
    await lock.commit();
    const created = await pending;
    assert.equal(created.familyId, fixture.familyId);
    assert.equal(created.recipientEndpointId, fixture.recipientDeviceId);
    assert.equal(created.keyEpoch, 1);
  } finally {
    try { await lock.rollback(); } catch { /* transaction already committed */ }
    await lock.end();
  }
});

test('MySQL Safe Zone: create snapshots the validated payload before asynchronous database work', async () => {
  const input = newZone();
  const expected = { ...input };
  const pending = repository.create(input);
  input.familyId = `mutated-${randomUUID()}`;
  input.recipientEndpointId = `mutated-${randomUUID()}`;
  input.ciphertextB64 = 'not-canonical-base64url!';
  input.nonceB64 = 'short';
  input.keyEpoch = 0;

  const created = await pending;
  assert.equal(created.familyId, expected.familyId);
  assert.equal(created.recipientEndpointId, expected.recipientEndpointId);
  assert.equal(created.ciphertextB64, expected.ciphertextB64);
  assert.equal(created.nonceB64, expected.nonceB64);
  assert.equal(created.keyEpoch, expected.keyEpoch);
  assert.equal(created.revision, 1);
  assert.equal(created.deliveryState, 'PENDING_OFFLINE');
});

test('MySQL Safe Zone: update snapshots the validated ciphertext, nonce, and epoch before asynchronous database work', async () => {
  const created = await repository.create(newZone());
  const patch = {
    ciphertextB64: 'BAUG',
    nonceB64: 'EBESExQVFhcYGRob',
    keyEpoch: 4,
  };
  const pending = repository.update(created.familyId, created.zoneId, patch);
  patch.ciphertextB64 = 'not-canonical-base64url!';
  patch.nonceB64 = 'short';
  patch.keyEpoch = 0;

  const updated = await pending;
  assert.equal(updated.ciphertextB64, 'BAUG');
  assert.equal(updated.nonceB64, 'EBESExQVFhcYGRob');
  assert.equal(updated.keyEpoch, 4);
  assert.equal(updated.revision, created.revision + 1);
  assert.equal(updated.deliveryState, 'PENDING_OFFLINE');
});

test('MySQL Safe Zone: updated_at is sampled after a delayed row-lock acquisition', async () => {
  const created = await repository.create(newZone());
  const postLockTime = new Date('2030-04-05T06:07:08.000Z');
  let clockCalls = 0;
  const timedRepository = new MySqlSafeZoneRepository(() => {
    clockCalls += 1;
    return new Date(postLockTime);
  });
  const lock = await mysql.createConnection({ uri: process.env.PCA_DATABASE_URL, timezone: 'Z' });
  await lock.beginTransaction();
  let updateSettled = false;
  try {
    await lock.execute(
      'SELECT zone_id FROM safe_zones WHERE family_id = ? AND zone_id = ? FOR UPDATE',
      [created.familyId, created.zoneId],
    );
    const updatePromise = timedRepository.update(created.familyId, created.zoneId, {
      ciphertextB64: 'BAUG',
      nonceB64: 'EBESExQVFhcYGRob',
      keyEpoch: 3,
    }).finally(() => { updateSettled = true; });

    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(updateSettled, false, 'the edit must still be waiting behind the held row lock');
    assert.equal(clockCalls, 0, 'updated_at must not be sampled before the row lock is acquired');

    await lock.commit();
    const updated = await updatePromise;
    assert.equal(clockCalls, 1);
    assert.equal(updated.updatedAtUtc, postLockTime.toISOString());
    assert.equal(updated.revision, created.revision + 1);
  } finally {
    try { await lock.rollback(); } catch { /* already committed */ }
    await lock.end();
  }
});

test('MySQL Safe Zone: family-scoped update hides a zone owned by another family', async () => {
  const created = await repository.create(newZone());

  await assert.rejects(
    () => repository.update(randomUUID(), created.zoneId, {
      ciphertextB64: 'BAUG',
      nonceB64: 'EBESExQVFhcYGRob',
      keyEpoch: 9,
    }),
    (error) => error instanceof SafeZoneError && error.code === 'NOT_FOUND',
  );

  const [unchanged] = await repository.list(created.familyId);
  assert.equal(unchanged.keyEpoch, 2);
  assert.equal(unchanged.revision, created.revision);
  assert.equal(unchanged.ciphertextB64, created.ciphertextB64);
  assert.equal(unchanged.nonceB64, created.nonceB64);
});

test('MySQL Safe Zone delivery: list is restricted to the authenticated family and recipient device', async () => {
  const familyId = randomUUID();
  const recipientDeviceId = randomUUID();
  const otherDeviceId = randomUUID();
  const otherFamilyId = randomUUID();
  const recipientZone = await repository.create({ ...newZone(familyId), recipientEndpointId: recipientDeviceId });
  await repository.create({ ...newZone(familyId), recipientEndpointId: otherDeviceId });
  await repository.create({ ...newZone(otherFamilyId), recipientEndpointId: recipientDeviceId });

  const result = await repository.listForRecipient(familyId, recipientDeviceId, 2);
  assert.deepEqual(result.safeZones.map((zone) => zone.zoneId), [recipientZone.zoneId]);
  assert.equal(result.safeZones[0].ciphertextB64, recipientZone.ciphertextB64);
  assert.equal(result.safeZones[0].deliveryState, 'PENDING_OFFLINE');
  assert.equal(result.nextCursor, null);
  assert.deepEqual(await repository.listForRecipient(randomUUID(), recipientDeviceId, 2), { safeZones: [], nextCursor: null });
});

test('MySQL Safe Zone delivery: pages are bounded and advance without crossing recipient scope', async () => {
  const familyId = randomUUID();
  const recipientDeviceId = randomUUID();
  const created = [];
  for (let index = 0; index < 18; index += 1) {
    created.push(await repository.create({
      familyId,
      recipientEndpointId: recipientDeviceId,
      ciphertextB64: Buffer.from(`policy-${index}`).toString('base64url'),
      nonceB64: 'AAECAwQFBgcICQoL',
      keyEpoch: 1,
    }));
  }
  const firstPage = await repository.listForRecipient(familyId, recipientDeviceId, 1);
  assert.equal(firstPage.safeZones.length, 16);
  assert.ok(firstPage.nextCursor);
  assert.equal(firstPage.nextCursor, `v1~1~${firstPage.safeZones.at(-1).zoneId}`);
  const secondPage = await repository.listForRecipient(familyId, recipientDeviceId, 1, firstPage.nextCursor);
  assert.equal(secondPage.safeZones.length, 2);
  assert.equal(secondPage.nextCursor, null);
  assert.deepEqual(
    [...firstPage.safeZones, ...secondPage.safeZones].map((zone) => zone.zoneId).sort(),
    created.map((zone) => zone.zoneId).sort(),
  );
});

test('MySQL Safe Zone delivery restarts when a cursor epoch is stale after rows are rekeyed', async () => {
  const familyId = randomUUID();
  const recipientDeviceId = randomUUID();
  const created = [];
  for (let index = 0; index < 18; index += 1) {
    created.push(await repository.create({
      familyId,
      recipientEndpointId: recipientDeviceId,
      ciphertextB64: Buffer.from(`epoch-1-policy-${index}`).toString('base64url'),
      nonceB64: 'AAECAwQFBgcICQoL',
      keyEpoch: 1,
    }));
  }

  const firstPage = await repository.listForRecipient(familyId, recipientDeviceId, 1);
  assert.equal(firstPage.safeZones.length, 16);
  assert.ok(firstPage.nextCursor);
  const oldCursor = firstPage.nextCursor;
  const rowAtOrBeforeCursor = firstPage.safeZones[0].zoneId;

  for (const zone of created) {
    await repository.update(familyId, zone.zoneId, {
      ciphertextB64: 'BAUG',
      nonceB64: 'EBESExQVFhcYGRob',
      keyEpoch: 2,
    });
  }

  const expectedFirstPageIds = created.map((zone) => zone.zoneId).sort().slice(0, 16);
  const resumed = await repository.listForRecipient(familyId, recipientDeviceId, 2, oldCursor);
  assert.deepEqual(resumed.safeZones.map((zone) => zone.zoneId), expectedFirstPageIds);
  assert.ok(resumed.safeZones.some((zone) => zone.zoneId === rowAtOrBeforeCursor));
  assert.ok(resumed.safeZones.every((zone) => zone.keyEpoch === 2));
  assert.equal(resumed.nextCursor, `v1~2~${resumed.safeZones.at(-1).zoneId}`);

  const legacyRestart = await repository.listForRecipient(
    familyId,
    recipientDeviceId,
    2,
    firstPage.safeZones.at(-1).zoneId,
  );
  assert.deepEqual(legacyRestart.safeZones.map((zone) => zone.zoneId), expectedFirstPageIds);
});

test('MySQL Safe Zone CONCURRENCY: serialized epoch updates leave the highest accepted key epoch', async () => {
  const created = await repository.create(newZone());
  const attempts = await Promise.allSettled([
    repository.update(created.familyId, created.zoneId, {
      ciphertextB64: 'BAUG',
      nonceB64: 'EBESExQVFhcYGRob',
      keyEpoch: 4,
    }),
    repository.update(created.familyId, created.zoneId, {
      ciphertextB64: 'BwgJ',
      nonceB64: 'ICEiIyQlJicoKSor',
      keyEpoch: 3,
    }),
  ]);

  assert.ok(attempts.some((attempt) => attempt.status === 'fulfilled'));
  for (const attempt of attempts) {
    if (attempt.status === 'rejected') {
      assert.ok(attempt.reason instanceof SafeZoneError);
      assert.equal(attempt.reason.code, 'INVALID_INPUT');
    }
  }
  const [persisted] = await repository.list(created.familyId);
  assert.equal(persisted.keyEpoch, 4);
  assert.ok(persisted.revision === created.revision + 1 || persisted.revision === created.revision + 2);
});
