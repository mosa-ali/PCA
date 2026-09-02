// Regression tests for the server-held-ciphertext TTL (D016).
//
// The defect: relay_envelopes has enforced a 7-day server-ciphertext TTL
// since migration 0001 -- expires_at on insert, expired rows excluded from
// reads, purgeExpired DELETE. `family_audit_events` (0028) and
// `protection_alerts` (0025) each state they mirror that contract, but
// shipped with no expiry column, no purge, and no LIMIT on the per-request
// SELECT *, so the central service accumulated family ciphertext forever.
import assert from 'node:assert/strict';
import test from 'node:test';
import { MAX_RELAY_TTL_MS } from '../../dist/relay/policy.js';
import {
  MAX_SERVER_CIPHERTEXT_FEED_ROWS,
  SERVER_CIPHERTEXT_TTL_MS,
  applyServerCiphertextFeedWindow,
  computeServerCiphertextExpiry,
  isServerCiphertextExpired,
  resolveServerCiphertextFeedLimit,
} from '../../dist/retention/serverCiphertextTtl.js';
import { InMemoryProtectionAlertLedger } from '../../dist/alerts/ProtectionAlertLedger.js';
import { InMemoryFamilyAuditEventLedger } from '../../dist/familyrbac/FamilyAuditEventLedger.js';

const T0 = new Date('2026-01-01T00:00:00.000Z');
const plus = (ms) => new Date(T0.getTime() + ms);

function alert(overrides = {}) {
  return {
    alertId: `alert-${Math.random().toString(36).slice(2)}`,
    familyId: 'family-1',
    deviceId: 'device-1',
    parentDeviceId: 'parent-1',
    trigger: 'PROTECTION_DEGRADED',
    keyEpoch: 1,
    generatedAtUtc: T0,
    encryptedPayloadB64: 'AAAA',
    nonceB64: 'BBBB',
    ...overrides,
  };
}

function envelope(overrides = {}) {
  return {
    envelopeId: `envelope-${Math.random().toString(36).slice(2)}`,
    familyId: 'family-1',
    parentDeviceId: 'parent-1',
    keyEpoch: 1,
    generatedAtUtc: T0,
    encryptedPayloadB64: 'AAAA',
    nonceB64: 'BBBB',
    ...overrides,
  };
}

test('the TTL is the relay ceiling itself, so the two can never drift apart', () => {
  assert.equal(SERVER_CIPHERTEXT_TTL_MS, MAX_RELAY_TTL_MS);
  assert.equal(SERVER_CIPHERTEXT_TTL_MS, 7 * 24 * 60 * 60 * 1000);
  assert.equal(computeServerCiphertextExpiry(T0).getTime(), T0.getTime() + SERVER_CIPHERTEXT_TTL_MS);
});

test('expiry is inclusive at the boundary -- exactly at the TTL a row is already expired', () => {
  assert.equal(isServerCiphertextExpired(T0, plus(SERVER_CIPHERTEXT_TTL_MS - 1)), false);
  assert.equal(isServerCiphertextExpired(T0, plus(SERVER_CIPHERTEXT_TTL_MS)), true);
  assert.equal(isServerCiphertextExpired(T0, plus(SERVER_CIPHERTEXT_TTL_MS + 1)), true);
});

test('the feed limit is the server\'s to lower, never the caller\'s to raise', () => {
  assert.equal(resolveServerCiphertextFeedLimit(undefined), MAX_SERVER_CIPHERTEXT_FEED_ROWS);
  assert.equal(resolveServerCiphertextFeedLimit(10), 10);
  assert.equal(resolveServerCiphertextFeedLimit(MAX_SERVER_CIPHERTEXT_FEED_ROWS + 1), MAX_SERVER_CIPHERTEXT_FEED_ROWS);
  assert.equal(resolveServerCiphertextFeedLimit(1_000_000), MAX_SERVER_CIPHERTEXT_FEED_ROWS);
  assert.equal(resolveServerCiphertextFeedLimit(0), MAX_SERVER_CIPHERTEXT_FEED_ROWS);
  assert.equal(resolveServerCiphertextFeedLimit(-5), MAX_SERVER_CIPHERTEXT_FEED_ROWS);
  assert.equal(resolveServerCiphertextFeedLimit(2.5), MAX_SERVER_CIPHERTEXT_FEED_ROWS);
  assert.equal(resolveServerCiphertextFeedLimit(Number.NaN), MAX_SERVER_CIPHERTEXT_FEED_ROWS);
});

test('the bounded window keeps the NEWEST rows, still returned oldest-first', () => {
  const rows = Array.from({ length: 5 }, (_, index) => ({ id: index, generatedAtUtc: plus(index * 1000) }));

  const windowed = applyServerCiphertextFeedWindow(rows, plus(2000), 3);

  assert.deepEqual(
    windowed.map((row) => row.id),
    [2, 3, 4],
    'an oldest-first cap would starve the newest alerts until they aged out',
  );
});

test('protection alerts: an expired alert disappears from both feeds and is purged', async () => {
  let now = T0;
  const ledger = new InMemoryProtectionAlertLedger(() => now);
  const fresh = alert({ generatedAtUtc: plus(SERVER_CIPHERTEXT_TTL_MS - 1000) });
  const stale = alert({ generatedAtUtc: T0 });
  await ledger.record(stale);
  await ledger.record(fresh);

  assert.equal((await ledger.listForFamily('family-1')).length, 2);

  now = plus(SERVER_CIPHERTEXT_TTL_MS);
  const family = await ledger.listForFamily('family-1');
  const device = await ledger.listForParentDevice('family-1', 'parent-1');
  assert.deepEqual(family.map((event) => event.alertId), [fresh.alertId]);
  assert.deepEqual(device.map((event) => event.alertId), [fresh.alertId]);

  assert.equal(await ledger.purgeExpired(now), 1);
  assert.equal(await ledger.get(stale.alertId), null, 'purge must actually delete the expired ciphertext');
  assert.notEqual(await ledger.get(fresh.alertId), null, 'a live alert must survive the purge');
});

test('protection alerts: recording purges expired ciphertext on the write path', async () => {
  let now = T0;
  const ledger = new InMemoryProtectionAlertLedger(() => now);
  const stale = alert({ generatedAtUtc: T0 });
  await ledger.record(stale);

  now = plus(SERVER_CIPHERTEXT_TTL_MS);
  await ledger.record(alert({ generatedAtUtc: now }));

  assert.equal(await ledger.get(stale.alertId), null);
});

test('protection alerts: the feed is bounded even when a family generates far more than the cap', async () => {
  const ledger = new InMemoryProtectionAlertLedger(() => T0);
  for (let index = 0; index < MAX_SERVER_CIPHERTEXT_FEED_ROWS + 25; index++) {
    await ledger.record(alert({ alertId: `alert-${index}`, generatedAtUtc: plus(index) }));
  }

  const all = await ledger.listForFamily('family-1');
  assert.equal(all.length, MAX_SERVER_CIPHERTEXT_FEED_ROWS, 'an unbounded SELECT * is the defect this closes');
  assert.equal(all.at(-1).alertId, `alert-${MAX_SERVER_CIPHERTEXT_FEED_ROWS + 24}`, 'the newest row must be present');
  assert.equal((await ledger.listForParentDevice('family-1', 'parent-1', { limit: 7 })).length, 7);
});

test('family audit events: an expired envelope disappears from both feeds and is purged', async () => {
  let now = T0;
  const ledger = new InMemoryFamilyAuditEventLedger(() => now);
  const fresh = envelope({ generatedAtUtc: plus(SERVER_CIPHERTEXT_TTL_MS - 1000) });
  const stale = envelope({ generatedAtUtc: T0 });
  await ledger.record(stale);
  await ledger.record(fresh);

  assert.equal((await ledger.listForFamily('family-1')).length, 2);

  now = plus(SERVER_CIPHERTEXT_TTL_MS);
  assert.deepEqual((await ledger.listForFamily('family-1')).map((e) => e.envelopeId), [fresh.envelopeId]);
  assert.deepEqual(
    (await ledger.listForParentDevice('family-1', 'parent-1')).map((e) => e.envelopeId),
    [fresh.envelopeId],
  );

  assert.equal(await ledger.purgeExpired(now), 1);
  assert.equal(await ledger.get(stale.envelopeId), null);
});

test('family audit events: the feed is bounded', async () => {
  const ledger = new InMemoryFamilyAuditEventLedger(() => T0);
  for (let index = 0; index < MAX_SERVER_CIPHERTEXT_FEED_ROWS + 10; index++) {
    await ledger.record(envelope({ envelopeId: `envelope-${index}`, generatedAtUtc: plus(index) }));
  }

  const all = await ledger.listForFamily('family-1');
  assert.equal(all.length, MAX_SERVER_CIPHERTEXT_FEED_ROWS);
  assert.equal(all.at(-1).envelopeId, `envelope-${MAX_SERVER_CIPHERTEXT_FEED_ROWS + 9}`);
});

test('NEGATIVE: the expiry filter never hides a live row, and the ledgers stay oldest-first', async () => {
  const ledger = new InMemoryProtectionAlertLedger(() => T0);
  const later = alert({ alertId: 'b', generatedAtUtc: plus(2000) });
  const earlier = alert({ alertId: 'a', generatedAtUtc: plus(1000) });
  await ledger.record(later);
  await ledger.record(earlier);

  assert.deepEqual((await ledger.listForFamily('family-1')).map((event) => event.alertId), ['a', 'b']);
});

test('NEGATIVE: expiry is per-row, so one family\'s stale ciphertext never evicts another\'s live rows', async () => {
  let now = T0;
  const ledger = new InMemoryProtectionAlertLedger(() => now);
  await ledger.record(alert({ alertId: 'stale', familyId: 'family-1', generatedAtUtc: T0 }));
  await ledger.record(
    alert({ alertId: 'live', familyId: 'family-2', parentDeviceId: 'parent-2', generatedAtUtc: plus(SERVER_CIPHERTEXT_TTL_MS) }),
  );

  now = plus(SERVER_CIPHERTEXT_TTL_MS + 1);
  assert.deepEqual(await ledger.listForFamily('family-1'), []);
  assert.deepEqual((await ledger.listForFamily('family-2')).map((event) => event.alertId), ['live']);
});
