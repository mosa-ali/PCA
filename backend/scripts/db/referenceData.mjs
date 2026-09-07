// THE single authoritative definition of PCA's production reference data.
//
// These are the lookup/config rows whose CREATE TABLE is immediately followed
// by an INSERT in their defining migration (backend/migrations/0006 and 0007).
// They are NOT test or demo content: the application cannot function without
// them -- every billing_payment_attempts row carries a currency_code foreign
// key into billing_currencies, and entitlement provisioning reads the
// FREE_STARTER row out of entitlement_defaults.
//
// WHY THIS MODULE EXISTS. These rows used to be inline string literals inside
// generate-bootstrap-reference-data.mjs, which meant only ONE of the two
// bootstrap generators knew about them. The disposable bootstrap artifact
// (generate-disposable-bootstrap.mjs) emitted schema and the migration journal
// but no reference data, so a database created from it was schema-identical to
// a migrated one and yet missing 14 rows across 4 tables. The schema
// fingerprint could not see that -- it compares DDL -- so the artifact passed
// every equivalence check while 105 of the 532 DB-backed tests failed against
// it with foreign-key violations and "entitlement_defaults row missing for
// tier FREE_STARTER".
//
// Both generators and the data-aware validation now read this module, so the
// rows are defined exactly once. Adding a table here propagates to every
// consumer; forgetting to is what the regression test catches.
//
// ORDERING IS SIGNIFICANT and must stay foreign-key-safe: billing_currencies
// before billing_commercial_markets (which references it), which comes before
// billing_country_market_rules (which references that).

/** Marks a value that must be emitted as raw SQL rather than a quoted literal. */
export const raw = (sql) => ({ __raw: sql });

/**
 * Ordered, FK-safe reference data. `source` names the migration these rows
 * were read from, and is what generate-bootstrap-reference-data.mjs groups its
 * output sections by.
 */
export const PCA_REFERENCE_DATA = [
  {
    table: 'billing_currencies',
    source: 'backend/migrations/0007_billing_core.sql',
    columns: ['currency_code', 'minor_unit_exponent', 'enabled'],
    rows: [
      ['USD', 2, 1],
      ['SAR', 2, 1],
      ['YER', 2, 1],
    ],
  },
  {
    table: 'billing_commercial_markets',
    source: 'backend/migrations/0007_billing_core.sql',
    columns: ['commercial_market', 'default_currency_code'],
    rows: [
      ['YEMEN', 'YER'],
      ['GULF', 'SAR'],
      ['GLOBAL_OTHER', 'USD'],
    ],
  },
  {
    table: 'billing_country_market_rules',
    source: 'backend/migrations/0007_billing_core.sql',
    columns: ['country_code', 'commercial_market'],
    rows: [
      ['YE', 'YEMEN'],
      ['SA', 'GULF'],
      ['AE', 'GULF'],
      ['QA', 'GULF'],
      ['KW', 'GULF'],
      ['BH', 'GULF'],
      ['OM', 'GULF'],
    ],
  },
  {
    table: 'entitlement_defaults',
    source: 'backend/migrations/0006_platform_entitlements_enrollment_limits.sql',
    columns: ['tier', 'parent_member_limit', 'managed_device_limit', 'updated_at', 'updated_by_admin_id'],
    rows: [['FREE_STARTER', 1, 1, raw('CURRENT_TIMESTAMP(3)'), null]],
  },
];

/** Total reference rows across every table -- used by the data-aware checks. */
export const referenceRowCount = () => PCA_REFERENCE_DATA.reduce((n, t) => n + t.rows.length, 0);

function literal(value) {
  if (value === null) return 'NULL';
  if (typeof value === 'object' && value !== null && '__raw' in value) return value.__raw;
  if (typeof value === 'number') return String(value);
  return `'${String(value).replace(/'/g, "''")}'`;
}

/**
 * Renders one table's INSERT exactly as both bootstrap artifacts carry it.
 * Deterministic: same input, byte-identical output, every time.
 */
export function renderInsert({ table, columns, rows }) {
  const cols = columns.map((c) => `\`${c}\``).join(', ');
  const values = rows.map((row) => `  (${row.map(literal).join(', ')})`).join(',\n');
  return `INSERT INTO \`${table}\` (${cols}) VALUES\n${values};`;
}

/**
 * The columns that carry a stable, comparable value. `updated_at` is
 * CURRENT_TIMESTAMP(3) at insert time, so it differs between any two databases
 * and is deliberately excluded from equality checks -- comparing it would make
 * a correct bootstrap look wrong.
 */
export const comparableColumns = ({ columns, rows }) =>
  columns.filter((_, i) => !rows.some((row) => typeof row[i] === 'object' && row[i] !== null && '__raw' in row[i]));
