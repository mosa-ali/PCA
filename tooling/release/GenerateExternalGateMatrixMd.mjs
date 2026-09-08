// Regenerates docs/release_readiness/EXTERNAL_GATE_MATRIX.md from the
// authoritative docs/release_readiness/external_gate_matrix.json.
//
// Added by the 2026-09-08 final assessment: the markdown used to be a
// hand-maintained table of "the original 7" gates while the JSON held 37+
// -- 30 gates short on the surface most humans open. It is now derived.
// `--check` regenerates in memory and exits 1 if the committed markdown is
// stale (wired into the release-control CI job next to the ledger check).
//
// Usage: node tooling/release/GenerateExternalGateMatrixMd.mjs [--check]
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url)).replace(/[\\/]$/, '');
const jsonPath = join(repoRoot, 'docs', 'release_readiness', 'external_gate_matrix.json');
const mdPath = join(repoRoot, 'docs', 'release_readiness', 'EXTERNAL_GATE_MATRIX.md');
const CHECK = process.argv.includes('--check');

const matrix = JSON.parse(readFileSync(jsonPath, 'utf8'));
const targets = matrix.releaseTargets;
const cell = (value) => String(value ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

const lines = [];
lines.push('# External Gate Matrix (PCA-18/19)');
lines.push('');
lines.push('**GENERATED FILE -- do not edit by hand.** Regenerate with');
lines.push('`node tooling/release/GenerateExternalGateMatrixMd.mjs` after any change to');
lines.push('[`external_gate_matrix.json`](./external_gate_matrix.json), which remains the');
lines.push('only authority `tooling/release/Invoke-ReleaseGateCheck.ps1` reads. The CI');
lines.push('release-control job runs this generator with `--check` and fails if this');
lines.push('file is stale. (Until 2026-09-08 this page listed only the original seven');
lines.push('gates while the JSON held far more; it is now derived.)');
lines.push('');
lines.push('These are gates this repository-editing lane cannot close by writing code');
lines.push('or docs -- each requires a real human decision, real hardware, a real');
lines.push('provider, or a real external review outside the source tree.');
lines.push('');
lines.push(`Register state: **${matrix.gates.length} gates**, last updated ${cell(matrix.lastUpdatedUtc)}.`);
const closed = matrix.gates.filter((g) => g.status === 'CLOSED').length;
lines.push(`Closed: **${closed}**. Open (BLOCKED or EXTERNAL): **${matrix.gates.length - closed}**.`);
lines.push('');
lines.push('Legend per release target: **HARD** = the gate is in the target\'s `releaseScope` and');
lines.push('blocks that target\'s base release while open; *cond* = in `conditionalReleaseScope`');
lines.push('(a real, feature-scoped dependency surfaced separately, never a base-release blocker);');
lines.push('blank = the gate does not apply to that target.');
lines.push('');
lines.push(`| Gate ID | Status | ${targets.join(' | ')} | Owner | What it covers |`);
lines.push(`|---|---|${targets.map(() => '---').join('|')}|---|---|`);
for (const gate of matrix.gates) {
  const scope = targets.map((t) => (gate.releaseScope.includes(t) ? '**HARD**' : gate.conditionalReleaseScope.includes(t) ? '*cond*' : ''));
  lines.push(`| \`${gate.id}\` | ${gate.status} | ${scope.join(' | ')} | ${cell(gate.owner)} | ${cell(gate.description)} |`);
}
lines.push('');
lines.push('## Per-target hard blockers (derived)');
lines.push('');
for (const t of targets) {
  const hard = matrix.gates.filter((g) => g.releaseScope.includes(t) && g.status !== 'CLOSED').map((g) => `\`${g.id}\``);
  const cond = matrix.gates.filter((g) => g.conditionalReleaseScope.includes(t) && g.status !== 'CLOSED').map((g) => `\`${g.id}\``);
  lines.push(`- **${t}** -- ${hard.length} hard: ${hard.join(', ') || 'none'}${cond.length ? `; ${cond.length} conditional: ${cond.join(', ')}` : ''}.`);
  lines.push('  Plus the two source-derived signals the gate script evaluates before this register: `PRODUCTION_CRYPTO_SUITE` (from `backend/src/main.ts`; scoped to PARENT_C/ANDROID_D/IOS_FUTURE) and `REAL_UAT` (from `uat_execution_log.json`; scoped per target, and structurally unsatisfiable for PUBLIC_A/IOS_FUTURE/BILLING_FUTURE until the owner decides how those targets satisfy it).');
}
lines.push('');
lines.push('## Rule');
lines.push('');
lines.push('No agent, script, or lane may set any of these to CLOSED. They are closed only');
lines.push('by the accountable human owner named in `external_gate_matrix.json`, with an');
lines.push('evidence reference filled into that file\'s `evidence` field.');
lines.push('`tooling/release/Invoke-ReleaseGateCheck.ps1` treats any status other than');
lines.push('`CLOSED` as a HARD blocker only for release target(s) named in that gate\'s own');
lines.push('`releaseScope` array; a target named only in `conditionalReleaseScope` is');
lines.push('surfaced as a real but non-hard dependency, and a target named in neither');
lines.push('array is unaffected by that gate entirely.');
lines.push('');
const output = lines.join('\n');

if (CHECK) {
  let current = null;
  try { current = readFileSync(mdPath, 'utf8'); } catch { /* missing counts as stale */ }
  if (current !== output) {
    console.error('EXTERNAL_GATE_MATRIX.md is stale relative to external_gate_matrix.json -- run `node tooling/release/GenerateExternalGateMatrixMd.mjs` and commit.');
    process.exit(1);
  }
  console.log('EXTERNAL_GATE_MATRIX.md: OK (matches external_gate_matrix.json)');
} else {
  writeFileSync(mdPath, output, 'utf8');
  console.log(`EXTERNAL_GATE_MATRIX.md regenerated: ${matrix.gates.length} gates`);
}
