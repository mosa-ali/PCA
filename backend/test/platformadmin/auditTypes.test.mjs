import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { MAX_AUDIT_METADATA_BYTES, PLATFORM_ADMIN_AUDIT_EVENT_TYPES, validateAuditEvent } from '../../dist/platformadmin/audit/types.js';

function baseEvent(overrides = {}) {
  return {
    eventId: randomUUID(),
    eventType: 'ADMIN_LOGIN',
    actorAdminId: randomUUID(),
    actorRole: 'APP_OWNER',
    targetRef: `admin:${randomUUID()}`,
    result: 'SUCCESS',
    occurredAt: new Date(),
    correlationId: randomUUID(),
    metadata: null,
    ...overrides,
  };
}

test('every event type this lane emits is present in the closed vocabulary', () => {
  for (const type of [
    'ADMIN_LOGIN',
    'ADMIN_LOGIN_FAILED',
    'ADMIN_LOGIN_LOCKED_OUT',
    'ADMIN_CREATED',
    'ADMIN_ROLE_CHANGED',
    'ACCOUNT_SUSPENDED',
    'ACCOUNT_REACTIVATED',
    'ADMIN_SESSION_REVOKED',
    'ADMIN_STEP_UP_GRANTED',
    'ADMIN_STEP_UP_DENIED',
    'ADMIN_MFA_ENROLLED',
  ]) {
    assert.ok(PLATFORM_ADMIN_AUDIT_EVENT_TYPES.includes(type), `missing event type: ${type}`);
  }
});

test('validateAuditEvent accepts a well-formed event with null metadata', () => {
  assert.doesNotThrow(() => validateAuditEvent(baseEvent()));
});

test('validateAuditEvent throws (programming error) for an unrecognized event type', () => {
  assert.throws(() => validateAuditEvent(baseEvent({ eventType: 'NOT_A_REAL_EVENT_TYPE' })));
});

test('validateAuditEvent rejects an oversized targetRef', () => {
  assert.throws(() => validateAuditEvent(baseEvent({ targetRef: 'x'.repeat(200) })));
});

test('validateAuditEvent serializes small metadata and reports it under the byte cap', () => {
  const { metadataJson } = validateAuditEvent(baseEvent({ metadata: { action: 'GRANTED', role: 'PLATFORM_ADMIN' } }));
  assert.equal(typeof metadataJson, 'string');
  assert.ok(Buffer.byteLength(metadataJson, 'utf8') <= MAX_AUDIT_METADATA_BYTES);
});

test('validateAuditEvent throws when metadata exceeds the byte cap', () => {
  const oversized = { note: 'x'.repeat(MAX_AUDIT_METADATA_BYTES + 100) };
  assert.throws(() => validateAuditEvent(baseEvent({ metadata: oversized })));
});
