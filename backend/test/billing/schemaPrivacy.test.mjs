// Static (no-DB) privacy/security gate over migrations/0007_billing_core.sql
// -- fast enough to run in the default `npm test` pipeline, mirroring
// backend/test/schema-privacy.test.mjs's pattern for prior migrations
// (constraint 27: extend this repo's existing schema-privacy test
// discipline to cover every new billing table/type). The live-database
// counterpart is backend/test/db/billingCoreSchemaPrivacy.mysql.test.mjs.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migration = await readFile(new URL('../../migrations/0007_billing_core.sql', import.meta.url), 'utf8');

const REQUIRED_TABLES = [
  'billing_currencies',
  'billing_commercial_markets',
  'billing_country_market_rules',
  'billing_price_books',
  'billing_quotes',
  'billing_plans',
  'billing_subscriptions',
  'billing_payment_methods',
  'billing_invoices',
  'billing_invoice_lines',
  'billing_payment_attempts',
  'billing_payment_transactions',
  'billing_refunds',
  'billing_disputes',
  'billing_provider_events',
];

test('billing-core migration contains exactly the approved 15 Billing tables', () => {
  for (const table of REQUIRED_TABLES) assert.match(migration, new RegExp(`CREATE TABLE ${table} \\(`));
  const createCount = (migration.match(/CREATE TABLE /g) ?? []).length;
  assert.equal(createCount, REQUIRED_TABLES.length, 'unexpected extra CREATE TABLE statement in migration 0007');
});

// General family-monitoring privacy term list, mirroring
// backend/test/schema-privacy.test.mjs's prohibitedTerms (doc 09 Section
// 5.2 data classes) -- PCA-ADD-BILL-016.
const PROHIBITED_PRIVACY_TERMS = [
  'url', 'title', 'search', 'location', 'usage', 'policy', 'pin', 'private_key', 'fdek', 'recovery_secret', 'camera', 'face',
  'youtube', 'domain', 'history', 'browser', 'latitude', 'longitude', 'geolocation', 'screen_time', 'app_name', 'bundle_id',
  'package_name', 'keyword', 'ip_address',
];

test('billing-core migration does not introduce any family-activity/policy/privacy-prohibited field (PCA-ADD-BILL-016)', () => {
  const schema = migration.replace(/--[^\n]*/g, '').toLowerCase();
  // 'title' is excluded from the direct substring scan only: it is a
  // substring false-positive of this migration's legitimate
  // `entitlement_treatment` column / `ENTITLEMENT_REDUCTION_PENDING` value
  // ("en-TITLE-ment"), mirroring migration 0005's own identical, reviewed
  // exclusion for the same reason. Asserted separately below that no
  // genuine "title" term exists outside that false positive.
  const termsToScan = PROHIBITED_PRIVACY_TERMS.filter((term) => term !== 'title');
  for (const term of termsToScan) assert.equal(schema.includes(term), false, `prohibited schema term: ${term}`);
  assert.doesNotMatch(schema.replace(/entitlement/g, ''), /title/, 'no genuine "title" term outside the "entitlement" false-positive');
});

// Payment-security-specific prohibited terms (PCA-ADD-BILL-023/024, constraint 20/27).
const PROHIBITED_PAYMENT_SECURITY_TERMS = [
  'card_number', 'pan', 'cvv', 'cvc', 'cvv2', 'card_verification', 'magnetic', 'track_data', 'chip_data',
  'account_number', 'routing_number', 'api_key', 'api_secret', 'client_secret', 'private_key',
];

test('billing-core migration introduces no column capable of storing a full PAN, CVV/CVC, raw card/bank credential, or unredacted provider secret', () => {
  const schema = migration.replace(/--[^\n]*/g, '').toLowerCase();
  for (const term of PROHIBITED_PAYMENT_SECURITY_TERMS) assert.equal(schema.includes(term), false, `prohibited payment-security term: ${term}`);
});

test('billing_payment_methods carries only provider-safe, display-safe columns -- exactly the approved column set, nothing more', () => {
  const match = migration.match(/CREATE TABLE billing_payment_methods \(([\s\S]*?)\) ENGINE=InnoDB;/);
  assert.ok(match, 'billing_payment_methods table definition not found');
  const body = match[1];
  const RESERVED_LINE_PREFIXES = new Set(['PRIMARY', 'UNIQUE', 'KEY', 'CONSTRAINT', 'FOREIGN', 'INDEX']);
  const columnNames = [...body.matchAll(/^\s{2}(\w+) /gm)].map((m) => m[1]).filter((name) => !RESERVED_LINE_PREFIXES.has(name));
  const approved = new Set([
    'payment_method_id', 'account_ref', 'provider', 'provider_payment_method_ref', 'brand', 'display_label', 'last4',
    'expiry_month', 'expiry_year', 'status', 'created_at',
  ]);
  for (const column of columnNames) {
    assert.ok(approved.has(column), `unexpected column on billing_payment_methods: ${column}`);
  }
});

test('billing_price_books never seeds a real price literal (no INSERT statement targets billing_price_books)', () => {
  assert.equal(/INSERT INTO billing_price_books/i.test(migration), false, 'migration must not seed illustrative/example prices');
});

test('billing-core migration shares no foreign key with the family/parent plane tables (service_accounts, service_sessions, families, devices)', () => {
  const familyPlaneTables = ['service_accounts', 'service_sessions', 'families', 'licenses', 'devices'];
  for (const table of familyPlaneTables) {
    assert.equal(new RegExp(`REFERENCES ${table} \\(`).test(migration), false, `unexpected FK to family-plane table: ${table}`);
  }
});

test('billing-core migration never references migration 0006 or any entitlement table as executable DDL (lane boundary, constraint 13)', () => {
  // Strip `--` comments first: this migration's own header PROSE legitimately
  // names migration 0006 to explain why it does NOT depend on it -- this
  // assertion is about actual executable DDL (FOREIGN KEY/REFERENCES/CREATE
  // TABLE), never about the prose that documents the boundary.
  const executableSql = migration.replace(/--[^\n]*/g, '');
  assert.equal(/entitlement_change_request|platform_entitlements|managed_device_limit_request/i.test(executableSql), false);
  assert.equal(/0006_platform_entitlements_enrollment_limits/.test(executableSql), false);
});

test('billing-core migration defines no triggers', () => {
  const executableSql = migration.replace(/--[^\n]*/g, '');
  assert.equal(/CREATE TRIGGER/i.test(executableSql), false);
});

test('increase_request_ref columns are bounded opaque VARCHAR, never a foreign key', () => {
  const refColumnLines = migration.match(/^\s*increase_request_ref VARCHAR\(64\) NULL,?\s*$/gm) ?? [];
  assert.ok(refColumnLines.length >= 2, 'expected increase_request_ref on both billing_quotes and billing_payment_attempts');
  assert.equal(/FOREIGN KEY \(increase_request_ref\)/i.test(migration), false);
});

test('every money-bearing table carries an explicit BIGINT amount column alongside an explicit currency_code (PCA-ADD-BILL-015/017)', () => {
  const moneyBearingTables = {
    billing_price_books: 'amount_minor',
    billing_quotes: 'amount_minor',
    billing_invoices: 'total_amount_minor',
    billing_invoice_lines: 'amount_minor',
    billing_payment_attempts: 'amount_minor',
    billing_payment_transactions: 'amount_minor',
    billing_refunds: 'amount_minor',
  };
  for (const [table, amountColumn] of Object.entries(moneyBearingTables)) {
    const match = migration.match(new RegExp(`CREATE TABLE ${table} \\(([\\s\\S]*?)\\) ENGINE=InnoDB;`));
    assert.ok(match, `${table} not found`);
    const body = match[1];
    assert.match(body, new RegExp(`${amountColumn} BIGINT NOT NULL`), `${table}.${amountColumn} must be BIGINT NOT NULL`);
    assert.match(body, /currency_code CHAR\(3\)/, `${table}.currency_code must be present`);
  }
});
