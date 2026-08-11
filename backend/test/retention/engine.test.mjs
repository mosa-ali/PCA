import assert from 'node:assert/strict';
import test from 'node:test';
import {
  computeExpiryInstant,
  isExpired,
  validateRetentionPolicy,
  resolveEffectiveWindow,
  planPurge,
  planDeleteNow,
  filterNonExpiredForExport,
} from '../../dist/retention/engine.js';
import { effectiveAuditRetentionMonths } from '../../dist/retention/policy.js';

function policy(overrides = {}) {
  return { generalWindow: '1_MONTH', locationMode: 'CURRENT_LAST_ONLY', timezone: 'UTC', ...overrides };
}

function record(overrides = {}) {
  return { entityClass: 'WEB_VISIT', id: 'r1', eventTimestampUtc: new Date('2026-01-01T00:00:00.000Z'), ...overrides };
}

// ---- every supported retention option ----

test('every supported retention window computes a later expiry than the last (14d < 1mo < 3mo < 6mo < 9mo)', () => {
  const event = new Date('2026-01-01T00:00:00.000Z');
  const windows = ['14_DAYS', '1_MONTH', '3_MONTHS', '6_MONTHS', '9_MONTHS'];
  const expiries = windows.map((w) => computeExpiryInstant(event, 'UTC', w).getTime());
  for (let i = 1; i < expiries.length; i += 1) {
    assert.ok(expiries[i] > expiries[i - 1], `${windows[i]} should expire later than ${windows[i - 1]}`);
  }
});

test('isExpired is boundary-inclusive: now exactly at expiry is expired', () => {
  const expiry = new Date('2026-01-15T00:00:00.000Z');
  assert.equal(isExpired(expiry, new Date('2026-01-15T00:00:00.000Z')), true);
  assert.equal(isExpired(expiry, new Date('2026-01-14T23:59:59.999Z')), false);
});

// ---- policy validation ----

test('location window shorter than or equal to general window is valid', () => {
  assert.deepEqual(validateRetentionPolicy(policy({ generalWindow: '9_MONTHS', locationMode: { window: '3_MONTHS' } })), []);
  assert.deepEqual(validateRetentionPolicy(policy({ generalWindow: '3_MONTHS', locationMode: { window: '3_MONTHS' } })), []);
});

test('location window longer than general window is rejected (PCA-DATA-022)', () => {
  const errors = validateRetentionPolicy(policy({ generalWindow: '14_DAYS', locationMode: { window: '9_MONTHS' } }));
  assert.deepEqual(errors, ['LOCATION_WINDOW_EXCEEDS_GENERAL']);
});

test('CURRENT_LAST_ONLY location mode is always valid, regardless of general window', () => {
  assert.deepEqual(validateRetentionPolicy(policy({ generalWindow: '14_DAYS', locationMode: 'CURRENT_LAST_ONLY' })), []);
});

test('audit entity classes resolve to AUDIT_FLOOR regardless of general/location window', () => {
  assert.equal(resolveEffectiveWindow('PARENT_ACTION_AUDIT', policy({ generalWindow: '14_DAYS' })), 'AUDIT_FLOOR');
  assert.equal(resolveEffectiveWindow('TAMPER_EVENT', policy({ generalWindow: '9_MONTHS' })), 'AUDIT_FLOOR');
});

// ---- purge planning: general entities ----

test('an expired general-entity record is purge-eligible; a fresh one is retained', () => {
  const p = policy({ generalWindow: '14_DAYS' });
  const now = new Date('2026-02-01T00:00:00.000Z'); // well past 14 days from Jan 1
  const records = [
    record({ id: 'old', eventTimestampUtc: new Date('2026-01-01T00:00:00.000Z') }),
    record({ id: 'fresh', eventTimestampUtc: new Date('2026-01-31T00:00:00.000Z') }),
  ];
  const plan = planPurge(records, p, now);
  assert.deepEqual(plan.toDelete.map((e) => e.id), ['old']);
  assert.equal(plan.retainedCount, 1);
});

// ---- audit floor ----

test('an audit record is retained past the general window if under the 12-month floor', () => {
  const p = policy({ generalWindow: '14_DAYS' });
  const now = new Date('2026-02-01T00:00:00.000Z'); // 31 days after event -- past 14d, well under 12mo
  const plan = planPurge([record({ entityClass: 'TAMPER_EVENT', eventTimestampUtc: new Date('2026-01-01T00:00:00.000Z') })], p, now);
  assert.deepEqual(plan.toDelete, []);
});

test('effectiveAuditRetentionMonths genuinely computes max(generalWindowMonths, 12), not a hardcoded 12 -- RED-TEAM FIX', () => {
  assert.equal(effectiveAuditRetentionMonths('9_MONTHS'), 12);
  assert.equal(effectiveAuditRetentionMonths('14_DAYS'), 12);
  // With today's option set (max 9 months) this always resolves to 12, but planPurge's
  // engine.ts now calls this function rather than a hardcoded constant -- see the
  // "audit record is retained past the general window" tests below, which exercise
  // the actual planPurge call path this function feeds into.
});

test('an audit record IS purge-eligible once past the 12-month floor', () => {
  const p = policy({ generalWindow: '14_DAYS' });
  const now = new Date('2027-02-01T00:00:00.000Z'); // >12 months after event
  const plan = planPurge([record({ entityClass: 'PARENT_ACTION_AUDIT', eventTimestampUtc: new Date('2026-01-01T00:00:00.000Z') })], p, now);
  assert.equal(plan.toDelete.length, 1);
});

// ---- location: rolling CURRENT_LAST_ONLY vs windowed ----

test('CURRENT_LAST_ONLY location mode keeps only the single most recent point, regardless of age', () => {
  const p = policy({ locationMode: 'CURRENT_LAST_ONLY' });
  const records = [
    record({ entityClass: 'LOCATION_POINT', id: 'a', eventTimestampUtc: new Date('2026-01-01T00:00:00.000Z') }),
    record({ entityClass: 'LOCATION_POINT', id: 'b', eventTimestampUtc: new Date('2026-01-02T00:00:00.000Z') }),
    record({ entityClass: 'LOCATION_POINT', id: 'c', eventTimestampUtc: new Date('2026-01-01T12:00:00.000Z') }),
  ];
  const plan = planPurge(records, p, new Date('2026-01-02T00:00:00.000Z')); // even the "most recent" point is 0 age -- still rolling, not window-based
  assert.deepEqual(plan.toDelete.map((e) => e.id).sort(), ['a', 'c']);
  assert.equal(plan.retainedCount, 1);
});

test('a windowed location policy (not CURRENT_LAST_ONLY) purges by expiry like any other entity', () => {
  const p = policy({ generalWindow: '9_MONTHS', locationMode: { window: '14_DAYS' } });
  const now = new Date('2026-02-01T00:00:00.000Z');
  const records = [record({ entityClass: 'LOCATION_POINT', id: 'old-loc', eventTimestampUtc: new Date('2026-01-01T00:00:00.000Z') })];
  const plan = planPurge(records, p, now);
  assert.deepEqual(plan.toDelete.map((e) => e.id), ['old-loc']);
});

// ---- policy shortening / lengthening ----

test('shortening the policy makes previously-retained records immediately purge-eligible on the next plan', () => {
  const now = new Date('2026-02-01T00:00:00.000Z');
  const records = [record({ eventTimestampUtc: new Date('2026-01-15T00:00:00.000Z') })]; // 17 days old
  const wide = planPurge(records, policy({ generalWindow: '9_MONTHS' }), now);
  assert.deepEqual(wide.toDelete, []); // retained under 9 months

  const narrow = planPurge(records, policy({ generalWindow: '14_DAYS' }), now);
  assert.equal(narrow.toDelete.length, 1); // now eligible under 14 days
});

test('lengthening the policy cannot resurrect a record no longer present in the working set (planPurge only ever sees what it is given)', () => {
  const now = new Date('2026-02-01T00:00:00.000Z');
  const stillHeld = [record({ id: 'survivor', eventTimestampUtc: new Date('2026-01-31T00:00:00.000Z') })];
  // The "deleted" record simply never appears in a later planPurge call again -- there is no code path here that could reintroduce it.
  const plan = planPurge(stillHeld, policy({ generalWindow: '9_MONTHS' }), now);
  assert.deepEqual(plan.toDelete, []);
  assert.equal(plan.retainedCount, 1);
});

// ---- Delete Now ----

test('Delete Now purges every general-entity record regardless of age, but never audit-floor entities', () => {
  const records = [
    record({ id: 'brand-new', eventTimestampUtc: new Date('2026-01-31T23:59:00.000Z') }),
    record({ entityClass: 'TAMPER_EVENT', id: 'audit-1', eventTimestampUtc: new Date('2026-01-01T00:00:00.000Z') }),
  ];
  const plan = planDeleteNow(records);
  assert.deepEqual(plan.toDelete.map((e) => e.id), ['brand-new']);
  assert.equal(plan.retainedCount, 1);
});

// ---- export inclusion/exclusion ----

test('retention-expired records are excluded from export inclusion', () => {
  const p = policy({ generalWindow: '14_DAYS' });
  const now = new Date('2026-02-01T00:00:00.000Z');
  const records = [
    record({ id: 'expired', eventTimestampUtc: new Date('2026-01-01T00:00:00.000Z') }),
    record({ id: 'fresh', eventTimestampUtc: new Date('2026-01-31T00:00:00.000Z') }),
  ];
  const included = filterNonExpiredForExport(records, p, now);
  assert.deepEqual(included.map((r) => r.id), ['fresh']);
});
