// PCA-COMMERCIAL-NOTIFY-1: no DB -- CommercialNotificationPublisher's
// outcome-mapping logic against a fake repository conforming to
// CommercialNotificationRepository's recordIfNew shape, plus the
// DEFAULT_MESSAGE_KEYS completeness invariant.
import assert from 'node:assert/strict';
import test from 'node:test';
import { MySqlCommercialNotificationPublisher, DEFAULT_MESSAGE_KEYS } from '../../dist/commercialnotifications/CommercialNotificationPublisher.js';
import { COMMERCIAL_NOTIFICATION_EVENT_TYPES } from '../../dist/commercialnotifications/types.js';

function fakeRow(input, now) {
  return {
    notificationId: 'fake-id',
    accountRef: input.accountRef,
    eventType: input.eventType,
    dedupeKey: input.dedupeKey,
    resourceRef: input.resourceRef,
    messageKey: input.messageKey,
    params: input.params,
    createdAt: now,
    readAt: null,
    acknowledgedAt: null,
  };
}

class FakeRecordedRepository {
  async recordIfNew(input, now) {
    return { outcome: 'RECORDED', row: fakeRow(input, now) };
  }
}

class FakeDuplicateRepository {
  async recordIfNew(input, now) {
    return { outcome: 'DUPLICATE', row: fakeRow(input, now) };
  }
}

test('DEFAULT_MESSAGE_KEYS has exactly one entry per event type, and every value is non-empty', () => {
  for (const eventType of COMMERCIAL_NOTIFICATION_EVENT_TYPES) {
    assert.ok(typeof DEFAULT_MESSAGE_KEYS[eventType] === 'string' && DEFAULT_MESSAGE_KEYS[eventType].length > 0, `missing default message key for ${eventType}`);
  }
  assert.equal(Object.keys(DEFAULT_MESSAGE_KEYS).length, COMMERCIAL_NOTIFICATION_EVENT_TYPES.length);
});

test('publish() maps a RECORDED repository outcome to PUBLISHED', async () => {
  const publisher = new MySqlCommercialNotificationPublisher(new FakeRecordedRepository());
  const result = await publisher.publish({
    accountRef: 'family-1',
    eventType: 'QUOTE_READY',
    dedupeKey: 'QUOTE_READY:quote-1',
    resourceRef: 'quote:quote-1',
    messageKey: DEFAULT_MESSAGE_KEYS.QUOTE_READY,
    params: { deviceLimit: 5 },
  });
  assert.equal(result.outcome, 'PUBLISHED');
  assert.equal(result.notification.dedupeKey, 'QUOTE_READY:quote-1');
});

test('publish() maps a DUPLICATE repository outcome to ALREADY_PUBLISHED, returning the already-recorded row', async () => {
  const publisher = new MySqlCommercialNotificationPublisher(new FakeDuplicateRepository());
  const result = await publisher.publish({
    accountRef: 'family-1',
    eventType: 'PAYMENT_CONFIRMED',
    dedupeKey: 'PAYMENT_CONFIRMED:evt-1',
    resourceRef: null,
    messageKey: DEFAULT_MESSAGE_KEYS.PAYMENT_CONFIRMED,
    params: null,
  });
  assert.equal(result.outcome, 'ALREADY_PUBLISHED');
  assert.equal(result.notification.dedupeKey, 'PAYMENT_CONFIRMED:evt-1');
});
