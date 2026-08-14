// PCA-BILL-2A-R1 correction -- static (no-DB) privacy/security gate over
// migrations/0008_payment_orchestration.sql, mirroring
// backend/test/billing/schemaPrivacy.test.mjs's exact discipline for
// migration 0007 (constraint: extend this repo's existing schema-privacy
// test coverage to cover the new billing_refund_operations table).
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migration = await readFile(new URL('../../migrations/0008_payment_orchestration.sql', import.meta.url), 'utf8');

test('payment-orchestration migration contains exactly one new table: billing_refund_operations', () => {
  assert.match(migration, /CREATE TABLE billing_refund_operations \(/);
  const createCount = (migration.match(/CREATE TABLE /g) ?? []).length;
  assert.equal(createCount, 1, 'unexpected extra CREATE TABLE statement in migration 0008');
});

test('payment-orchestration migration defines no triggers', () => {
  const executableSql = migration.replace(/--[^\n]*/g, '');
  assert.equal(/CREATE TRIGGER/i.test(executableSql), false);
});

// Same general family-monitoring privacy term list as
// backend/test/billing/schemaPrivacy.test.mjs (doc 09 Section 5.2 data
// classes, PCA-ADD-BILL-016).
const PROHIBITED_PRIVACY_TERMS = [
  'url', 'title', 'search', 'location', 'usage', 'policy', 'pin', 'private_key', 'fdek', 'recovery_secret', 'camera', 'face',
  'youtube', 'domain', 'history', 'browser', 'latitude', 'longitude', 'geolocation', 'screen_time', 'app_name', 'bundle_id',
  'package_name', 'keyword', 'ip_address',
];

test('payment-orchestration migration does not introduce any family-activity/policy/privacy-prohibited field', () => {
  const schema = migration.replace(/--[^\n]*/g, '').toLowerCase();
  for (const term of PROHIBITED_PRIVACY_TERMS) assert.equal(schema.includes(term), false, `prohibited schema term: ${term}`);
});

// Payment-security-specific prohibited terms (PCA-ADD-BILL-023/024) --
// billing_refund_operations must carry no PAN/CVV/raw-credential/secret
// column, exactly like billing_refunds/billing_payment_methods.
const PROHIBITED_PAYMENT_SECURITY_TERMS = [
  'card_number', 'pan', 'cvv', 'cvc', 'cvv2', 'card_verification', 'magnetic', 'track_data', 'chip_data',
  'account_number', 'routing_number', 'api_key', 'api_secret', 'client_secret', 'private_key',
];

test('payment-orchestration migration introduces no column capable of storing a full PAN, CVV/CVC, raw card/bank credential, or unredacted provider secret', () => {
  const schema = migration.replace(/--[^\n]*/g, '').toLowerCase();
  for (const term of PROHIBITED_PAYMENT_SECURITY_TERMS) assert.equal(schema.includes(term), false, `prohibited payment-security term: ${term}`);
});

test('billing_refund_operations carries only the approved column set, nothing more', () => {
  const match = migration.match(/CREATE TABLE billing_refund_operations \(([\s\S]*?)\) ENGINE=InnoDB;/);
  assert.ok(match, 'billing_refund_operations table definition not found');
  const body = match[1];
  const RESERVED_LINE_PREFIXES = new Set(['PRIMARY', 'UNIQUE', 'KEY', 'CONSTRAINT', 'FOREIGN', 'INDEX']);
  const columnNames = [...body.matchAll(/^\s{2}(\w+) /gm)].map((m) => m[1]).filter((name) => !RESERVED_LINE_PREFIXES.has(name));
  const approved = new Set([
    'refund_operation_id', 'payment_transaction_id', 'amount_minor', 'currency_code', 'reason_code', 'reason_note',
    'initiated_by_admin_id', 'step_up_session_id', 'provider', 'idempotency_key', 'provider_refund_ref', 'state',
    'refund_id', 'created_at', 'updated_at',
  ]);
  for (const column of columnNames) {
    assert.ok(approved.has(column), `unexpected column on billing_refund_operations: ${column}`);
  }
  assert.equal(columnNames.length, approved.size, 'every approved column must actually be present');
});

test('billing_refund_operations.idempotency_key is UNIQUE (the sole concurrency/retry-recognition primitive, mirroring billing_provider_events)', () => {
  assert.match(migration, /UNIQUE KEY billing_refund_operations_idempotency_key \(idempotency_key\)/);
});

test('billing_refund_operations carries an explicit BIGINT amount column alongside an explicit currency_code (PCA-ADD-BILL-015/017)', () => {
  const match = migration.match(/CREATE TABLE billing_refund_operations \(([\s\S]*?)\) ENGINE=InnoDB;/);
  const body = match[1];
  assert.match(body, /amount_minor BIGINT NOT NULL/);
  assert.match(body, /currency_code CHAR\(3\)/);
});

test('billing_refund_operations.state column is wide enough for every closed-vocabulary value (PROVIDER_CONFIRMED = 18 chars)', () => {
  const match = migration.match(/CREATE TABLE billing_refund_operations \(([\s\S]*?)\) ENGINE=InnoDB;/);
  const body = match[1];
  assert.match(body, /state VARCHAR\((\d+)\) NOT NULL/);
  const widthMatch = body.match(/state VARCHAR\((\d+)\) NOT NULL/);
  const width = Number(widthMatch[1]);
  assert.ok(width >= 'PROVIDER_CONFIRMED'.length, `state column width ${width} must be >= ${'PROVIDER_CONFIRMED'.length}`);
});

test('billing_refund_operations.state is a closed CHECK-constrained vocabulary', () => {
  assert.match(migration, /CONSTRAINT billing_refund_operations_state_check CHECK \(state IN \('CREATED', 'PROVIDER_CONFIRMED', 'FINALIZED', 'FAILED'\)\)/);
});

test('payment-orchestration migration never alters an existing (0001-0007) table -- no ALTER TABLE statement', () => {
  const executableSql = migration.replace(/--[^\n]*/g, '');
  assert.equal(/ALTER TABLE/i.test(executableSql), false);
});
