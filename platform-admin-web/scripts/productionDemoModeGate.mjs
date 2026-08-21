// PRODUCTION_DEMO_MODE_GATE (Prompt-1 audit follow-up).
//
// parent-web (the sibling app) has an explicit build-time demo/fixture
// toggle (VITE_PCA_DEMO_MODE -> src/api/dev/* vs src/api/real/*, see
// parent-web/scripts/productionDemoModeGate.mjs). This app was investigated
// (full read of src/api/*, src/config/env.ts, src/state, and a recursive
// case-insensitive search of the whole src/ tree for demo/mock/fixture-
// related identifiers) and has NO equivalent mechanism at all:
//   - src/config/env.ts exposes exactly one build-time value
//     (VITE_PCA_PLATFORM_ADMIN_API_BASE_URL) -- no demo/mock flag.
//   - src/api/platformAdminApiClient.ts and platformAdminAuthClient.ts are
//     real `fetch()`-backed HTTP clients against the five real
//     backend/src/http/routes/platformAdminAuthRoutes.ts endpoints; there is
//     no src/api/dev/, src/api/mock/, or equivalent fixture-provider
//     directory, and no `isFixtureBacked`-style flag anywhere in this app.
// This is the actual, current shape of the app, not an assumption -- so
// "prove the production build resolves to the real client" for this app
// means proving that NO such alternate client exists anywhere in the
// resolved build output, and that the source tree does not (re-)introduce
// one silently.
//
// Two checks combine into a PASS:
//   1. Source scan: every .ts/.tsx file under src/ is scanned for a fixed
//      set of demo/mock/fixture-mechanism tokens (the same vocabulary this
//      app's own contributors would reach for if they ever added a
//      parent-web-style toggle: demoMode, DEV_ONLY, DEVELOPMENT_ONLY,
//      mock-client, isFixtureBacked/fixtureBacked). Expected: zero matches.
//   2. Build-artifact scan: the REAL npm-run-build pipeline for this app
//      (`tsc --noEmit -p tsconfig.json` then `vite build`) is run, and the
//      emitted JS is scanned for the SAME forbidden vocabulary (expected:
//      zero matches) AND required to contain the real backend route path
//      literals (`/platform-admin/auth/login`, `/platform-admin/auth/whoami`)
//      that only the real HTTP client ships -- a positive, not just a
//      negative, proof that the real client is what got built in.
//
// Negative control (mandatory, per the audit follow-up): because this app
// genuinely has no existing demo/mock toggle to flip, `negative-control`
// temporarily injects a small, always-false-guarded, but genuinely
// REACHABLE (not dead/tree-shaken) canary marker into
// src/api/platformAdminApiClient.ts -- the same file every real request
// already funnels through (authHeaders()) -- containing the literal string
// "MOCK_CLIENT_ACTIVE" (one of the forbidden tokens above), rebuilds, and
// asserts the SAME detection logic used by `check` correctly rejects that
// build. The injected block is delimited by NEGATIVE_CONTROL_CANARY_START/
// END markers and is always removed again in a finally block (including on
// a thrown error), with the restored file byte-for-byte diffed against the
// original before this script exits -- if restoration ever fails, this
// script exits non-zero rather than silently leaving the canary in place.
// This is an honest substitute for "flip the real toggle": it exercises the
// exact same build+inspect pipeline end-to-end against a real (temporary)
// source change, proving the gate's detection logic has real teeth, while
// being transparent that no production-real demo toggle exists in this app
// to flip instead.
//
// Usage:
//   node scripts/productionDemoModeGate.mjs check              -> PRODUCTION_DEMO_MODE_GATE
//   node scripts/productionDemoModeGate.mjs negative-control    -> DEMO_MODE_NEGATIVE_CONTROL
//   node scripts/productionDemoModeGate.mjs both                -> runs both (shares one tsc pass)
//
// All build output is written under the OS temp directory and deleted
// afterwards (try/finally) -- this script never leaves build artifacts
// inside the repository tree, and never touches .env files.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(__dirname, '..');

const TSC_BIN = join(APP_ROOT, 'node_modules', 'typescript', 'bin', 'tsc');
const VITE_BIN = join(APP_ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
const CANARY_TARGET = join(APP_ROOT, 'src', 'api', 'platformAdminApiClient.ts');

const FORBIDDEN_PATTERNS = [
  { name: 'demoMode', re: /demoMode/i },
  { name: 'DEV_ONLY', re: /DEV_ONLY/ },
  { name: 'DEVELOPMENT_ONLY', re: /DEVELOPMENT_ONLY/ },
  { name: 'mock-client', re: /mock[_-]?client/i },
  { name: 'isFixtureBacked/fixtureBacked', re: /fixture[_-]?backed/i },
];

const REQUIRED_REAL_MARKERS = ['/platform-admin/auth/login', '/platform-admin/auth/whoami'];

const CANARY_START = '// === NEGATIVE_CONTROL_CANARY_START (temporary; injected by scripts/productionDemoModeGate.mjs negative-control; must not be committed) ===';
const CANARY_END = '// === NEGATIVE_CONTROL_CANARY_END ===';
const CANARY_BLOCK = `${CANARY_START}
const __NEGATIVE_CONTROL_DEMO_MARKER__ = 'MOCK_CLIENT_ACTIVE';
if (typeof globalThis !== 'undefined' && (globalThis as unknown as Record<string, unknown>).__pcaNegativeControlNeverTrue__ === __NEGATIVE_CONTROL_DEMO_MARKER__) {
  console.log(__NEGATIVE_CONTROL_DEMO_MARKER__);
}
${CANARY_END}
`;
const IMPORT_ANCHOR = "import { PlatformAdminApiError } from './platformAdminAuthClient';\n";

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

function runTypecheck() {
  log('[1/2] Typechecking (tsc --noEmit -p tsconfig.json) ...');
  run(TSC_BIN, ['--noEmit', '-p', 'tsconfig.json'], {}, 'tsc --noEmit -p tsconfig.json');
}

function runViteBuild(label) {
  const outDir = mkdtempSync(join(tmpdir(), `pca-platform-admin-web-demo-gate-${label}-`));
  log(`[2/2] Building (vite build) -> ${outDir}`);
  run(
    VITE_BIN,
    ['build', '--mode', 'production', '--outDir', outDir, '--emptyOutDir'],
    {},
    'vite build --mode production --outDir <tmp>',
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

function readBuiltJs(distDir) {
  const files = listJsFiles(distDir);
  if (files.length === 0) {
    throw new Error(`productionDemoModeGate: no .js files found under ${distDir} -- build produced no output?`);
  }
  return files.map((f) => readFileSync(f, 'utf8')).join('\n');
}

function listSourceFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules') continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...listSourceFiles(full));
    else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) out.push(full);
  }
  return out;
}

/** Scans arbitrary text for the forbidden-token vocabulary. Returns the
 * first matching pattern name, or null if clean. */
function findForbiddenToken(text) {
  for (const { name, re } of FORBIDDEN_PATTERNS) {
    if (re.test(text)) return name;
  }
  return null;
}

function scanSourceTree() {
  const files = listSourceFiles(join(APP_ROOT, 'src'));
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    const hit = findForbiddenToken(text);
    if (hit) {
      return { pass: false, reason: `forbidden token "${hit}" found in source file ${file} -- a demo/mock client mechanism may have been (re-)introduced.` };
    }
  }
  return { pass: true, reason: `scanned ${files.length} source files under src/, found no demo/mock/fixture-mechanism tokens.` };
}

function inspectArtifact(jsText) {
  const forbiddenHit = findForbiddenToken(jsText);
  if (forbiddenHit) {
    return { pass: false, reason: `forbidden token "${forbiddenHit}" is present in the built artifact -- a demo/mock client mechanism is reachable in this build.` };
  }
  const missingRealMarkers = REQUIRED_REAL_MARKERS.filter((marker) => !jsText.includes(marker));
  if (missingRealMarkers.length > 0) {
    return {
      pass: false,
      reason:
        `could not find required real-client route marker(s) [${missingRealMarkers.join(', ')}] in the built ` +
        'artifact. Inconclusive results are treated as a FAILURE, not a silent pass.',
    };
  }
  return { pass: true, reason: 'no forbidden demo/mock tokens found; real backend route markers present.' };
}

function cleanup(dir) {
  if (dir) rmSync(dir, { recursive: true, force: true });
}

function runCheck({ skipTypecheck = false } = {}) {
  log('=== PRODUCTION_DEMO_MODE_GATE (platform-admin-web) ===');
  const sourceScan = scanSourceTree();
  if (!sourceScan.pass) {
    log(`FAIL (source scan): ${sourceScan.reason}`);
    log('PRODUCTION_DEMO_MODE_GATE = FAIL');
    return false;
  }
  log(`Source scan OK: ${sourceScan.reason}`);
  if (!skipTypecheck) runTypecheck();
  let outDir;
  try {
    outDir = runViteBuild('check');
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

function injectCanary() {
  const original = readFileSync(CANARY_TARGET, 'utf8');
  if (!original.includes(IMPORT_ANCHOR)) {
    throw new Error(`productionDemoModeGate: expected import anchor not found in ${CANARY_TARGET} -- cannot inject negative-control canary safely.`);
  }
  if (original.includes(CANARY_START)) {
    throw new Error(`productionDemoModeGate: ${CANARY_TARGET} already contains a negative-control canary from an interrupted previous run -- remove it manually before continuing.`);
  }
  const patched = original.replace(IMPORT_ANCHOR, `${IMPORT_ANCHOR}\n${CANARY_BLOCK}`);
  writeFileSync(CANARY_TARGET, patched, 'utf8');
  return original;
}

function restoreCanary(original) {
  writeFileSync(CANARY_TARGET, original, 'utf8');
  const restored = readFileSync(CANARY_TARGET, 'utf8');
  if (restored !== original) {
    throw new Error(`productionDemoModeGate: restoring ${CANARY_TARGET} after the negative-control run produced a byte-for-byte mismatch -- manual review required.`);
  }
}

function runNegativeControl() {
  log('=== DEMO_MODE_NEGATIVE_CONTROL (platform-admin-web) ===');
  log('This app has no real demo/mock toggle to flip (confirmed by source investigation -- see this');
  log('script\'s header comment). Injecting a temporary, reachable canary marker into');
  log(`${CANARY_TARGET} instead, to prove the check logic above actually rejects a build that`);
  log('wires in demo/mock-shaped code, then restoring the original file.');
  const original = readFileSync(CANARY_TARGET, 'utf8');
  let outDir;
  try {
    injectCanary();
    runTypecheck();
    outDir = runViteBuild('negative-control');
    const jsText = readBuiltJs(outDir);
    const result = inspectArtifact(jsText);
    if (result.pass) {
      log(`FAIL: gate incorrectly PASSED a canary-injected build (${result.reason}) -- the gate is a rubber stamp.`);
      log('DEMO_MODE_NEGATIVE_CONTROL = FAIL');
      return false;
    }
    log(`Gate correctly rejected the canary-injected build: ${result.reason}`);
    log('DEMO_MODE_NEGATIVE_CONTROL = PASS');
    return true;
  } finally {
    cleanup(outDir);
    restoreCanary(original);
    log(`Restored ${CANARY_TARGET} to its original content (verified byte-for-byte).`);
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
    const negOk = runNegativeControl();
    process.exit(checkOk && negOk ? 0 : 1);
  } else {
    log('Usage: node scripts/productionDemoModeGate.mjs <check|negative-control|both>');
    process.exit(2);
  }
}

main();
