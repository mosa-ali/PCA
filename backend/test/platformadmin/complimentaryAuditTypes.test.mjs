// PCA-ADD-COMP-016: the four complimentary-grant audit event types are
// part of the closed PLATFORM_ADMIN_AUDIT_EVENT_TYPES vocabulary and pass
// validateAuditEvent -- a NEW file (never edits the existing shared
// auditTypes.test.mjs) so it cannot conflict with another lane's
// assertions there.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { PLATFORM_ADMIN_AUDIT_EVENT_TYPES, validateAuditEvent } from '../../dist/platformadmin/audit/types.js';

const NEW_EVENT_TYPES = ['COMPLIMENTARY_GRANT_CREATED', 'COMPLIMENTARY_GRANT_CHANGED', 'COMPLIMENTARY_GRANT_REVOKED', 'COMPLIMENTARY_GRANT_EXPIRED'];

test('all four complimentary-grant event types are registered', () => {
  for (const eventType of NEW_EVENT_TYPES) assert.ok(PLATFORM_ADMIN_AUDIT_EVENT_TYPES.includes(eventType), eventType);
});

test('validateAuditEvent accepts a well-formed complimentary-grant event', () => {
  for (const eventType of NEW_EVENT_TYPES) {
    const event = {
      eventId: randomUUID(),
      eventType,
      actorAdminId: null,
      actorRole: null,
      targetRef: `complimentary-grant:${randomUUID()}`,
      result: 'SUCCESS',
      occurredAt: new Date(),
      correlationId: randomUUID(),
      metadata: { grantId: randomUUID(), entitlementType: 'MANAGED_DEVICE_CAPACITY' },
    };
    assert.doesNotThrow(() => validateAuditEvent(event));
  }
});

test('validateAuditEvent still rejects an unknown event type (closed vocabulary discipline preserved)', () => {
  assert.throws(() =>
    validateAuditEvent({
      eventId: randomUUID(),
      eventType: 'COMPLIMENTARY_GRANT_MADE_UP',
      actorAdminId: null,
      actorRole: null,
      targetRef: null,
      result: 'SUCCESS',
      occurredAt: new Date(),
      correlationId: randomUUID(),
      metadata: null,
    }),
  );
});
