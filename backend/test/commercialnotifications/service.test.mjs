// PCA-COMMERCIAL-NOTIFY-1 / doc 20 PCA-FR-113: CommercialNotificationService's genuine,
// generation-time EN/AR localization of a notification row's body (renderLocalizedBody /
// listWithLocalizedBody), additive alongside the existing structured messageKey/params contract
// a client-side localizer may still use directly. No DB -- listWithLocalizedBody is exercised
// against a fake repository conforming to listByAccount's shape.
import assert from 'node:assert/strict';
import test from 'node:test';
import { CommercialNotificationService } from '../../dist/commercialnotifications/CommercialNotificationService.js';
import { COMMERCIAL_NOTIFICATION_EVENT_TYPES } from '../../dist/commercialnotifications/types.js';

function row(overrides = {}) {
  return {
    notificationId: 'notif-1',
    accountRef: 'family-1',
    eventType: 'QUOTE_READY',
    dedupeKey: 'QUOTE_READY:quote-1',
    resourceRef: 'quote:quote-1',
    messageKey: 'commercial_notification.QUOTE_READY',
    params: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    readAt: null,
    acknowledgedAt: null,
    ...overrides,
  };
}

class FakeRepository {
  constructor(rows) {
    this.rows = rows;
  }
  async listByAccount(accountRef, limit) {
    const scoped = this.rows.filter((r) => r.accountRef === accountRef);
    return typeof limit === 'number' ? scoped.slice(0, limit) : scoped;
  }
}

test('renderLocalizedBody produces the correct English text by default for every event type', () => {
  const service = new CommercialNotificationService(new FakeRepository([]));
  const expected = {
    QUOTE_READY: 'A new quote is ready for your review.',
    PAYMENT_CONFIRMED: 'Your payment has been confirmed.',
    ENTITLEMENT_INCREASED: 'Your account entitlement has been increased.',
    PAYMENT_FAILED: 'Your payment could not be completed.',
    REQUEST_DENIED: 'Your request was not approved.',
    QUOTE_EXPIRED: 'Your quote has expired.',
  };
  for (const eventType of COMMERCIAL_NOTIFICATION_EVENT_TYPES) {
    assert.equal(service.renderLocalizedBody(row({ eventType }), 'en'), expected[eventType], `mismatch for ${eventType}`);
  }
});

test('renderLocalizedBody produces a genuine, non-mixed-language Arabic body for every event type', () => {
  const service = new CommercialNotificationService(new FakeRepository([]));
  for (const eventType of COMMERCIAL_NOTIFICATION_EVENT_TYPES) {
    const text = service.renderLocalizedBody(row({ eventType }), 'ar');
    assert.ok(text.length > 0, `empty Arabic text for ${eventType}`);
    assert.equal(/[A-Za-z]/.test(text), false, `Arabic body for ${eventType} unexpectedly contains Latin letters: ${text}`);
  }
});

test('renderLocalizedBody is resolved purely from eventType, ignoring an arbitrary/overridden messageKey', () => {
  const service = new CommercialNotificationService(new FakeRepository([]));
  const weirdRow = row({ eventType: 'PAYMENT_FAILED', messageKey: 'some.other.custom.key' });
  assert.equal(service.renderLocalizedBody(weirdRow, 'en'), 'Your payment could not be completed.');
});

test('listWithLocalizedBody attaches a localizedBody to every row without altering the structured messageKey/params fields', async () => {
  const rows = [
    row({ notificationId: 'n1', eventType: 'QUOTE_READY' }),
    row({ notificationId: 'n2', eventType: 'PAYMENT_CONFIRMED', accountRef: 'family-1' }),
    row({ notificationId: 'n3', eventType: 'PAYMENT_FAILED', accountRef: 'family-2' }), // different family, must be excluded
  ];
  const service = new CommercialNotificationService(new FakeRepository(rows));

  const enResult = await service.listWithLocalizedBody('family-1', 'en');
  assert.deepEqual(enResult.map((r) => r.notificationId).sort(), ['n1', 'n2']);
  const n1 = enResult.find((r) => r.notificationId === 'n1');
  assert.equal(n1.localizedBody, 'A new quote is ready for your review.');
  assert.equal(n1.messageKey, 'commercial_notification.QUOTE_READY'); // structured contract untouched
  assert.equal(n1.params, null);

  const arResult = await service.listWithLocalizedBody('family-1', 'ar');
  const n1Ar = arResult.find((r) => r.notificationId === 'n1');
  assert.equal(n1Ar.localizedBody, 'عرض سعر جديد جاهز لمراجعتك.');
  assert.equal(/[A-Za-z]/.test(n1Ar.localizedBody), false);
});
