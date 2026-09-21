#!/usr/bin/env node
// Gate for a real-backend E2E run, and generator of its bounded evidence
// manifest. Used by .github/workflows/quality-gates.yml's real-backend-e2e job,
// and runnable by hand after a local `npm run test:e2e:real`.
//
// WHY THIS EXISTS (the specific false pass it prevents):
// both real-backend specs begin with
//   test.skip(!EMAIL || !PASSWORD, '... not set ...')
// so if the CI job fails to wire E2E_REAL_PARENT_EMAIL / E2E_REAL_ADMIN_* , the
// suite does not fail -- it reports SUCCESS with every test skipped, and the
// job goes green having exercised nothing at all. That is the same
// vacuously-green class this repository already guards elsewhere (e.g. the
// negative control in verify-test-double-conformance.mjs), and it is the most
// likely failure mode of wiring a real-backend suite into CI for the first
// time. A skipped test is therefore treated as a FAILURE here, not as "not
// applicable".
//
// It also refuses `flaky` results: a retry that passed on the second attempt is
// not reproducible evidence, and this suite is configured with retries: 0
// precisely so that a pass means a pass.
import { readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';

function fail(message) {
  console.error(`REAL_E2E_GATE = FAIL\n${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = { resultsPath: null, label: null, manifestOut: null, sourceSha: null, workflow: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--label') args.label = argv[++i];
    else if (arg === '--manifest-out') args.manifestOut = argv[++i];
    else if (arg === '--source-sha') args.sourceSha = argv[++i];
    else if (arg === '--workflow') args.workflow = argv[++i];
    else if (!args.resultsPath) args.resultsPath = arg;
    else fail(`unexpected argument: ${arg}`);
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const label = args.label ?? 'real-backend E2E';

if (!args.resultsPath) fail('usage: assertRealE2eResults.mjs <playwright-json-results.json> [--label L] [--manifest-out P] [--source-sha S] [--workflow W]');

let raw;
try {
  raw = readFileSync(args.resultsPath, 'utf8');
} catch (error) {
  fail(
    `could not read the Playwright JSON report at ${args.resultsPath} (${error.code ?? error.message}).\n` +
      'The reporter is configured in playwright.real.config.ts to write it to\n' +
      'test-results/real-e2e-results.json -- if the file is absent the suite did\n' +
      'not run to completion, which is not a pass.',
  );
}

let report;
try {
  report = JSON.parse(raw);
} catch {
  fail(`${args.resultsPath} is not valid JSON.`);
}

const stats = report?.stats;
if (!stats || typeof stats !== 'object') {
  fail(`${args.resultsPath} has no "stats" object -- not a Playwright JSON report.`);
}

const expected = Number(stats.expected ?? 0);
const skipped = Number(stats.skipped ?? 0);
const unexpected = Number(stats.unexpected ?? 0);
const flaky = Number(stats.flaky ?? 0);

if (unexpected > 0) fail(`${label}: ${unexpected} test(s) FAILED.`);
if (skipped > 0) {
  fail(
    `${label}: ${skipped} test(s) were SKIPPED, which means the required environment was not wired.\n` +
      'The real-backend specs skip themselves when E2E_REAL_* variables are unset, so a skipped run\n' +
      'exercises nothing while still reporting success. Fix the environment; do not ignore this.',
  );
}
if (expected === 0) fail(`${label}: the suite reported 0 passing tests -- nothing was exercised.`);
if (flaky > 0) fail(`${label}: ${flaky} test(s) only passed on retry, so the result is not reproducible evidence.`);

const summary = { label, expected, skipped, unexpected, flaky };
console.log(`REAL_E2E_GATE = PASS  ${JSON.stringify(summary)}`);

if (args.manifestOut) {
  // The bounded, deterministic evidence record. Deliberately small: it identifies
  // exactly which source revision was exercised and where the full, bulky report
  // lives, and it is safe to read years later. The transient Playwright
  // test-results/ tree (traces, videos, screenshots, machine-specific paths) is
  // uploaded as a GitHub Actions artifact instead of committed -- see P1-14.
  const manifest = {
    SOURCE_SHA: args.sourceSha ?? process.env.GITHUB_SHA ?? 'UNKNOWN',
    WORKFLOW: args.workflow ?? process.env.GITHUB_WORKFLOW ?? 'local',
    SUITE: label,
    PASS: expected,
    FAIL: unexpected,
    SKIP: skipped,
    FLAKY: flaky,
    ENVIRONMENT_CLASS: 'disposable-mysql+real-backend+same-origin-vite-proxy',
    REAL_SMTP: 'NOT_TESTED',
    ARTIFACT_REFERENCE: process.env.GITHUB_RUN_ID
      ? `${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
      : 'local-run-not-archived',
  };
  writeFileSync(args.manifestOut, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log(`Wrote evidence manifest: ${args.manifestOut}`);
}
