// Real-MySQL proof of the server-ciphertext TTL on `family_audit_events`
// and `protection_alerts` (D016), against the actual migration-0034 schema.
//
// Mirrors backend/test/db/relay.mysql.test.mjs's TTL test: advance an
// injected clock past the ceiling and assert the row is gone from the feed,
// then assert the purge actually deletes the ciphertext.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { MySqlProtectionAlertLedger } from '../../dist/alerts/MySqlProtectionAlertLedger.js';
import { MySqlFamilyAuditEventLedger } from '../../dist/familyrbac/MySqlFamilyAuditEventLedger.js';
import { SERVER_CIPHERTEXT_TTL_MS, MAX_SERVER_CIPHERTEXT_FEED_ROWS } from '../../dist/retention/serverCiphertextTtl.js';
import { closePool, execute, runInTransaction } from '../../dist/db/pool.js';

if (!process.env.PCA_DATABASE_URL) throw new Error('PCA_DATABASE_URL is required for backend/test/db tests.');

const T0 = new Date('2026-01-01T00:00:00.000Z');
const plus = (ms) => new Date(T0.getTime() + ms);

function alert(familyId, parentDeviceId, overrides = {}) {
  return {
    alertId: `alert-${randomUUID()}`,
    familyId,
    deviceId: `device-${randomUUID()}`,
    parentDeviceId,
    trigger: 'PROTECTION_DEGRADED',
    keyEpoch: 1,
    generatedAtUtc: T0,
    encryptedPayloadB64: 'AAAA',
    nonceB64: 'BBBB',
    ...overrides,
  };
}

function envelope(familyId, parentDeviceId, overrides = {}) {
  return {
    envelopeId: `envelope-${randomUUID()}`,
    familyId,
    parentDeviceId,
    keyEpoch: 1,
    generatedAtUtc: T0,
    encryptedPayloadB64: 'AAAA',
    nonceB64: 'BBBB',
    ...overrides,
  };
}

async function countRows(table, familyId) {
  const { rows } = await runInTransaction((conn) =>
    execute(conn, `SELECT COUNT(*) AS n FROM ${table} WHERE family_id = ?`, [familyId]),
  );
  return Number(rows[0].n);
}

test('MySQL: protection_alerts rows carry an expires_at exactly the TTL past generated_at_utc', async () => {
  const familyId = `family-${randomUUID()}`;
  const ledger = new MySqlProtectionAlertLedger(() => T0);
  const event = alert(familyId, `parent-${randomUUID()}`);

  assert.deepEqual(await ledger.record(event), { outcome: 'RECORDED' });

  const { rows } = await runInTransaction((conn) =>
    execute(conn, `SELECT expires_at FROM protection_alerts WHERE alert_id = ?`, [event.alertId]),
  );
  assert.equal(new Date(rows[0].expires_at).getTime(), T0.getTime() + SERVER_CIPHERTEXT_TTL_MS);
});

test('MySQL: an expired alert is invisible to both feeds, and purgeExpired deletes it', async () => {
  const familyId = `family-${randomUUID()}`;
  const parentDeviceId = `parent-${randomUUID()}`;
  let now = T0;
  const ledger = new MySqlProtectionAlertLedger(() => now);
  const stale = alert(familyId, parentDeviceId, { generatedAtUtc: T0 });
  const fresh = alert(familyId, parentDeviceId, { generatedAtUtc: plus(SERVER_CIPHERTEXT_TTL_MS - 1000) });
  await ledger.record(stale);
  await ledger.record(fresh);

  assert.equal((await ledger.listForFamily(familyId)).length, 2);

  now = plus(SERVER_CIPHERTEXT_TTL_MS);
  assert.deepEqual((await ledger.listForFamily(familyId)).map((e) => e.alertId), [fresh.alertId]);
  assert.deepEqual((await ledger.listForParentDevice(familyId, parentDeviceId)).map((e) => e.alertId), [fresh.alertId]);

  assert.ok((await ledger.purgeExpired(now)) >= 1);
  assert.equal(await ledger.get(stale.alertId), null, 'expired ciphertext must actually leave the database');
  assert.notEqual(await ledger.get(fresh.alertId), null);
  assert.equal(await countRows('protection_alerts', familyId), 1);
});

test('MySQL: the protection-alert feed is bounded and returns the NEWEST rows, oldest-first', async () => {
  const familyId = `family-${randomUUID()}`;
  const parentDeviceId = `parent-${randomUUID()}`;
  const ledger = new MySqlProtectionAlertLedger(() => T0);
  const total = 12;
  const created = [];
  for (let index = 0; index < total; index++) {
    const event = alert(familyId, parentDeviceId, { generatedAtUtc: plus(index * 1000) });
    created.push(event);
    await ledger.record(event);
  }

  const page = await ledger.listForParentDevice(familyId, parentDeviceId, { limit: 5 });
  assert.deepEqual(
    page.map((e) => e.alertId),
    created.slice(total - 5).map((e) => e.alertId),
  );
  // A caller cannot raise the server's own bound.
  assert.equal((await ledger.listForFamily(familyId, { limit: MAX_SERVER_CIPHERTEXT_FEED_ROWS + 1000 })).length, total);
});

test('MySQL: family_audit_events gets the same expiry, feed filtering, and purge', async () => {
  const familyId = `family-${randomUUID()}`;
  const parentDeviceId = `parent-${randomUUID()}`;
  let now = T0;
  const ledger = new MySqlFamilyAuditEventLedger(() => now);
  const stale = envelope(familyId, parentDeviceId, { generatedAtUtc: T0 });
  const fresh = envelope(familyId, parentDeviceId, { generatedAtUtc: plus(SERVER_CIPHERTEXT_TTL_MS - 1000) });
  await ledger.record(stale);
  await ledger.record(fresh);

  const { rows } = await runInTransaction((conn) =>
    execute(conn, `SELECT expires_at FROM family_audit_events WHERE envelope_id = ?`, [stale.envelopeId]),
  );
  assert.equal(new Date(rows[0].expires_at).getTime(), T0.getTime() + SERVER_CIPHERTEXT_TTL_MS);

  now = plus(SERVER_CIPHERTEXT_TTL_MS);
  assert.deepEqual((await ledger.listForFamily(familyId)).map((e) => e.envelopeId), [fresh.envelopeId]);
  assert.deepEqual(
    (await ledger.listForParentDevice(familyId, parentDeviceId)).map((e) => e.envelopeId),
    [fresh.envelopeId],
  );

  assert.ok((await ledger.purgeExpired(now)) >= 1);
  assert.equal(await ledger.get(stale.envelopeId), null);
  assert.equal(await countRows('family_audit_events', familyId), 1);
});

test('MySQL: idempotent record() still works unchanged with the expiry column present', async () => {
  const familyId = `family-${randomUUID()}`;
  const ledger = new MySqlProtectionAlertLedger(() => T0);
  const event = alert(familyId, `parent-${randomUUID()}`);

  assert.deepEqual(await ledger.record(event), { outcome: 'RECORDED' });
  assert.deepEqual(await ledger.record({ ...event }), { outcome: 'IDEMPOTENT_MATCH' });
  assert.deepEqual(await ledger.record({ ...event, keyEpoch: 9 }), { outcome: 'CONFLICT' });
});

test('MySQL NEGATIVE: one parent device never sees another device\'s queued ciphertext', async () => {
  const familyId = `family-${randomUUID()}`;
  const mine = `parent-${randomUUID()}`;
  const theirs = `parent-${randomUUID()}`;
  const ledger = new MySqlProtectionAlertLedger(() => T0);
  const theirAlert = alert(familyId, theirs);
  await ledger.record(theirAlert);

  assert.deepEqual(await ledger.listForParentDevice(familyId, mine), []);
  assert.deepEqual((await ledger.listForParentDevice(familyId, theirs)).map((e) => e.alertId), [theirAlert.alertId]);
});

test.after(async () => {
  await closePool();
});
