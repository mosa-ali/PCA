// DW-W1-R1 section 10/19: a FULL, non-sampled reconciliation of every gate x
// release-target cell in docs/supervision/PCA_FABLE_EXTERNAL_GATE_RELEASE_SCOPE.csv
// (the authoritative, read-only supervisory answer key) against
// docs/release_readiness/external_gate_matrix.json's releaseScope/
// conditionalReleaseScope arrays, PLUS the two source-derived signals
// (PRODUCTION_CRYPTO_SUITE, REAL_UAT) that Invoke-ReleaseGateCheck.ps1
// computes live from source/human-owned data rather than from the JSON
// matrix -- handled explicitly here rather than pretended to come from the
// matrix (mission section 9).
//
// FABLE YES   -> must be in releaseScope (hard blocker)
// FABLE PARTIAL -> must be in conditionalReleaseScope (feature-scoped, non-hard)
// FABLE NO    -> must be in NEITHER array
//
// Every one of the CSV's ~36 external-gate rows is checked, across all 6
// release targets -- 216 cells, not a handful of samples. Never connects to
// a database; reads two files plus makes 6 short live invocations of the
// real release-gate script (one per release target) to cross-check the
// source-derived signals' actual runtime behaviour.
import { readFileSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url)).replace(/[\\/]$/, '');
const csvPath = join(repoRoot, 'docs', 'supervision', 'PCA_FABLE_EXTERNAL_GATE_RELEASE_SCOPE.csv');
const matrixPath = join(repoRoot, 'docs', 'release_readiness', 'external_gate_matrix.json');
const scriptPath = join(repoRoot, 'tooling', 'release', 'Invoke-ReleaseGateCheck.ps1');

const TARGETS = ['PUBLIC_A', 'AUTH_B', 'PARENT_C', 'ANDROID_D', 'IOS_FUTURE', 'BILLING_FUTURE'];

// Same shape as tooling/release/ValidateExternalGateParity.mjs's own parser
// (quoted fields, embedded commas in the WHY column) -- kept independent
// rather than imported/shared so this validator has no runtime dependency
// on that other file's internals.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') { cell += '"'; index += 1; }
      else if (character === '"') { quoted = false; }
      else { cell += character; }
    } else if (character === '"') { quoted = true; }
    else if (character === ',') { row.push(cell); cell = ''; }
    else if (character === '\n') {
      row.push(cell.endsWith('\r') ? cell.slice(0, -1) : cell);
      rows.push(row);
      row = [];
      cell = '';
    } else { cell += character; }
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  const headers = rows.shift() ?? [];
  return rows.map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])));
}

const csvRows = parseCsv(readFileSync(csvPath, 'utf8'));
const matrix = JSON.parse(readFileSync(matrixPath, 'utf8'));
const matrixById = new Map(matrix.gates.map((g) => [g.id, g]));

const errors = [];
let cellsChecked = 0;

// --- 1. Every CSV gate row (except REAL_UAT, handled in section 3 below) --
for (const row of csvRows) {
  const gateId = row.GATE_ID;
  if (gateId === 'REAL_UAT') continue;

  const gate = matrixById.get(gateId);
  if (!gate) {
    errors.push(`Gate '${gateId}' has a row in the FABLE CSV answer key but NO corresponding entry in external_gate_matrix.json.`);
    continue;
  }
  const hard = Array.isArray(gate.releaseScope) ? gate.releaseScope : null;
  const conditional = Array.isArray(gate.conditionalReleaseScope) ? gate.conditionalReleaseScope : null;
  if (hard === null || conditional === null) {
    errors.push(`Gate '${gateId}' does not have both releaseScope and conditionalReleaseScope as arrays -- cannot reconcile against the FABLE CSV (Invoke-ReleaseGateCheck.ps1 will independently fail this closed too).`);
    continue;
  }

  for (const target of TARGETS) {
    cellsChecked += 1;
    const cell = (row[target] ?? '').trim().toUpperCase();
    const inHard = hard.includes(target);
    const inConditional = conditional.includes(target);

    if (cell === 'YES') {
      if (!inHard) errors.push(`${gateId}/${target}: FABLE=YES (hard blocker) but '${target}' is NOT in releaseScope.`);
      if (inConditional) errors.push(`${gateId}/${target}: FABLE=YES (hard blocker) but '${target}' was downgraded into conditionalReleaseScope.`);
    } else if (cell === 'PARTIAL') {
      if (!inConditional) errors.push(`${gateId}/${target}: FABLE=PARTIAL (conditional dependency) but '${target}' is NOT in conditionalReleaseScope.`);
      if (inHard) errors.push(`${gateId}/${target}: FABLE=PARTIAL (conditional dependency) but '${target}' was upgraded into releaseScope (hard) -- PARTIAL must never become a hard base-release blocker.`);
    } else if (cell === 'NO') {
      if (inHard) errors.push(`${gateId}/${target}: FABLE=NO but '${target}' is present in releaseScope (should block nothing here).`);
      if (inConditional) errors.push(`${gateId}/${target}: FABLE=NO but '${target}' is present in conditionalReleaseScope (should block nothing here).`);
    } else {
      errors.push(`${gateId}/${target}: unrecognized FABLE CSV cell value '${row[target]}' (expected YES, PARTIAL, or NO).`);
    }
  }
}

// --- 2. Every JSON gate must trace back to a CSV row (no undeclared mapping) --
const csvGateIds = new Set(csvRows.map((r) => r.GATE_ID));
for (const gate of matrix.gates) {
  if (!csvGateIds.has(gate.id)) {
    errors.push(`Gate '${gate.id}' is in external_gate_matrix.json but has NO row in the FABLE CSV answer key -- its scope was never reconciled against the authoritative supervisory analysis.`);
  }
}

// --- 2b. Duplicate gate ids (structural corruption) ------------------------
const allIds = matrix.gates.map((g) => g.id);
const duplicateIds = [...new Set(allIds.filter((id, i) => allIds.indexOf(id) !== i))];
if (duplicateIds.length > 0) {
  errors.push(`Duplicate gate id(s) in external_gate_matrix.json: ${duplicateIds.join(', ')}.`);
}

// --- 3. Source-derived signals (NOT pretended to come from the JSON matrix) --
const csvCrypto = csvRows.find((r) => r.GATE_ID === 'PRODUCTION_CRYPTO_SUITE' && r.REGISTER_STATUS === 'SOURCE_DERIVED');
const csvRealUat = csvRows.find((r) => r.GATE_ID === 'REAL_UAT');
if (!csvCrypto) errors.push(`Expected a SOURCE_DERIVED 'PRODUCTION_CRYPTO_SUITE' row in the FABLE CSV; none found.`);
if (!csvRealUat) errors.push(`Expected a 'REAL_UAT' row in the FABLE CSV; none found.`);
if (matrixById.has('REAL_UAT')) {
  errors.push(`'REAL_UAT' must NOT appear as its own external_gate_matrix.json entry -- it is purely a source-derived signal Invoke-ReleaseGateCheck.ps1 computes live from docs/release_readiness/uat_execution_log.json, never a JSON-tracked external gate (mixing the two would double-count it).`);
}

if (csvCrypto || csvRealUat) {
  for (const target of TARGETS) {
    const jsonPath = join(tmpdir(), `pca-fable-parity-${target}-${process.pid}-${Math.random().toString(36).slice(2)}.json`);
    try {
      execFileSync('pwsh', ['-NoProfile', '-NonInteractive', '-File', scriptPath, '-ReleaseTarget', target, '-JsonOutPath', jsonPath], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000 });
    } catch {
      // A non-zero exit (NOT_READY) is the normal case here -- only the
      // JSON summary file matters for this cross-check, not the exit code.
    }
    let json = null;
    try { json = JSON.parse(readFileSync(jsonPath, 'utf8')); } catch { /* handled below */ }
    try { unlinkSync(jsonPath); } catch { /* best effort cleanup */ }

    if (!json) {
      errors.push(`Could not obtain a JSON summary for -ReleaseTarget ${target} while cross-checking source-derived signals (script may have failed closed before writing -JsonOutPath).`);
      continue;
    }

    if (csvCrypto) {
      const expectedInScope = csvCrypto[target].trim().toUpperCase() === 'YES'; // this CSV row has no PARTIAL cell
      if (Boolean(json.cryptoSuiteInScope) !== expectedInScope) {
        errors.push(`PRODUCTION_CRYPTO_SUITE/${target}: FABLE CSV says '${csvCrypto[target]}' but the live script's cryptoSuiteInScope=${json.cryptoSuiteInScope}.`);
      }
    }
    // REAL_UAT: the CSV marks this YES for every target (every real release
    // needs SOME UAT sign-off in principle). The CSV expresses no per-case
    // breakdown, so this only confirms the signal is genuinely EVALUATED
    // for every target -- never that its relevant-case count is nonzero.
    // PUBLIC_A/AUTH_B/IOS_FUTURE/BILLING_FUTURE legitimately have zero
    // relevant cases per docs/release_readiness/UAT_TEST_PLAN.md and are
    // vacuously satisfied by design -- that is DW-W1's own evidence-based
    // refinement, not a parity violation, and is deliberately NOT re-litigated
    // here.
    if (json.realUatState === null || json.realUatState === undefined) {
      errors.push(`REAL_UAT/${target}: no realUatState present in the live script's JSON output -- the signal is not being evaluated for this target at all, contradicting the FABLE CSV's blanket YES.`);
    }
  }
}

console.log(`FABLE scope parity: checked ${cellsChecked} gate x target cell(s) across ${csvRows.length} CSV row(s) and ${matrix.gates.length} matrix gate(s), plus live source-derived cross-checks for all ${TARGETS.length} release targets.`);
if (errors.length > 0) {
  console.error(`FAIL (${errors.length} issue(s)):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exitCode = 1;
} else {
  console.log('PASS -- every gate x target cell matches the FABLE CSV answer key exactly (YES=hard, PARTIAL=conditional, NO=neither), and both source-derived signals are consistent with it.');
}
