import assert from 'node:assert/strict';
import test from 'node:test';
import { ALL_RETENTION_ENTITY_CLASSES, isRetentionEntityClass } from '../../dist/retention/types.js';

test('ALL_RETENTION_ENTITY_CLASSES contains exactly the 12 general + 2 audit entity classes, no more, no fewer', () => {
  assert.equal(ALL_RETENTION_ENTITY_CLASSES.length, 14);
  assert.equal(new Set(ALL_RETENTION_ENTITY_CLASSES).size, 14); // no duplicates
  for (const expected of ['WEB_VISIT', 'CONTENT_BLOCK_EVENT', 'USAGE_SESSION', 'YOUTUBE_CONTROLLED_ACTIVITY', 'BREAK_SESSION', 'PROXIMITY_EVENT', 'LOCATION_POINT', 'PRAYER_REMINDER_EVENT', 'ROUTINE_ACTIVITY', 'CHILD_REQUEST_DECISION', 'SYNC_RECEIPT', 'WELLBEING_COUNTER', 'PARENT_ACTION_AUDIT', 'TAMPER_EVENT']) {
    assert.ok(ALL_RETENTION_ENTITY_CLASSES.includes(expected), `missing ${expected}`);
  }
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
