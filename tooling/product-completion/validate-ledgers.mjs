// Structural validator for the product-completion CSV artifacts
// (PCA_PAGE_AUDIT.csv, PCA_PAGE_QA_LEDGER.csv, PCA_P0_DISPOSITION.csv,
// PCA_P1_DISPOSITION.csv, PCA_P2_DISPOSITION.csv).
//
// Exists because the Stage-0 audit CSV shipped with unquoted commas inside
// several free-text field values, silently shifting every later column in
// those rows -- caught only by a later bulk update, not by inspection. This
// script is the replacement for "look at it and it seems fine": run it
// before every product-completion documentation commit.
import { readFile } from 'node:fs/promises';

const root = new URL('../../docs/product-completion/', import.meta.url);

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') {
      row.push(cell.endsWith('\r') ? cell.slice(0, -1) : cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

const VALID_PRIORITY = new Set(['P0', 'P1', 'P2', 'P3']);
const VALID_ACCEPTANCE_STATE = new Set([
  'NOT_TESTED', 'IMPLEMENTATION_IN_PROGRESS', 'AWAITING_BROWSER', 'DEFECT_FOUND',
  'REMEDIATION_IN_PROGRESS', 'RETEST_REQUIRED', 'BLOCKED_ENVIRONMENT', 'BLOCKED_EXTERNAL',
  'VERIFIED_BROWSER_PASS',
]);
const VALID_P0_DISPOSITION = new Set([
  'FIXED', 'FIXED_AWAITING_BROWSER', 'RECLASSIFIED_EXTERNAL_GATE', 'RECLASSIFIED_NOT_DEFECT',
  'PARTIAL_SOURCE_GAP', 'NOT_STARTED', 'BLOCKED_OWNER_DECISION', 'BLOCKED_ENVIRONMENT',
]);
const VALID_P1P2_DISPOSITION = new Set([
  'FIXED', 'FIXED_AWAITING_BROWSER', 'RECLASSIFIED_EXTERNAL_GATE', 'RECLASSIFIED_NOT_DEFECT',
  'PARTIAL', 'NOT_STARTED',
]);

const SPECS = {
  'PCA_PAGE_AUDIT.csv': {
    headers: ['APP', 'ROUTE', 'PAGE', 'WORKFLOW', 'CURRENT_STATUS', 'PRIMARY_GAP', 'SECONDARY_GAPS', 'BACKEND_STATUS', 'API_STATUS', 'TEST_STATUS', 'BROWSER_STATUS', 'EN_STATUS', 'AR_STATUS', 'RTL_STATUS', 'RESPONSIVE_STATUS', 'ACCESSIBILITY_STATUS', 'PRIORITY', 'WRITER', 'QA_STATUS', 'NOTES'],
    uniqueOn: ['APP', 'ROUTE'],
    enums: { PRIORITY: VALID_PRIORITY },
  },
  'PCA_PAGE_QA_LEDGER.csv': {
    headers: ['APP', 'ROUTE', 'PAGE', 'PERSONA', 'LANGUAGE', 'DIRECTION', 'VIEWPORT', 'DATA_SCENARIO', 'PAGE_LOAD', 'API_STATUS', 'CONSOLE_STATUS', 'FUNCTIONAL_STATUS', 'VISUAL_STATUS', 'UX_STATUS', 'RESPONSIVE_STATUS', 'ACCESSIBILITY_STATUS', 'RBAC_STATUS', 'EMPTY_STATE_STATUS', 'ERROR_STATE_STATUS', 'LOADING_STATE_STATUS', 'DEFECT_ID', 'SEVERITY', 'OWNER_WRITER', 'RETEST_STATUS', 'FINAL_STATUS', 'EVIDENCE'],
    uniqueOn: ['APP', 'ROUTE', 'PERSONA', 'LANGUAGE', 'VIEWPORT'],
    enums: { FINAL_STATUS: VALID_ACCEPTANCE_STATE },
  },
  'PCA_P0_DISPOSITION.csv': {
    headers: ['ROUTE', 'ORIGINAL_FINDING', 'CURRENT_DISPOSITION', 'FIX_COMMIT', 'SOURCE_STATUS', 'BROWSER_STATUS', 'EXTERNAL_GATE', 'REMAINING_WORK', 'FINAL_CLASSIFICATION'],
    uniqueOn: ['ROUTE'],
    enums: { CURRENT_DISPOSITION: VALID_P0_DISPOSITION },
    exactRowCount: 16,
    priority: 'P0',
  },
  'PCA_P1_DISPOSITION.csv': {
    headers: ['APP', 'ROUTE', 'PAGE', 'ORIGINAL_P1_FINDING', 'CURRENT_DISPOSITION', 'SOURCE_STATUS', 'FIX_COMMIT', 'BROWSER_STATUS', 'EXTERNAL_GATE', 'REMAINING_WORK', 'OWNER_WRITER', 'FINAL_NOTES'],
    uniqueOn: ['APP', 'ROUTE'],
    enums: { CURRENT_DISPOSITION: VALID_P1P2_DISPOSITION },
    exactRowCount: 20,
    priority: 'P1',
  },
  'PCA_P2_DISPOSITION.csv': {
    headers: ['APP', 'ROUTE', 'PAGE', 'ORIGINAL_P2_FINDING', 'CURRENT_DISPOSITION', 'SOURCE_STATUS', 'FIX_COMMIT', 'BROWSER_STATUS', 'EXTERNAL_GATE', 'REMAINING_WORK', 'OWNER_WRITER', 'FINAL_NOTES'],
    uniqueOn: ['APP', 'ROUTE'],
    enums: { CURRENT_DISPOSITION: VALID_P1P2_DISPOSITION },
    exactRowCount: 18,
    priority: 'P2',
  },
};

let ok = true;
function fail(msg) { ok = false; console.error(`FAIL: ${msg}`); }

// Populated per-file below, used afterward for the cross-file route-universe check.
const parsed = {};

for (const [filename, spec] of Object.entries(SPECS)) {
  let text;
  let fileOk = true;
  try {
    text = await readFile(new URL(filename, root), 'utf8');
  } catch (e) {
    fail(`${filename}: file not found (${e && e.message})`);
    continue;
  }
  const rows = parseCsv(text).filter((r) => !(r.length === 1 && r[0] === ''));
  const [header, ...dataRows] = rows;

  if (JSON.stringify(header) !== JSON.stringify(spec.headers)) {
    fail(`${filename}: header mismatch.\n  expected: ${spec.headers.join(',')}\n  actual:   ${(header ?? []).join(',')}`);
    continue;
  }

  const malformed = dataRows.filter((r) => r.length !== header.length);
  if (malformed.length) {
    fail(`${filename}: ${malformed.length} row(s) do not have exactly ${header.length} fields (unquoted comma or missing field) -- rows: ${malformed.map((r) => r[0]).join(' | ')}`);
    fileOk = false;
  }

  if (spec.exactRowCount !== undefined && dataRows.length !== spec.exactRowCount) {
    fail(`${filename}: expected exactly ${spec.exactRowCount} data rows, found ${dataRows.length}`);
    fileOk = false;
  }

  const wellFormed = dataRows.filter((r) => r.length === header.length);
  const idx = Object.fromEntries(header.map((h, i) => [h, i]));

  if (spec.uniqueOn) {
    const seen = new Map();
    for (const r of wellFormed) {
      const key = spec.uniqueOn.map((col) => r[idx[col]]).join(' ');
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
    const dupes = [...seen.entries()].filter(([, count]) => count > 1);
    if (dupes.length) {
      fail(`${filename}: duplicate rows on (${spec.uniqueOn.join('+')}): ${dupes.map(([k]) => k.replaceAll(' ', '/')).join(', ')}`);
      fileOk = false;
    }
  }

  if (spec.enums) {
    for (const [col, validSet] of Object.entries(spec.enums)) {
      for (const r of wellFormed) {
        const value = r[idx[col]];
        if (!validSet.has(value)) {
          fail(`${filename}: row "${r[0]}" has invalid ${col} = "${value}"`);
          fileOk = false;
        }
      }
    }
  }

  parsed[filename] = { header, idx, rows: wellFormed };
  if (fileOk) console.log(`PASS: ${filename} (${wellFormed.length} rows, ${header.length} columns)`);
}

// ---------------------------------------------------------------------
// Cross-file route-universe check: PCA_PAGE_AUDIT.csv's 62 rows are the
// one authoritative route list. P0/P1/P2 disposition tables must each
// cover EXACTLY the routes the audit assigned that priority -- no route
// silently dropped, duplicated, or promoted/demoted across priority
// tables without the audit itself being updated to match. The QA ledger
// must mention every one of the 62 routes at least once (routes tracked,
// not yet necessarily verified).
// ---------------------------------------------------------------------
if (parsed['PCA_PAGE_AUDIT.csv']) {
  const audit = parsed['PCA_PAGE_AUDIT.csv'];
  const auditKey = (r) => `${r[audit.idx.APP]} ${r[audit.idx.ROUTE]}`;
  const auditRouteUniverse = new Set(audit.rows.map(auditKey));
  if (auditRouteUniverse.size !== 62) {
    fail(`PCA_PAGE_AUDIT.csv: route universe has ${auditRouteUniverse.size} distinct (APP,ROUTE) pairs, expected exactly 62`);
  }

  const byPriority = { P0: new Set(), P1: new Set(), P2: new Set(), P3: new Set() };
  for (const r of audit.rows) {
    const p = r[audit.idx.PRIORITY];
    if (byPriority[p]) byPriority[p].add(auditKey(r));
  }

  for (const [filename, spec] of Object.entries(SPECS)) {
    if (!spec.priority || !parsed[filename]) continue;
    const p = parsed[filename];
    const isP0 = filename === 'PCA_P0_DISPOSITION.csv';
    const rowKey = (r) => (isP0 ? r[p.idx.ROUTE] : `${r[p.idx.APP]} ${r[p.idx.ROUTE]}`);
    const tableKeys = new Set(p.rows.map(rowKey));
    const expectedKeys = byPriority[spec.priority];
    const missing = [...expectedKeys].filter((k) => !tableKeys.has(k));
    const extra = [...tableKeys].filter((k) => !expectedKeys.has(k));
    if (missing.length) fail(`${filename}: missing ${missing.length} route(s) present in PCA_PAGE_AUDIT.csv as ${spec.priority}: ${missing.join(', ')}`);
    if (extra.length) fail(`${filename}: ${extra.length} route(s) not marked ${spec.priority} in PCA_PAGE_AUDIT.csv: ${extra.join(', ')}`);
  }

  if (parsed['PCA_PAGE_QA_LEDGER.csv']) {
    const ledger = parsed['PCA_PAGE_QA_LEDGER.csv'];
    const ledgerKeys = new Set(ledger.rows.map((r) => `${r[ledger.idx.APP]} ${r[ledger.idx.ROUTE]}`));
    const missingFromLedger = [...auditRouteUniverse].filter((k) => !ledgerKeys.has(k));
    if (missingFromLedger.length) {
      fail(`PCA_PAGE_QA_LEDGER.csv: ${missingFromLedger.length} route(s) from the audit's 62-route universe have no row at all: ${missingFromLedger.join(', ')}`);
    }
  }

  if (ok) console.log(`PASS: route universe (62/62), P0/P1/P2 tables match PCA_PAGE_AUDIT.csv's priority assignments exactly`);
}

if (!ok) process.exitCode = 1;
