import assert from 'node:assert/strict';
import test from 'node:test';
import { ALL_RETENTION_ENTITY_CLASSES, isRetentionEntityClass } from '../../dist/retention/types.js';
import { isAuditEntityClass } from '../../dist/retention/policy.js';
import { planDeleteNow, resolveEffectiveWindow } from '../../dist/retention/engine.js';

test('ALL_RETENTION_ENTITY_CLASSES contains exactly the 13 general + 2 audit entity classes, no more, no fewer', () => {
  assert.equal(ALL_RETENTION_ENTITY_CLASSES.length, 15);
  assert.equal(new Set(ALL_RETENTION_ENTITY_CLASSES).size, 15); // no duplicates
  for (const expected of ['WEB_VISIT', 'CONTENT_BLOCK_EVENT', 'USAGE_SESSION', 'YOUTUBE_CONTROLLED_ACTIVITY', 'BREAK_SESSION', 'PROXIMITY_EVENT', 'LOCATION_POINT', 'PRAYER_REMINDER_EVENT', 'INSTALLED_APP_EVENT', 'ROUTINE_ACTIVITY', 'CHILD_REQUEST_DECISION', 'SYNC_RECEIPT', 'WELLBEING_COUNTER', 'PARENT_ACTION_AUDIT', 'TAMPER_EVENT']) {
    assert.ok(ALL_RETENTION_ENTITY_CLASSES.includes(expected), `missing ${expected}`);
  }
});

/**
 * Regression for the gap this member closes: android's RetentionEngine
 * purges the InstalledAppEvent table on the ordinary general window, but
 * the backend enum had no member for it, so retentionRoutes.ts's
 * parseDeleteNowRecords (which validates every caller-supplied entityClass
 * against ALL_RETENTION_ENTITY_CLASSES) rejected every delete-now record a
 * parent submitted for one.
 */
test('INSTALLED_APP_EVENT is a general (delete-now addressable) class, not an audit-floor one', () => {
  assert.equal(isRetentionEntityClass('INSTALLED_APP_EVENT'), true);
  assert.equal(isAuditEntityClass('INSTALLED_APP_EVENT'), false);
  const policy = { generalWindow: '3_MONTHS', locationMode: 'CURRENT_LAST_ONLY', timezone: 'UTC' };
  assert.equal(resolveEffectiveWindow('INSTALLED_APP_EVENT', policy), '3_MONTHS');
});

test('planDeleteNow purges an INSTALLED_APP_EVENT record (the delete-now path the enum gap closed off)', () => {
  const record = { entityClass: 'INSTALLED_APP_EVENT', id: 'installed-app-1', eventTimestampUtc: new Date('2026-01-01T00:00:00.000Z') };
  const plan = planDeleteNow([record]);
  assert.deepEqual(plan.toDelete.map((entry) => ({ entityClass: entry.entityClass, id: entry.id, reason: entry.reason })), [
    { entityClass: 'INSTALLED_APP_EVENT', id: 'installed-app-1', reason: 'DELETE_NOW' },
  ]);
  assert.equal(plan.retainedCount, 0);
});

test('isRetentionEntityClass accepts every known entity class', () => {
  for (const entityClass of ALL_RETENTION_ENTITY_CLASSES) {
    assert.equal(isRetentionEntityClass(entityClass), true, entityClass);
  }
});

test('PCA-DATA-020: isRetentionEntityClass rejects Section 3.2-protected entity names (Family, DeviceKeyMetadata, Policy, etc.) -- they must never be constructible as a RetentionRecord', () => {
  for (const protectedName of ['Family', 'DeviceKeyMetadata', 'Policy', 'Role', 'RecoveryExistenceRecord', 'License']) {
    assert.equal(isRetentionEntityClass(protectedName), false, protectedName);
  }
});

test('isRetentionEntityClass rejects garbage input (empty string, non-string, unknown label)', () => {
  assert.equal(isRetentionEntityClass(''), false);
  assert.equal(isRetentionEntityClass('NOT_A_REAL_ENTITY_CLASS'), false);
  assert.equal(isRetentionEntityClass(null), false);
  assert.equal(isRetentionEntityClass(undefined), false);
  assert.equal(isRetentionEntityClass(42), false);
  assert.equal(isRetentionEntityClass({}), false);
  assert.equal(isRetentionEntityClass(['WEB_VISIT']), false);
});

test('isRetentionEntityClass is case-sensitive (lowercase variant of a real class is rejected)', () => {
  assert.equal(isRetentionEntityClass('web_visit'), false);
});
