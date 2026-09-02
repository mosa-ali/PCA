// Static (no-DB) privacy/security gate over
// migrations/0033_commercial_notifications_renewal_upcoming.sql -- mirrors
// test/commercialnotifications/schemaPrivacy.test.mjs's pattern for
// migration 0012, scoped to this ALTER-only follow-up migration that widens
// commercial_notifications' event_type CHECK constraint to add
// `RENEWAL_UPCOMING`.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migration = await readFile(new URL('../../migrations/0033_commercial_notifications_renewal_upcoming.sql', import.meta.url), 'utf8');

test('renewal-upcoming migration introduces no new table and no new column -- it only widens the existing event_type CHECK constraint', () => {
  assert.equal(/CREATE TABLE/i.test(migration), false, 'migration 0033 must not introduce any new table');
  assert.equal(/ADD COLUMN/i.test(migration), false, 'migration 0033 must not introduce any new column');
  assert.match(migration, /ALTER TABLE commercial_notifications/);
});

test('renewal-upcoming migration shares no foreign key with any other table -- still no FOREIGN KEY/REFERENCES anywhere', () => {
  const ddl = migration.replace(/--[^\n]*/g, '');
  assert.equal(/FOREIGN KEY/i.test(ddl), false, 'commercial_notifications must not carry a FOREIGN KEY');
  assert.equal(/REFERENCES /i.test(ddl), false, 'commercial_notifications must not carry a REFERENCES clause');
});

// Same privacy term lists as test/commercialnotifications/schemaPrivacy.test.mjs
// (migration 0012), re-applied here since this migration's prose could in
// principle reintroduce a prohibited term even without a new column.
const PROHIBITED_PRIVACY_TERMS = [
  'url', 'title', 'search', 'location', 'usage', 'policy', 'pin', 'private_key', 'fdek', 'recovery_secret', 'camera', 'face',
  'youtube', 'domain', 'history', 'browser', 'latitude', 'longitude', 'geolocation', 'screen_time', 'app_name', 'bundle_id',
  'package_name', 'keyword', 'ip_address',
];

const PROHIBITED_PAYMENT_SECURITY_TERMS = [
  'card_number', 'pan', 'cvv', 'cvc', 'cvv2', 'card_verification', 'magnetic', 'track_data', 'chip_data',
  'account_number', 'routing_number', 'api_key', 'api_secret', 'client_secret', 'private_key',
];

test('renewal-upcoming migration does not introduce any family-activity/policy/privacy-prohibited or payment-security-prohibited term', () => {
  const schema = migration.replace(/--[^\n]*/g, '').toLowerCase();
  // 'title' excluded from the direct substring scan for the same reason
  // test/commercialnotifications/schemaPrivacy.test.mjs excludes it: this
  // migration's own CHECK constraint restates 0012's full event_type list,
  // which legitimately contains 'ENTITLEMENT_INCREASED' ("en-TITLE-ment"), a
  // substring false-positive, not a genuine "title" term. Asserted
  // separately below that no genuine "title" term exists outside that
  // false positive.
  const termsToScan = PROHIBITED_PRIVACY_TERMS.filter((term) => term !== 'title');
  for (const term of termsToScan) assert.equal(schema.includes(term), false, `prohibited schema term: ${term}`);
  assert.doesNotMatch(schema.replace(/entitlement/g, ''), /title/, 'no genuine "title" term outside the "entitlement" false-positive');
  for (const term of PROHIBITED_PAYMENT_SECURITY_TERMS) assert.equal(schema.includes(term), false, `prohibited payment-security term: ${term}`);
});

test('renewal-upcoming migration widens event_type_check to exactly the original 6 events plus RENEWAL_UPCOMING, nothing more', () => {
  const match = migration.match(/commercial_notifications_event_type_check CHECK \(\s*event_type IN \(([^)]*)\)/);
  assert.ok(match, 'event_type CHECK constraint not found in migration 0033');
  const values = match[1].split(',').map((v) => v.trim().replace(/^'|'$/g, ''));
  assert.deepEqual(
    values.sort(),
    ['ENTITLEMENT_INCREASED', 'PAYMENT_CONFIRMED', 'PAYMENT_FAILED', 'QUOTE_EXPIRED', 'QUOTE_READY', 'REQUEST_DENIED', 'RENEWAL_UPCOMING'].sort(),
  );
});

test('renewal-upcoming migration follows the DROP CHECK + ADD CONSTRAINT (same name) widening convention, not a destructive rebuild', () => {
  assert.match(migration, /DROP CHECK commercial_notifications_event_type_check/);
  assert.match(migration, /ADD CONSTRAINT commercial_notifications_event_type_check CHECK/);
  assert.equal(/DROP TABLE/i.test(migration), false);
});

test('CommercialNotificationEventType (types.ts) and the migration 0033 CHECK constraint agree exactly on the closed vocabulary', async () => {
  const { COMMERCIAL_NOTIFICATION_EVENT_TYPES } = await import('../../dist/commercialnotifications/types.js');
  const match = migration.match(/commercial_notifications_event_type_check CHECK \(\s*event_type IN \(([^)]*)\)/);
  const sqlValues = match[1].split(',').map((v) => v.trim().replace(/^'|'$/g, ''));
  assert.deepEqual([...COMMERCIAL_NOTIFICATION_EVENT_TYPES].sort(), sqlValues.sort());
});
