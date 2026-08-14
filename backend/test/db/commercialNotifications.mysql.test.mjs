// Real MySQL: dedupe (re-delivery), cross-family isolation, read/ack
// lifecycle, and bounded retention -- CommercialNotificationRepository/
// Service/Publisher against a real disposable database (constraint 14).
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { closePool, getPool } from '../../dist/db/pool.js';
import { CommercialNotificationRepository } from '../../dist/commercialnotifications/CommercialNotificationRepository.js';
import { CommercialNotificationService, CommercialNotificationSupportService } from '../../dist/commercialnotifications/CommercialNotificationService.js';
import { MySqlCommercialNotificationPublisher, DEFAULT_MESSAGE_KEYS } from '../../dist/commercialnotifications/CommercialNotificationPublisher.js';

if (!process.env.PCA_DATABASE_URL) throw new Error('PCA_DATABASE_URL is required for backend/test/db tests.');

const repository = new CommercialNotificationRepository();
const service = new CommercialNotificationService(repository);
const supportService = new CommercialNotificationSupportService(repository);
const publisher = new MySqlCommercialNotificationPublisher(repository);

function familyId() {
  return `family_${randomUUID()}`;
}

test('MySQL: re-delivery of the same logical event (same dedupeKey) is idempotent -- exactly one row ever exists', async () => {
  const accountRef = familyId();
  const dedupeKey = `PAYMENT_CONFIRMED:${randomUUID()}`;
  const input = { accountRef, eventType: 'PAYMENT_CONFIRMED', dedupeKey, resourceRef: null, messageKey: DEFAULT_MESSAGE_KEYS.PAYMENT_CONFIRMED, params: null };

  const first = await publisher.publish(input);
  assert.equal(first.outcome, 'PUBLISHED');
  const redelivered = await publisher.publish(input);
  assert.equal(redelivered.outcome, 'ALREADY_PUBLISHED');
  assert.equal(redelivered.notification.notificationId, first.notification.notificationId);

  const [rows] = await getPool().query(`SELECT COUNT(*) AS n FROM commercial_notifications WHERE dedupe_key = ?`, [dedupeKey]);
  assert.equal(Number(rows[0].n), 1);
});

test('MySQL: two different logical events for the same account each get their own row (dedupe key, not event type, is the identity)', async () => {
  const accountRef = familyId();
  const a = await publisher.publish({ accountRef, eventType: 'QUOTE_READY', dedupeKey: `QUOTE_READY:${randomUUID()}`, resourceRef: null, messageKey: DEFAULT_MESSAGE_KEYS.QUOTE_READY, params: null });
  const b = await publisher.publish({ accountRef, eventType: 'QUOTE_READY', dedupeKey: `QUOTE_READY:${randomUUID()}`, resourceRef: null, messageKey: DEFAULT_MESSAGE_KEYS.QUOTE_READY, params: null });
  assert.equal(a.outcome, 'PUBLISHED');
  assert.equal(b.outcome, 'PUBLISHED');
  assert.notEqual(a.notification.notificationId, b.notification.notificationId);
});

test('MySQL: cross-family isolation -- family A cannot list, mark-read, or acknowledge family B\'s notification', async () => {
  const accountA = familyId();
  const accountB = familyId();
  const published = await publisher.publish({
    accountRef: accountB,
    eventType: 'ENTITLEMENT_INCREASED',
    dedupeKey: `ENTITLEMENT_INCREASED:${randomUUID()}`,
    resourceRef: null,
    messageKey: DEFAULT_MESSAGE_KEYS.ENTITLEMENT_INCREASED,
    params: { newDeviceLimit: 10 },
  });

  const listedByA = await service.list(accountA);
  assert.equal(listedByA.some((n) => n.notificationId === published.notification.notificationId), false);
  const listedByB = await service.list(accountB);
  assert.equal(listedByB.some((n) => n.notificationId === published.notification.notificationId), true);

  const markOutcome = await service.markRead(published.notification.notificationId, accountA);
  assert.equal(markOutcome, 'NOT_FOUND');
  const ackOutcome = await service.acknowledge(published.notification.notificationId, accountA);
  assert.equal(ackOutcome, 'NOT_FOUND');

  // Confirm the row is genuinely untouched by account A's attempts.
  const stillUnread = await service.list(accountB);
  const row = stillUnread.find((n) => n.notificationId === published.notification.notificationId);
  assert.equal(row.readAt, null);
  assert.equal(row.acknowledgedAt, null);
});

test('MySQL: read/acknowledge lifecycle -- unreadCount decrements on read, acknowledge requires (and implies) read', async () => {
  const accountRef = familyId();
  const published = await publisher.publish({
    accountRef,
    eventType: 'PAYMENT_FAILED',
    dedupeKey: `PAYMENT_FAILED:${randomUUID()}`,
    resourceRef: 'payment_attempt:abc',
    messageKey: DEFAULT_MESSAGE_KEYS.PAYMENT_FAILED,
    params: { reasonCode: 'CARD_DECLINED' },
  });

  assert.equal(await service.unreadCount(accountRef), 1);

  const markOutcome = await service.markRead(published.notification.notificationId, accountRef);
  assert.equal(markOutcome, 'MARKED');
  assert.equal(await service.unreadCount(accountRef), 0);

  // Marking read again is an idempotent success, not an error.
  const markAgain = await service.markRead(published.notification.notificationId, accountRef);
  assert.equal(markAgain, 'MARKED');

  const ackOutcome = await service.acknowledge(published.notification.notificationId, accountRef);
  assert.equal(ackOutcome, 'ACKNOWLEDGED');

  const ackAgain = await service.acknowledge(published.notification.notificationId, accountRef);
  assert.equal(ackAgain, 'ACKNOWLEDGED');

  const [rows] = await getPool().query(`SELECT read_at, acknowledged_at FROM commercial_notifications WHERE notification_id = ?`, [published.notification.notificationId]);
  assert.notEqual(rows[0].read_at, null);
  assert.notEqual(rows[0].acknowledged_at, null);
});

test('MySQL: acknowledge() on an unread notification marks it read AND acknowledged in one call', async () => {
  const accountRef = familyId();
  const published = await publisher.publish({
    accountRef,
    eventType: 'REQUEST_DENIED',
    dedupeKey: `REQUEST_DENIED:${randomUUID()}`,
    resourceRef: null,
    messageKey: DEFAULT_MESSAGE_KEYS.REQUEST_DENIED,
    params: null,
  });
  assert.equal(await service.unreadCount(accountRef), 1);
  const ackOutcome = await service.acknowledge(published.notification.notificationId, accountRef);
  assert.equal(ackOutcome, 'ACKNOWLEDGED');
  assert.equal(await service.unreadCount(accountRef), 0);
});

test('MySQL: marking/acknowledging a nonexistent notification id returns NOT_FOUND, never throws', async () => {
  const accountRef = familyId();
  assert.equal(await service.markRead(randomUUID(), accountRef), 'NOT_FOUND');
  assert.equal(await service.acknowledge(randomUUID(), accountRef), 'NOT_FOUND');
});

test('MySQL: Platform Support view returns event type/status/opaque account ref only -- never messageKey or params', async () => {
  const accountRef = familyId();
  await publisher.publish({
    accountRef,
    eventType: 'QUOTE_EXPIRED',
    dedupeKey: `QUOTE_EXPIRED:${randomUUID()}`,
    resourceRef: 'quote:xyz',
    messageKey: DEFAULT_MESSAGE_KEYS.QUOTE_EXPIRED,
    params: { deviceLimit: 3 },
  });
  const supportRows = await supportService.listForSupport(accountRef);
  assert.equal(supportRows.length, 1);
  const row = supportRows[0];
  assert.equal(row.accountRef, accountRef);
  assert.equal(row.eventType, 'QUOTE_EXPIRED');
  assert.equal('messageKey' in row, false);
  assert.equal('params' in row, false);
  assert.equal('resourceRef' in row, false);
});

test('MySQL: retention -- pruneOlderThan deletes only rows older than the cutoff, leaving newer rows intact', async () => {
  const accountRef = familyId();
  const oldDedupe = `QUOTE_READY:${randomUUID()}`;
  const newDedupe = `QUOTE_READY:${randomUUID()}`;
  const oldPublished = await publisher.publish({ accountRef, eventType: 'QUOTE_READY', dedupeKey: oldDedupe, resourceRef: null, messageKey: DEFAULT_MESSAGE_KEYS.QUOTE_READY, params: null });
  const newPublished = await publisher.publish({ accountRef, eventType: 'QUOTE_READY', dedupeKey: newDedupe, resourceRef: null, messageKey: DEFAULT_MESSAGE_KEYS.QUOTE_READY, params: null });

  // Backdate the "old" row directly (repository has no update-created_at
  // method by design -- created_at is a durable fact, not caller-settable --
  // so this test reaches into the DB directly to simulate the passage of
  // time, exactly like other lanes' retention-sweep tests do).
  await getPool().query(`UPDATE commercial_notifications SET created_at = ? WHERE notification_id = ?`, [
    new Date(Date.now() - 400 * 24 * 60 * 60 * 1000),
    oldPublished.notification.notificationId,
  ]);

  const cutoff = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
  const deletedCount = await repository.pruneOlderThan(cutoff);
  assert.ok(deletedCount >= 1);

  const oldRow = await repository.findById(oldPublished.notification.notificationId);
  assert.equal(oldRow, null, 'row older than the cutoff must be pruned');
  const newRow = await repository.findById(newPublished.notification.notificationId);
  assert.notEqual(newRow, null, 'row newer than the cutoff must survive pruning');
});

test.after(async () => {
  await closePool();
});
