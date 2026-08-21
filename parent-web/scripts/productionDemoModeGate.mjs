// PRODUCTION_DEMO_MODE_GATE (Prompt-1 audit follow-up).
//
// Proves that THIS app's actual, resolved production build artifact never
// wires src/api/dev/* (the DEVELOPMENT_ONLY fixture client family) in as
// the active API client -- never a mere grep of a .env file, never a claim
// taken on trust.
//
// How real-vs-demo is actually decided today (read in full before writing
// this gate -- see src/config/env.ts and src/api/client.ts):
//   config.demoMode = (import.meta.env.VITE_PCA_DEMO_MODE ?? 'false') === 'true'
//   getApiClients() { ...; cached = config.demoMode ? buildDevClients() : buildRealClients(); return cached; }
// `import.meta.env.VITE_PCA_DEMO_MODE` is a Vite build-time-inlined
// constant (https://vitejs.dev/guide/env-and-mode.html) -- once inlined,
// Rollup's tree-shaking can prove the entire unreachable ternary branch
// dead and drop it from the emitted JS.
//
// This was verified empirically against real `vite build` output of this
// exact app/toolchain (Vite 6.4.3) before this gate was written: a build
// with VITE_PCA_DEMO_MODE=false emits the `isFixtureBacked:!1` (buildReal
// Clients' return value literal) marker exactly once and ZERO occurrences
// of buildDevClients()' `isFixtureBacked:!0` marker -- and vice versa for
// VITE_PCA_DEMO_MODE=true. In each case the WHOLE unreachable branch,
// including every `Dev*Client` class constructed inside it, is absent from
// the bundle (not merely unexecuted). So inspecting the emitted JS for that
// literal marker is a direct, artifact-level proof of which branch actually
// shipped, robust to minified-identifier renaming (property keys are not
// mangled by Vite's default esbuild minifier, only local identifiers are).
//
// Known, deliberately-not-flagged residue: a few of src/api/dev/fixtures.ts's
// sample records use non-pure expressions (`new Date(Date.now() -
// N).toISOString()`), which Rollup conservatively keeps as inert,
// unreachable, never-read bytes in the bundle even once the branch that
// would have used them is proven dead. This gate does NOT treat that as a
// failure -- flagging genuinely-unreachable dead data would make the gate a
// false-positive trap divorced from the actual risk (a demo/mock client
// being the ACTIVE one). What this gate checks is whether the *client
// construction path* resolved to the demo branch, via the isFixtureBacked
// literal every branch's returned PcaApiClients object carries.
//
// Two independent checks combine into a PASS:
//   1. Source-shape sanity check: src/api/client.ts's getApiClients() still
//      branches via the exact `config.demoMode ? buildDevClients() :
//      buildRealClients()` shape this gate's reasoning above depends on. If
//      that shape has drifted, this gate's premise may no longer hold --
//      fail loudly and require a human to update the gate, rather than
//      silently keep trusting stale reasoning.
//   2. Build-artifact marker check: the REAL npm-run-build pipeline for this
//      app (`tsc --noEmit -p tsconfig.json` then `vite build`), run with an
//      explicitly-forced VITE_PCA_DEMO_MODE value (never inherited
//      ambiguously from a developer's local .env -- see README note below),
//      output inspected for the isFixtureBacked marker described above.
//
// Usage:
//   node scripts/productionDemoModeGate.mjs check              -> PRODUCTION_DEMO_MODE_GATE
//   node scripts/productionDemoModeGate.mjs negative-control    -> DEMO_MODE_NEGATIVE_CONTROL
//   node scripts/productionDemoModeGate.mjs both                -> runs both (shares one tsc pass)
//
// This script never reads or writes parent-web/.env -- it only overrides
// VITE_PCA_DEMO_MODE in the *child process* environment used for each
// build, which Vite's dotenv loading gives precedence over any .env file
// value for the same key (existing process.env vars are never overwritten
// by a .env file). A developer's local .env (VITE_PCA_DEMO_MODE=true, the
// documented local-dev default -- see .env.example) is therefore left
// completely untouched by this script, and `npm run dev` keeps behaving
// exactly as before.
//
// All build output is written under the OS temp directory and deleted
// afterwards (try/finally) -- this script never leaves build artifacts
// inside the repository tree.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(__dirname, '..');

const TSC_BIN = join(APP_ROOT, 'node_modules', 'typescript', 'bin', 'tsc');
const VITE_BIN = join(APP_ROOT, 'node_modules', 'vite', 'bin', 'vite.js');

const REAL_MARKER = /isFixtureBacked\s*:\s*(!1|false)\b/;
const DEMO_MARKER = /isFixtureBacked\s*:\s*(!0|true)\b/;
const SOURCE_SHAPE = /config\.demoMode\s*\?\s*buildDevClients\(\)\s*:\s*buildRealClients\(\)/;

function log(line) {
  process.stdout.write(`${line}\n`);
}

function run(command, args, extraEnv, label) {
  log(`  $ ${label ?? [command, ...args].join(' ')}`);
  const result = spawnSync(process.execPath, [command, ...args], {
    cwd: APP_ROOT,
    env: { ...process.env, ...extraEnv },
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    log(result.stdout ?? '');
    log(result.stderr ?? '');
    throw new Error(`Command failed (exit ${result.status}): ${label ?? command}`);
  }
  return result;
}

/** Sanity check: the gate's reasoning above only holds while getApiClients()
 * still branches the exact way it did when this gate was written. */
function assertSourceShape() {
  const clientTs = readFileSync(join(APP_ROOT, 'src', 'api', 'client.ts'), 'utf8');
  if (!SOURCE_SHAPE.test(clientTs)) {
    throw new Error(
      'productionDemoModeGate: src/api/client.ts no longer contains the ' +
        "`config.demoMode ? buildDevClients() : buildRealClients()` shape this gate's " +
        'tree-shaking argument depends on. Update this gate (and re-verify the tree-shaking ' +
        'claim against a real build) before trusting its result again.',
    );
  }
}

function runTypecheck() {
  log('[1/2] Typechecking (tsc --noEmit -p tsconfig.json) ...');
  run(TSC_BIN, ['--noEmit', '-p', 'tsconfig.json'], {}, 'tsc --noEmit -p tsconfig.json');
}

/** Runs the real `vite build` step (the same one `npm run build` invokes)
 * with VITE_PCA_DEMO_MODE explicitly forced to `demoMode`, into a fresh
 * OS-temp output directory. Returns that directory's path. */
function runViteBuild(demoMode) {
  const outDir = mkdtempSync(join(tmpdir(), `pca-parent-web-demo-gate-${demoMode}-`));
  log(`[2/2] Building (vite build, VITE_PCA_DEMO_MODE=${demoMode}) -> ${outDir}`);
  run(
    VITE_BIN,
    ['build', '--mode', 'production', '--outDir', outDir, '--emptyOutDir'],
    { VITE_PCA_DEMO_MODE: String(demoMode) },
    `vite build --mode production --outDir <tmp> (VITE_PCA_DEMO_MODE=${demoMode})`,
  );
  return outDir;
}

function listJsFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...listJsFiles(full));
    else if (entry.endsWith('.js')) out.push(full);
  }
  return out;
}

/** Concatenates every emitted .js file's text -- the demo/real branch could
 * in principle land in any chunk, so every chunk must be inspected. */
function readBuiltJs(distDir) {
  const files = listJsFiles(distDir);
  if (files.length === 0) {
    throw new Error(`productionDemoModeGate: no .js files found under ${distDir} -- build produced no output?`);
  }
  return files.map((f) => readFileSync(f, 'utf8')).join('\n');
}

/** The actual artifact-level check. Returns { pass, reason }. */
function inspectArtifact(jsText) {
  const foundDemo = DEMO_MARKER.test(jsText);
  const foundReal = REAL_MARKER.test(jsText);
  if (foundDemo) {
    return {
      pass: false,
      reason:
        'demo/fixture client construction marker (isFixtureBacked=true, i.e. buildDevClients()\'s ' +
        'return value) is present in the built artifact -- the DEVELOPMENT_ONLY client family ' +
        '(src/api/dev/*) is reachable/active in this build.',
    };
  }
  if (!foundReal) {
    return {
      pass: false,
      reason:
        'could not find the real-client construction marker (isFixtureBacked=false) anywhere in the ' +
        'built artifact. Inconclusive results are treated as a FAILURE, not a silent pass -- the ' +
        'marker this gate depends on may have been renamed/refactored; update this gate before ' +
        'trusting a build again.',
    };
  }
  return { pass: true, reason: 'real-client marker (isFixtureBacked=false) present; demo-client marker absent.' };
}

function cleanup(dir) {
  if (dir) rmSync(dir, { recursive: true, force: true });
}

function runCheck({ skipTypecheck = false } = {}) {
  log('=== PRODUCTION_DEMO_MODE_GATE (parent-web) ===');
  assertSourceShape();
  if (!skipTypecheck) runTypecheck();
  let outDir;
  try {
    outDir = runViteBuild(false);
    const jsText = readBuiltJs(outDir);
    const result = inspectArtifact(jsText);
    if (result.pass) {
      log(`PASS: ${result.reason}`);
      log('PRODUCTION_DEMO_MODE_GATE = PASS');
      return true;
    }
    log(`FAIL: ${result.reason}`);
    log('PRODUCTION_DEMO_MODE_GATE = FAIL');
    return false;
  } finally {
    cleanup(outDir);
  }
}

function runNegativeControl({ skipTypecheck = false } = {}) {
  log('=== DEMO_MODE_NEGATIVE_CONTROL (parent-web) ===');
  log('Forcing VITE_PCA_DEMO_MODE=true (demo mode ON) and proving the gate correctly REJECTS the result.');
  assertSourceShape();
  if (!skipTypecheck) runTypecheck();
  let outDir;
  try {
    outDir = runViteBuild(true);
    const jsText = readBuiltJs(outDir);
    const result = inspectArtifact(jsText);
    if (result.pass) {
      log(`FAIL: gate incorrectly PASSED a demo-mode-forced build (${result.reason}) -- the gate is a rubber stamp.`);
      log('DEMO_MODE_NEGATIVE_CONTROL = FAIL');
      return false;
    }
    log(`Gate correctly rejected the demo-mode-forced build: ${result.reason}`);
    log('DEMO_MODE_NEGATIVE_CONTROL = PASS');
    return true;
  } finally {
    cleanup(outDir);
  }
}

function main() {
  const mode = process.argv[2];
  if (mode === 'check') {
    process.exit(runCheck() ? 0 : 1);
  } else if (mode === 'negative-control') {
    process.exit(runNegativeControl() ? 0 : 1);
  } else if (mode === 'both') {
    const checkOk = runCheck();
    const negOk = runNegativeControl({ skipTypecheck: true });
    process.exit(checkOk && negOk ? 0 : 1);
  } else {
    log('Usage: node scripts/productionDemoModeGate.mjs <check|negative-control|both>');
    process.exit(2);
  }
}

main();
