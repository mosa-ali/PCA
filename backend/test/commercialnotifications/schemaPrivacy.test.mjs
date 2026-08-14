// Static (no-DB) privacy/security gate over
// migrations/0012_commercial_notifications.sql -- mirrors
// test/billing/schemaPrivacy.test.mjs's pattern. The live-database
// counterpart is test/db/commercialNotificationsSchemaPrivacy.mysql.test.mjs.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migration = await readFile(new URL('../../migrations/0012_commercial_notifications.sql', import.meta.url), 'utf8');

test('commercial-notifications migration contains exactly the approved 1 table', () => {
  assert.match(migration, /CREATE TABLE commercial_notifications \(/);
  const createCount = (migration.match(/CREATE TABLE /g) ?? []).length;
  assert.equal(createCount, 1, 'unexpected extra CREATE TABLE statement in migration 0012');
});

// General family-monitoring privacy term list, mirroring
// test/schema-privacy.test.mjs's prohibitedTerms (doc 09 Section 5.2 data
// classes) and test/billing/schemaPrivacy.test.mjs's own extension of it.
const PROHIBITED_PRIVACY_TERMS = [
  'url', 'title', 'search', 'location', 'usage', 'policy', 'pin', 'private_key', 'fdek', 'recovery_secret', 'camera', 'face',
  'youtube', 'domain', 'history', 'browser', 'latitude', 'longitude', 'geolocation', 'screen_time', 'app_name', 'bundle_id',
  'package_name', 'keyword', 'ip_address',
];

test('commercial-notifications migration does not introduce any family-activity/policy/privacy-prohibited field', () => {
  const schema = migration.replace(/--[^\n]*/g, '').toLowerCase();
  // 'title' is excluded from the direct substring scan only: it is a
  // substring false-positive of this migration's legitimate
  // 'ENTITLEMENT_INCREASED' event-type value ("en-TITLE-ment"), mirroring
  // test/billing/schemaPrivacy.test.mjs's identical, reviewed exclusion for
  // the same reason. Asserted separately below that no genuine "title" term
  // exists outside that false positive.
  const termsToScan = PROHIBITED_PRIVACY_TERMS.filter((term) => term !== 'title');
  for (const term of termsToScan) assert.equal(schema.includes(term), false, `prohibited schema term: ${term}`);
  assert.doesNotMatch(schema.replace(/entitlement/g, ''), /title/, 'no genuine "title" term outside the "entitlement" false-positive');
});

// Payment-security-specific prohibited terms, mirroring
// test/billing/schemaPrivacy.test.mjs (PCA-ADD-BILL-023/024).
const PROHIBITED_PAYMENT_SECURITY_TERMS = [
  'card_number', 'pan', 'cvv', 'cvc', 'cvv2', 'card_verification', 'magnetic', 'track_data', 'chip_data',
  'account_number', 'routing_number', 'api_key', 'api_secret', 'client_secret', 'private_key',
];

test('commercial-notifications migration introduces no column capable of storing a full PAN, CVV/CVC, raw card/bank credential, or unredacted provider secret', () => {
  const schema = migration.replace(/--[^\n]*/g, '').toLowerCase();
  for (const term of PROHIBITED_PAYMENT_SECURITY_TERMS) assert.equal(schema.includes(term), false, `prohibited payment-security term: ${term}`);
});

test('commercial_notifications carries only the approved column set, nothing more', () => {
  const match = migration.match(/CREATE TABLE commercial_notifications \(([\s\S]*?)\) ENGINE=InnoDB;/);
  assert.ok(match, 'commercial_notifications table definition not found');
  const body = match[1];
  const RESERVED_LINE_PREFIXES = new Set(['PRIMARY', 'UNIQUE', 'KEY', 'CONSTRAINT', 'FOREIGN', 'INDEX']);
  const columnNames = [...body.matchAll(/^\s{2}(\w+) /gm)].map((m) => m[1]).filter((name) => !RESERVED_LINE_PREFIXES.has(name));
  const approved = new Set([
    'notification_id', 'account_ref', 'event_type', 'dedupe_key', 'resource_ref', 'message_key', 'params_json',
    'created_at', 'read_at', 'acknowledged_at',
  ]);
  for (const column of columnNames) {
    assert.ok(approved.has(column), `unexpected column on commercial_notifications: ${column}`);
  }
});

test('commercial-notifications migration shares no foreign key with any other plane table (family or billing) -- the account_ref scoping column is deliberately opaque, mirroring billing_core (constraint: data minimization)', () => {
  // Strip `--` comments first: this migration's own header PROSE
  // legitimately names "FOREIGN KEY"/"REFERENCES" to explain why the table
  // does NOT use one -- this assertion is about actual executable DDL,
  // never about the prose that documents the boundary (mirroring migration
  // 0007's own identical pattern in test/billing/schemaPrivacy.test.mjs).
  const ddl = migration.replace(/--[^\n]*/g, '');
  assert.equal(/FOREIGN KEY/i.test(ddl), false, 'commercial_notifications must not carry a FOREIGN KEY');
  assert.equal(/REFERENCES /i.test(ddl), false, 'commercial_notifications must not carry a REFERENCES clause');
});

test('event_type CHECK constraint enumerates exactly the 6 required events, nothing more', () => {
  const match = migration.match(/commercial_notifications_event_type_check CHECK \(\s*event_type IN \(([^)]*)\)/);
  assert.ok(match, 'event_type CHECK constraint not found');
  const values = match[1].split(',').map((v) => v.trim().replace(/^'|'$/g, ''));
  assert.deepEqual(
    values.sort(),
    ['ENTITLEMENT_INCREASED', 'PAYMENT_CONFIRMED', 'PAYMENT_FAILED', 'QUOTE_EXPIRED', 'QUOTE_READY', 'REQUEST_DENIED'].sort(),
  );
});

test('dedupe_key carries a UNIQUE KEY (the sole idempotency primitive)', () => {
  assert.match(migration, /UNIQUE KEY commercial_notifications_dedupe_key \(dedupe_key\)/);
});
