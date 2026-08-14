// Real MySQL CONCURRENCY: two connections racing to publish the SAME
// logical commercial event (same dedupeKey) -- exactly one must be
// RECORDED, mirroring test/db/billingCoreProviderEventConcurrency.mysql.test.mjs's
// pattern for CommercialNotificationRepository.recordIfNew's UNIQUE(dedupe_key)
// primitive (mission Section 5/10/11: "duplicate webhook must not create
// duplicate PAYMENT_CONFIRMED", "duplicate entitlement activation must not
// create duplicate ENTITLEMENT_INCREASED").
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { closePool, getPool } from '../../dist/db/pool.js';
import { CommercialNotificationRepository } from '../../dist/commercialnotifications/CommercialNotificationRepository.js';
import { MySqlCommercialNotificationPublisher, DEFAULT_MESSAGE_KEYS } from '../../dist/commercialnotifications/CommercialNotificationPublisher.js';

if (!process.env.PCA_DATABASE_URL) throw new Error('PCA_DATABASE_URL is required for backend/test/db tests.');

test('MySQL CONCURRENCY: two connections racing to publish the SAME dedupeKey (simulated duplicate PAYMENT_CONFIRMED webhook) -- exactly one succeeds', async () => {
  const publisher = new MySqlCommercialNotificationPublisher(new CommercialNotificationRepository());
  const accountRef = `family_${randomUUID()}`;
  const dedupeKey = `PAYMENT_CONFIRMED:${randomUUID()}`;
  const input = { accountRef, eventType: 'PAYMENT_CONFIRMED', dedupeKey, resourceRef: null, messageKey: DEFAULT_MESSAGE_KEYS.PAYMENT_CONFIRMED, params: null };

  const results = await Promise.all([publisher.publish(input), publisher.publish(input)]);

  const published = results.filter((r) => r.outcome === 'PUBLISHED');
  const already = results.filter((r) => r.outcome === 'ALREADY_PUBLISHED');
  assert.equal(published.length, 1, 'exactly one concurrent publish must be PUBLISHED');
  assert.equal(already.length, 1, 'the other concurrent publish must observe ALREADY_PUBLISHED');
  assert.equal(published[0].notification.notificationId, already[0].notification.notificationId);

  const [rows] = await getPool().query(`SELECT COUNT(*) AS n FROM commercial_notifications WHERE dedupe_key = ?`, [dedupeKey]);
  assert.equal(Number(rows[0].n), 1, 'exactly one row must exist for this dedupeKey after the race');
});

test('MySQL CONCURRENCY: simulated duplicate ENTITLEMENT_INCREASED activation retry -- three concurrent publishes for the same change-request-derived dedupeKey collapse to one row', async () => {
  const publisher = new MySqlCommercialNotificationPublisher(new CommercialNotificationRepository());
  const accountRef = `family_${randomUUID()}`;
  const changeRequestId = randomUUID();
  const dedupeKey = `ENTITLEMENT_INCREASED:${changeRequestId}`;
  const input = { accountRef, eventType: 'ENTITLEMENT_INCREASED', dedupeKey, resourceRef: `change_request:${changeRequestId}`, messageKey: DEFAULT_MESSAGE_KEYS.ENTITLEMENT_INCREASED, params: { newDeviceLimit: 8 } };

  const results = await Promise.all([publisher.publish(input), publisher.publish(input), publisher.publish(input)]);
  const published = results.filter((r) => r.outcome === 'PUBLISHED');
  assert.equal(published.length, 1, 'exactly one of three concurrent activation-retry publishes must be PUBLISHED');

  const [rows] = await getPool().query(`SELECT COUNT(*) AS n FROM commercial_notifications WHERE dedupe_key = ?`, [dedupeKey]);
  assert.equal(Number(rows[0].n), 1);
});

test.after(async () => {
  await closePool();
});
