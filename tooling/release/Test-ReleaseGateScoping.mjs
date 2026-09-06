// Proves the DW-W1-A hard invariants for Invoke-ReleaseGateCheck.ps1's
// -ReleaseTarget release scoping (FABLE-A001/A026/A061), against the REAL
// script and the REAL repository data -- not a fixture stand-in. A handful
// of tests need to see the effect of a gate that is currently open become
// CLOSED (or an invalid/undeclared reference appear); those transiently
// mutate the two OWNED files this depends on
// (docs/release_readiness/external_gate_matrix.json and
// .agent-runtime/manifests/pca-r3-final/R3_EXTERNAL_GATE_REGISTER.csv) and
// ALWAYS restore the exact original bytes in a `finally` block, verified by
// byte comparison at the end. Safe to re-run at any time.
//
// Usage: node tooling/release/Test-ReleaseGateScoping.mjs
// Exit code 0 = every assertion passed. Non-zero = at least one failed
// (see the printed FAIL lines) or the run could not complete (see stderr).
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// DW-W1-R1 P1-2 (portability): platform-neutral path construction throughout
// -- no forced backslash conversion. `join()` uses the host's own separator
// (`\` on Windows, `/` elsewhere), and pwsh (PowerShell 7+, cross-platform)
// accepts either separator on any OS, so this runs unmodified on Windows
// locally and on Ubuntu GitHub Actions runners.
const repoRoot = fileURLToPath(new URL('../../', import.meta.url)).replace(/[\\/]$/, '');
const matrixPath = join(repoRoot, 'docs', 'release_readiness', 'external_gate_matrix.json');
const registerPath = join(repoRoot, '.agent-runtime', 'manifests', 'pca-r3-final', 'R3_EXTERNAL_GATE_REGISTER.csv');
const scriptPath = join(repoRoot, 'tooling', 'release', 'Invoke-ReleaseGateCheck.ps1');
const uatPlanPath = join(repoRoot, 'docs', 'release_readiness', 'UAT_TEST_PLAN.md');
const uatLogPath = join(repoRoot, 'docs', 'release_readiness', 'uat_execution_log.json');

// pwsh is PowerShell Core -- present on Windows (installed alongside this
// repo's tooling), on Ubuntu GitHub Actions runners (preinstalled), and
// generally wherever this suite needs to run. Fail with a clear message
// rather than a cryptic ENOENT if it is genuinely absent.
try {
  execFileSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command', 'exit 0'], { stdio: 'ignore' });
} catch (err) {
  console.error(`FATAL: 'pwsh' (PowerShell 7+) is required to run this suite and could not be invoked (${err.message}). Install PowerShell Core: https://github.com/PowerShell/PowerShell`);
  process.exit(1);
}

let failures = 0;
function ok(cond, label) {
  if (cond) { console.log(`PASS: ${label}`); } else { console.log(`FAIL: ${label}`); failures += 1; }
}

// PowerShell's error stream wraps long throw messages to the console width
// and interleaves ANSI color codes -- confirmed empirically ON REAL LINUX
// (DW-W1-R2 fresh-reviewer finding, reproduced in an Ubuntu container: a
// non-interactive/redirected pwsh host on Linux defaults
// $Host.UI.RawUI.WindowSize.Width to 80, unlike this repo's interactive
// Windows terminal, so a message that never wrapped in local testing can
// still wrap on real CI). PowerShell's pretty-printed exception display
// also inserts its OWN "NNN |"/"    | " gutter prefix on every wrapped
// continuation line (and a "Line |" header plus a "~~~~" underline line
// that are pure decoration, not part of the thrown message) -- so a
// wrapped message can read like "...is missing      | the required
// property..." even after collapsing newlines to spaces. Every gutter/pipe
// artifact is stripped here as defense in depth (this repo's own
// Write-Host output never contains a literal "|", confirmed by inspection,
// so this cannot accidentally eat real output) -- but the PRIMARY defense
// is that every regex check below matches independent SHORT substrings
// rather than one contiguous multi-word phrase, so a wrap landing between
// two checked substrings still cannot cause a false failure.
function normalizeForMatching(text) {
  return text
    .replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '')
    .replace(/\r?\n/g, ' ')
    .replace(/\s*\|\s*/g, ' ')
    .replace(/\s+/g, ' ');
}

function runGateRaw(args, timeoutMs = 60000) {
  const started = Date.now();
  try {
    const out = execFileSync('pwsh', ['-NoProfile', '-NonInteractive', '-File', scriptPath, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: timeoutMs });
    return { exitCode: 0, out: normalizeForMatching(out), ms: Date.now() - started, timedOut: false };
  } catch (err) {
    return { exitCode: err.status ?? 1, out: normalizeForMatching((err.stdout || '') + (err.stderr || '')), ms: Date.now() - started, timedOut: !!err.signal && err.status === null };
  }
}

function runGate(target, extraArgs = []) {
  const jsonPath = join(tmpdir(), `pca-gate-test-${target}-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  const result = runGateRaw(['-ReleaseTarget', target, '-JsonOutPath', jsonPath, ...extraArgs]);
  let json = null;
  try { json = JSON.parse(readFileSync(jsonPath, 'utf8')); } catch { /* not written on an early fail-closed/throw path */ }
  try { unlinkSync(jsonPath); } catch { /* best effort cleanup */ }
  return { ...result, json };
}

function failuresText(result) {
  return JSON.stringify(result.json ? result.json.failures : []);
}

console.log('=== Section 1: -ReleaseTarget fails closed, non-interactively, without hanging ===');
{
  const missing = runGateRaw([]);
  ok(missing.exitCode !== 0, 'missing -ReleaseTarget exits non-zero');
  ok(missing.ms < 15000, `missing -ReleaseTarget returns fast, no hang (${missing.ms}ms)`);
  ok(/-ReleaseTarget is required/.test(missing.out), 'missing -ReleaseTarget explains why it failed');

  const garbage = runGateRaw(['-ReleaseTarget', 'MARS_COLONY']);
  ok(garbage.exitCode !== 0, 'garbage -ReleaseTarget exits non-zero');
  ok(garbage.ms < 15000, `garbage -ReleaseTarget returns fast, no hang (${garbage.ms}ms)`);
  ok(/must be exactly one of/.test(garbage.out), 'garbage -ReleaseTarget names the valid set');
}

console.log('');
console.log('=== Section 2: per-target hard invariants (current real repo state) ===');
const ALL_TARGETS = ['PUBLIC_A', 'AUTH_B', 'PARENT_C', 'ANDROID_D', 'IOS_FUTURE', 'BILLING_FUTURE'];
const results = {};
for (const t of ALL_TARGETS) {
  results[t] = runGate(t);
  ok(results[t].json !== null, `${t}: run produced a parseable JSON summary`);
}

function notBlockedBy(target, forbiddenIds, label) {
  const text = failuresText(results[target]);
  const hit = forbiddenIds.filter((id) => text.includes(id));
  ok(hit.length === 0, `${target} is NOT blocked by ${label} (found: ${hit.join(', ') || 'none'})`);
}
function blockedBy(target, requiredId, label) {
  ok(failuresText(results[target]).includes(requiredId), `${target} IS blocked by ${label} (${requiredId})`);
}

notBlockedBy('PUBLIC_A', ['PRODUCTION_CRYPTO_SUITE', 'CRYPTO_SECURITY_REVIEW', 'CRYPTO_ACTIVATION', 'PRODUCTION_CRYPTO_SECURITY_REVIEW'], 'production crypto');
notBlockedBy('PUBLIC_A', ['ANDROID_REAL_DEVICE_UAT'], 'Android real-device UAT');
notBlockedBy('PUBLIC_A', ['IOS_FAMILY_CONTROLS_ENTITLEMENT', 'REQUIRES_ENTITLEMENT'], 'iOS entitlement');
notBlockedBy('PUBLIC_A', ['PAYMENT_PROVIDER_SELECTION', 'MERCHANT_ACCOUNT_APPROVAL', 'SETTLEMENT_BANK_CONFIGURATION', 'SUPPORTED_CHARGE_CURRENCIES', 'SUPPORTED_SETTLEMENT_CURRENCIES', 'PAYMENT_PRODUCTION_CERTIFICATION'], 'payment provider/merchant approval/settlement');
notBlockedBy('PUBLIC_A', ['CLOUD_AI_OWNER_DECISION'], 'cloud AI');
notBlockedBy('PUBLIC_A', ['YOUTUBE_MODE_B_POLICY_REVIEW', 'YOUTUBE_PLATFORM_API_PARTNERSHIP'], 'YouTube Mode B');
// DW-W1-R2 P1-B: PUBLIC_A's TECHNICAL_GATES_PASS flipped from true to false
// this round -- REAL_UAT is no longer vacuously satisfied for a
// zero-relevant-case target (see Section 5c item A), so it now correctly
// contributes a real technical failure (UAT_PLAN_INCOMPLETE_FOR_TARGET) for
// PUBLIC_A, on top of its pre-existing owner gates. Both remain true at once.
ok(results.PUBLIC_A.json.technicalGatesPass === false, 'PUBLIC_A: TECHNICAL_GATES_PASS is now false (REAL_UAT is UAT_PLAN_INCOMPLETE_FOR_TARGET, a real technical gap, not vacuously satisfied)');
ok(results.PUBLIC_A.json.realUatState === 'UAT_PLAN_INCOMPLETE_FOR_TARGET', `PUBLIC_A: realUatState is UAT_PLAN_INCOMPLETE_FOR_TARGET (got: ${results.PUBLIC_A.json.realUatState})`);
ok(results.PUBLIC_A.json.ownerGatesPendingCount > 0 && results.PUBLIC_A.json.verdict === 'NOT_READY', 'PUBLIC_A: verdict is truthfully NOT_READY while owner gates (e.g. OWNER_VISUAL_UAT, PUBLIC_REPLY_IDENTITY) remain open -- never a misleading blanket READY');

notBlockedBy('AUTH_B', ['PRODUCTION_CRYPTO_SUITE', 'CRYPTO_SECURITY_REVIEW', 'CRYPTO_ACTIVATION', 'PRODUCTION_CRYPTO_SECURITY_REVIEW'], 'production crypto');
notBlockedBy('AUTH_B', ['PAYMENT_PROVIDER_SELECTION', 'MERCHANT_ACCOUNT_APPROVAL', 'SETTLEMENT_BANK_CONFIGURATION'], 'payment provider');
notBlockedBy('AUTH_B', ['ANDROID_REAL_DEVICE_UAT'], 'Android UAT');
notBlockedBy('AUTH_B', ['IOS_MAC_XCODE', 'IOS_FAMILY_CONTROLS_ENTITLEMENT', 'IOS_PHYSICAL_DEVICE'], 'iOS UAT');
blockedBy('AUTH_B', 'PRODUCTION_EMAIL_DELIVERY', 'PRODUCTION_EMAIL_DELIVERY (currently open)');

ok(Array.isArray(results.PARENT_C.json.failures) && results.PARENT_C.json.failures.some((f) => f.includes('PRODUCTION_CRYPTO_SUITE') || f.includes('CRYPTO_SECURITY_REVIEW')), 'PARENT_C depends on production crypto (currently open, so it blocks)');
blockedBy('PARENT_C', 'PRODUCTION_EMAIL_DELIVERY', 'the AUTH_B-prerequisite PRODUCTION_EMAIL_DELIVERY gate');
blockedBy('PARENT_C', 'PRODUCER_CATALOGUE_AUDIT_SIGNOFF', 'a Parent-specific gate (PRODUCER_CATALOGUE_AUDIT_SIGNOFF)');

ok(results.ANDROID_D.json.ownerGatesPending.some((g) => ['ANDROID_REAL_DEVICE_UAT', 'CAMERA_REAL_DEVICE_VALIDATION', 'DEVICE_OWNER_REAL_DEVICE_AUTHORIZATION'].includes(g.id)), 'ANDROID_D fails while its hardware/device gates remain open');
ok(results.BILLING_FUTURE.json.ownerGatesPending.some((g) => ['PAYMENT_PROVIDER_SELECTION', 'MERCHANT_ACCOUNT_APPROVAL', 'PAYMENT_PRODUCTION_CERTIFICATION'].includes(g.id)), 'BILLING_FUTURE fails while payment/certification gates remain open');
notBlockedBy('BILLING_FUTURE', ['ANDROID_REAL_DEVICE_UAT', 'IOS_MAC_XCODE', 'PRODUCTION_CRYPTO_SUITE'], 'Android/iOS/crypto gates (BILLING_FUTURE has no device dependency)');

console.log('');
console.log('=== Section 2b: FABLE PARTIAL is a conditional dependency, never a hard base-release blocker (DW-W1-R1 P1-2) ===');
function notHardBlockedBy(target, gateIds, label) {
  const pending = (results[target].json.ownerGatesPending || []).map((g) => g.id);
  const hit = gateIds.filter((id) => pending.includes(id));
  ok(hit.length === 0, `${target}'s BASE release is NOT hard-blocked by ${label} (found in ownerGatesPending: ${hit.join(', ') || 'none'})`);
}
function conditionallyPending(target, gateId, label) {
  const conditional = (results[target].json.conditionalGatesPending || []).map((g) => g.id);
  ok(conditional.includes(gateId), `${target} correctly lists ${label} (${gateId}) as CONDITIONAL, not a hard blocker`);
}
// PUBLIC_REPLY_IDENTITY: PUBLIC_A=YES (hard), AUTH_B=PARTIAL (conditional only).
notHardBlockedBy('AUTH_B', ['PUBLIC_REPLY_IDENTITY'], 'PUBLIC_REPLY_IDENTITY (a FABLE PARTIAL cell for AUTH_B)');
conditionallyPending('AUTH_B', 'PUBLIC_REPLY_IDENTITY', 'PUBLIC_REPLY_IDENTITY');
// PRODUCTION_EMAIL_DELIVERY: ANDROID_D/IOS_FUTURE=PARTIAL (conditional only, not hard).
notHardBlockedBy('ANDROID_D', ['PRODUCTION_EMAIL_DELIVERY'], 'PRODUCTION_EMAIL_DELIVERY (a FABLE PARTIAL cell for ANDROID_D)');
notHardBlockedBy('IOS_FUTURE', ['PRODUCTION_EMAIL_DELIVERY'], 'PRODUCTION_EMAIL_DELIVERY (a FABLE PARTIAL cell for IOS_FUTURE)');
conditionallyPending('ANDROID_D', 'PRODUCTION_EMAIL_DELIVERY', 'PRODUCTION_EMAIL_DELIVERY');
// PLATFORM_ADMIN_ALERT_DELIVERY: AUTH_B/PARENT_C/ANDROID_D all PARTIAL, no YES cell at all.
notHardBlockedBy('AUTH_B', ['PLATFORM_ADMIN_ALERT_DELIVERY'], 'PLATFORM_ADMIN_ALERT_DELIVERY (all-PARTIAL gate)');
notHardBlockedBy('PARENT_C', ['PLATFORM_ADMIN_ALERT_DELIVERY'], 'PLATFORM_ADMIN_ALERT_DELIVERY (all-PARTIAL gate)');
notHardBlockedBy('ANDROID_D', ['PLATFORM_ADMIN_ALERT_DELIVERY'], 'PLATFORM_ADMIN_ALERT_DELIVERY (all-PARTIAL gate)');
// YOUTUBE_MODE_B_POLICY_REVIEW / YOUTUBE_PLATFORM_API_PARTNERSHIP / CLOUD_AI_OWNER_DECISION:
// ANDROID_D/IOS_FUTURE all-PARTIAL, must never hard-block the BASE Android/iOS release.
notHardBlockedBy('ANDROID_D', ['YOUTUBE_MODE_B_POLICY_REVIEW', 'YOUTUBE_PLATFORM_API_PARTNERSHIP', 'CLOUD_AI_OWNER_DECISION'], 'YouTube Mode B / cloud AI (all-PARTIAL gates)');
// DEPLOYED_LOG_METRICS_PIPELINE_CONFIG / OBSERVABILITY_PIPELINE: same principle.
notHardBlockedBy('PARENT_C', ['DEPLOYED_LOG_METRICS_PIPELINE_CONFIG', 'OBSERVABILITY_PIPELINE'], 'log-metrics / observability pipeline gates (all-PARTIAL for PARENT_C)');

console.log('');
console.log('=== Section 3: -IgnoreExternalGates never produces a genuine READY, and never skips crypto/REAL_UAT ===');
{
  const ignoreAndroid = runGate('ANDROID_D', ['-IgnoreExternalGates']);
  ok(ignoreAndroid.exitCode !== 0, '-IgnoreExternalGates on ANDROID_D still exits non-zero today (crypto + REAL_UAT are real, still-open, still-enforced blockers)');
  ok(failuresText(ignoreAndroid).includes('PRODUCTION_CRYPTO_SUITE') && /REAL_UAT/.test(failuresText(ignoreAndroid)), '-IgnoreExternalGates does not skip the crypto or REAL_UAT signals');
  ok(ignoreAndroid.json.ownerGatesPendingCount === 0, '-IgnoreExternalGates genuinely skips the external gate matrix loop (0 owner gates evaluated)');
  ok(ignoreAndroid.json.verdict !== 'READY', '-IgnoreExternalGates on ANDROID_D never reports verdict=READY');

  // DW-W1-R1 P0-2: the concrete, previously-reproducible defect -- PUBLIC_A
  // and AUTH_B currently have NOTHING else open on the technical side (crypto
  // out of scope, REAL_UAT vacuously satisfied), so pre-fix this genuinely
  // exited 0 with "VERDICT: READY" the instant external gates were skipped.
  const ignorePublicA = runGate('PUBLIC_A', ['-IgnoreExternalGates']);
  ok(ignorePublicA.exitCode !== 0, 'PUBLIC_A + -IgnoreExternalGates does not exit 0 (never a release-ready exit code)');
  ok(ignorePublicA.json.verdict !== 'READY', 'PUBLIC_A + -IgnoreExternalGates never reports verdict=READY');
  ok(ignorePublicA.json.verdict === 'INFORMATIONAL_ONLY', 'PUBLIC_A + -IgnoreExternalGates reports the explicit INFORMATIONAL_ONLY verdict');
  ok(ignorePublicA.json.releaseReady === false, 'PUBLIC_A + -IgnoreExternalGates: releaseReady is explicitly false in the JSON output');
  ok(ignorePublicA.json.externalGatesEvaluated === false, 'PUBLIC_A + -IgnoreExternalGates: externalGatesEvaluated is explicitly false in the JSON output');
  ok(/NOT A RELEASE READINESS VERDICT/.test(ignorePublicA.out), 'PUBLIC_A + -IgnoreExternalGates console output states this is not a release verdict');

  const ignoreAuthB = runGate('AUTH_B', ['-IgnoreExternalGates']);
  ok(ignoreAuthB.exitCode !== 0, 'AUTH_B + -IgnoreExternalGates does not exit 0 (never a release-ready exit code)');
  ok(ignoreAuthB.json.verdict !== 'READY', 'AUTH_B + -IgnoreExternalGates never reports verdict=READY');
  ok(ignoreAuthB.json.releaseReady === false, 'AUTH_B + -IgnoreExternalGates: releaseReady is explicitly false in the JSON output');
}

console.log('');
console.log('=== Section 4: isolation -- an unrelated target\'s gate state must never move this target\'s verdict ===');
const originalMatrix = readFileSync(matrixPath, 'utf8');
const originalRegister = readFileSync(registerPath, 'utf8');
try {
  const baselinePublicA = runGate('PUBLIC_A');
  const baselineAndroidD = runGate('ANDROID_D');

  const matrixObj = JSON.parse(originalMatrix);
  const androidGate = matrixObj.gates.find((g) => g.id === 'ANDROID_REAL_DEVICE_UAT');
  ok(!!androidGate, 'fixture sanity: ANDROID_REAL_DEVICE_UAT gate exists in the matrix');
  androidGate.status = 'CLOSED';
  androidGate.evidence = 'TEST_FIXTURE_ONLY -- transient, restored before this script exits';
  writeFileSync(matrixPath, JSON.stringify(matrixObj, null, 2), 'utf8');

  const mutatedPublicA = runGate('PUBLIC_A');
  const mutatedAndroidD = runGate('ANDROID_D');

  ok(JSON.stringify(mutatedPublicA.json.failures) === JSON.stringify(baselinePublicA.json.failures), 'flipping an Android-only gate to CLOSED leaves PUBLIC_A\'s failures list byte-identical');
  ok(mutatedPublicA.json.verdict === baselinePublicA.json.verdict, 'flipping an Android-only gate to CLOSED leaves PUBLIC_A\'s verdict unchanged');
  ok(JSON.stringify(mutatedAndroidD.json.failures) !== JSON.stringify(baselineAndroidD.json.failures), 'sanity: the same flip DOES change ANDROID_D\'s failures list');
  ok(!mutatedAndroidD.json.failures.some((f) => f.includes('ANDROID_REAL_DEVICE_UAT')), 'ANDROID_D no longer cites ANDROID_REAL_DEVICE_UAT once it is CLOSED');

  writeFileSync(matrixPath, originalMatrix, 'utf8');

  console.log('');
  console.log('=== Section 5: invalid/undeclared gate references fail validation (fail closed) ===');

  const matrixObj2 = JSON.parse(originalMatrix);
  matrixObj2.gates[0].releaseScope = ['PUBLIC_A', 'MARS_COLONY_TARGET'];
  writeFileSync(matrixPath, JSON.stringify(matrixObj2, null, 2), 'utf8');
  const badScope = runGate('PUBLIC_A');
  ok(badScope.exitCode !== 0, 'a gate with an invalid releaseScope token makes the whole script fail closed');
  // Checked as separate short substrings, not one contiguous phrase --
  // PowerShell's pretty-printed exception display wraps long throw messages
  // to the console width and inserts its own "  | " continuation prefix
  // between wrapped words (confirmed empirically), which would otherwise
  // break a naive multi-word regex even though the message itself is intact.
  ok(/invalid\/undeclared/.test(badScope.out) && /conditionalReleaseScope/.test(badScope.out) && /token/.test(badScope.out) && /MARS_COLONY_TARGET/.test(badScope.out), 'the failure message names the invalid releaseScope token defect');
  writeFileSync(matrixPath, originalMatrix, 'utf8');

  // DW-W1-R1 P0-1: missing / null / scalar releaseScope (or
  // conditionalReleaseScope) must fail the WHOLE script closed -- this used
  // to fail OPEN (silently treated as an empty scope, i.e. "blocks
  // nothing"). Each case is applied to a gate that is currently NON-CLOSED
  // and in PUBLIC_A's real scope (DEPLOYED_TLS_TERMINATION_CONFIG), so a
  // fail-OPEN regression would be silently swallowed rather than surfaced.
  function withMutatedGate(gateId, mutate, testFn) {
    const obj = JSON.parse(originalMatrix);
    const gate = obj.gates.find((g) => g.id === gateId);
    if (!gate) { ok(false, `fixture sanity: ${gateId} exists in the matrix`); return; }
    mutate(gate);
    writeFileSync(matrixPath, JSON.stringify(obj, null, 2), 'utf8');
    try {
      testFn(runGate('PUBLIC_A'));
    } finally {
      writeFileSync(matrixPath, originalMatrix, 'utf8');
    }
  }

  // DW-W1-R2 (fresh reviewer P0): every check below against a THROWN
  // (uncaught-exception) message uses independent short substring checks,
  // never one contiguous multi-word regex. Confirmed empirically on real
  // Linux (Ubuntu, pwsh non-interactive): PowerShell's pretty-printed
  // exception display wraps a long throw message to
  // $Host.UI.RawUI.WindowSize.Width (80 on a non-interactive/redirected
  // Linux pwsh host) and inserts its own "     | " continuation prefix
  // between wrapped words -- a single regex spanning a wrap boundary
  // silently fails to match even though the message is intact and correct.
  // Plain Write-Host output (never a thrown exception) is NOT subject to
  // this and does not need the same treatment.
  withMutatedGate('DEPLOYED_TLS_TERMINATION_CONFIG', (g) => { delete g.releaseScope; }, (r) => {
    ok(r.exitCode !== 0, 'a gate with releaseScope entirely REMOVED makes the whole script fail closed (never fails open)');
    ok(/missing/.test(r.out) && /required property/.test(r.out) && /releaseScope/.test(r.out), 'the failure names the missing releaseScope property');
  });
  withMutatedGate('DEPLOYED_TLS_TERMINATION_CONFIG', (g) => { g.releaseScope = null; }, (r) => {
    ok(r.exitCode !== 0, 'a gate with releaseScope = null makes the whole script fail closed (never fails open)');
    ok(/releaseScope/.test(r.out) && /null/.test(r.out), 'the failure names the null releaseScope');
  });
  withMutatedGate('DEPLOYED_TLS_TERMINATION_CONFIG', (g) => { g.releaseScope = 'PUBLIC_A'; }, (r) => {
    ok(r.exitCode !== 0, 'a gate with a SCALAR (bare string) releaseScope makes the whole script fail closed (never fails open)');
    ok(/non-array/.test(r.out) && /releaseScope/.test(r.out), 'the failure names the non-array releaseScope');
  });
  withMutatedGate('DEPLOYED_TLS_TERMINATION_CONFIG', (g) => { delete g.conditionalReleaseScope; }, (r) => {
    ok(r.exitCode !== 0, 'a gate with conditionalReleaseScope entirely REMOVED makes the whole script fail closed');
  });
  withMutatedGate('DEPLOYED_TLS_TERMINATION_CONFIG', (g) => { g.conditionalReleaseScope = null; }, (r) => {
    ok(r.exitCode !== 0, 'a gate with conditionalReleaseScope = null makes the whole script fail closed');
  });
  withMutatedGate('DEPLOYED_TLS_TERMINATION_CONFIG', (g) => { g.releaseScope = ['PUBLIC_A']; g.conditionalReleaseScope = ['PUBLIC_A']; }, (r) => {
    ok(r.exitCode !== 0, 'a gate listing the SAME target in both releaseScope and conditionalReleaseScope fails closed');
  });
  withMutatedGate('DEPLOYED_TLS_TERMINATION_CONFIG', (g) => { g.releaseScope = ['AUTH_B', 'AUTH_B', 'PARENT_C']; }, (r) => {
    ok(r.exitCode !== 0, 'a gate with a DUPLICATE token within the same releaseScope array (DW-W1-R2 section 12) fails closed');
    ok(/duplicate/.test(r.out) && /release-target token/.test(r.out), 'the failure names the duplicate-token defect');
  });

  // Explicit [] on a deliberately non-blocking gate remains valid (mission
  // section 5 item E) -- TELEMETRY_ACTIVATION_OWNER_SIGNOFF genuinely has
  // both arrays empty in the real, unmutated matrix, and must NOT throw.
  const telemetryCheck = runGate('PUBLIC_A');
  ok(telemetryCheck.exitCode === 0 || telemetryCheck.json !== null, 'explicit [] releaseScope/conditionalReleaseScope on a real non-blocking gate (TELEMETRY_ACTIVATION_OWNER_SIGNOFF) does not throw');
  ok(!(telemetryCheck.json?.ownerGatesPending ?? []).some((g) => g.id === 'TELEMETRY_ACTIVATION_OWNER_SIGNOFF'), 'TELEMETRY_ACTIVATION_OWNER_SIGNOFF never appears as a hard blocker for any target');

  // Duplicate gate id -- structural corruption, fails closed before any
  // single gate is evaluated.
  {
    const obj = JSON.parse(originalMatrix);
    const dup = JSON.parse(JSON.stringify(obj.gates[0]));
    obj.gates.push(dup);
    writeFileSync(matrixPath, JSON.stringify(obj, null, 2), 'utf8');
    try {
      const dupResult = runGate('PUBLIC_A');
      ok(dupResult.exitCode !== 0, 'a duplicate gate id in the matrix makes the whole script fail closed');
      ok(/duplicate/.test(dupResult.out) && /gate id/.test(dupResult.out), 'the failure names the duplicate gate id defect');
    } finally {
      writeFileSync(matrixPath, originalMatrix, 'utf8');
    }
  }

  const matrixObj3 = JSON.parse(originalMatrix);
  matrixObj3.gates.push({
    id: 'TEST_FIXTURE_UNDECLARED_GATE_ONLY',
    status: 'BLOCKED',
    description: 'Transient test fixture gate with no register row -- must never persist past this test run.',
    owner: 'Test fixture (not a real owner)',
    evidence: null,
    releaseScope: ['PUBLIC_A'],
    conditionalReleaseScope: [],
  });
  writeFileSync(matrixPath, JSON.stringify(matrixObj3, null, 2), 'utf8');
  const undeclaredMatrixGate = runGate('PUBLIC_A');
  ok(undeclaredMatrixGate.exitCode !== 0, 'a matrix gate absent from the register makes the whole gate check fail closed');
  ok(/EXTERNAL_GATE_PARITY = FAIL/.test(failuresText(undeclaredMatrixGate)) || /EXTERNAL_GATE_PARITY = FAIL/.test(undeclaredMatrixGate.out), 'the failure is attributed to EXTERNAL_GATE_PARITY');
  writeFileSync(matrixPath, originalMatrix, 'utf8');

  const extraRow = '\n"TEST_FIXTURE_MISSING_FROM_MATRIX","PCA-FR-001","OPEN_UNVERIFIED","test fixture only -- transient, restored before this script exits","Test","SOURCE_OR_EXTERNAL_REMAINING"\n';
  writeFileSync(registerPath, originalRegister.replace(/\n$/, '') + extraRow, 'utf8');
  const undeclaredRegisterRow = runGate('PUBLIC_A');
  ok(undeclaredRegisterRow.exitCode !== 0, 'a register row citing a gate ID absent from the matrix makes the whole gate check fail closed');
  ok(/EXTERNAL_GATE_PARITY = FAIL/.test(failuresText(undeclaredRegisterRow)) || /EXTERNAL_GATE_PARITY = FAIL/.test(undeclaredRegisterRow.out), 'the failure is attributed to EXTERNAL_GATE_PARITY');
  writeFileSync(registerPath, originalRegister, 'utf8');
} finally {
  // Guarantee byte-exact restoration of both owned files regardless of outcome above.
  writeFileSync(matrixPath, originalMatrix, 'utf8');
  writeFileSync(registerPath, originalRegister, 'utf8');
  ok(readFileSync(matrixPath, 'utf8') === originalMatrix, 'external_gate_matrix.json restored byte-identical after every mutation test');
  ok(readFileSync(registerPath, 'utf8') === originalRegister, 'R3_EXTERNAL_GATE_REGISTER.csv restored byte-identical after every mutation test');
}

console.log('');
console.log('=== Section 5b: REAL_UAT case-to-target map identity vs UAT_TEST_PLAN.md (DW-W1-R1 section 14) ===');
{
  const originalPlan = readFileSync(uatPlanPath, 'utf8');
  try {
    const missing = originalPlan.replace('- UAT-ENR-01: QR-code pairing completes end-to-end on a fresh device, family/device keys generated on-device.\n', '');
    ok(missing !== originalPlan, 'fixture sanity: removing UAT-ENR-01\'s line actually changed the plan text');
    writeFileSync(uatPlanPath, missing, 'utf8');
    const missingResult = runGateRaw(['-ReleaseTarget', 'ANDROID_D']);
    ok(missingResult.exitCode !== 0, 'a case ID present in the map but REMOVED from the plan fails closed');
    ok(/case-to-target/.test(missingResult.out) && /identity drift/.test(missingResult.out) && /UAT-ENR-01/.test(missingResult.out), 'the failure names the map-identity drift and cites UAT-ENR-01');
    writeFileSync(uatPlanPath, originalPlan, 'utf8');

    const extra = originalPlan.replace(
      '### 4.15 Arabic / RTL',
      '### 4.16 Test fixture only\n- UAT-FIXTURE-99: transient test-only case, must never persist past this test run.\n\n### 4.15 Arabic / RTL',
    );
    ok(extra !== originalPlan, 'fixture sanity: adding a fixture-only case actually changed the plan text');
    writeFileSync(uatPlanPath, extra, 'utf8');
    const extraResult = runGateRaw(['-ReleaseTarget', 'ANDROID_D']);
    ok(extraResult.exitCode !== 0, 'an EXTRA case ID present in the plan but absent from the map fails closed');
    ok(/case-to-target/.test(extraResult.out) && /identity drift/.test(extraResult.out) && /UAT-FIXTURE-99/.test(extraResult.out), 'the failure names the map-identity drift and cites UAT-FIXTURE-99');
    writeFileSync(uatPlanPath, originalPlan, 'utf8');

    const replaced = originalPlan.replace('UAT-ENR-01', 'UAT-ENR-01-RENAMED');
    ok(replaced !== originalPlan, 'fixture sanity: renaming UAT-ENR-01 actually changed the plan text');
    writeFileSync(uatPlanPath, replaced, 'utf8');
    const replacedResult = runGateRaw(['-ReleaseTarget', 'ANDROID_D']);
    ok(replacedResult.exitCode !== 0, 'a RENAMED/replaced case ID fails closed (the old id is now missing, the new one is unmapped)');
    writeFileSync(uatPlanPath, originalPlan, 'utf8');
  } finally {
    writeFileSync(uatPlanPath, originalPlan, 'utf8');
    ok(readFileSync(uatPlanPath, 'utf8') === originalPlan, 'UAT_TEST_PLAN.md restored byte-identical after every mutation test');
  }
}

console.log('');
console.log('=== Section 5c: REAL_UAT is never vacuously satisfied for a FABLE YES target (DW-W1-R2 P1-B) ===');
{
  const originalScript = readFileSync(scriptPath, 'utf8');
  const originalLog = readFileSync(uatLogPath, 'utf8');

  // --- A. FABLE YES + zero mapped cases = FAIL CLOSED -----------------------
  // Real repo state today already demonstrates this for PUBLIC_A/IOS_FUTURE/
  // BILLING_FUTURE (all currently 0 relevant cases, all ACKNOWLEDGED
  // architecture-contradiction gaps in ValidateFableScopeParity.mjs -- see
  // that file). Assert it directly here too, against the real script.
  {
    const r = runGate('PUBLIC_A');
    ok(r.json?.realUatState === 'UAT_PLAN_INCOMPLETE_FOR_TARGET', `A: PUBLIC_A (0 relevant cases, FABLE REAL_UAT=YES) reports UAT_PLAN_INCOMPLETE_FOR_TARGET, not a vacuous pass (got: ${r.json?.realUatState})`);
    ok(failuresText(r).includes('UAT_PLAN_INCOMPLETE_FOR_TARGET'), 'A: UAT_PLAN_INCOMPLETE_FOR_TARGET is a real, counted failure for PUBLIC_A');
  }

  // --- B. AUTH_B with unexecuted mapped cases = NOT_READY -------------------
  {
    const r = runGate('AUTH_B');
    ok(r.json?.realUatState === 'NOT_SATISFIED_FOR_TARGET', `B: AUTH_B (4 relevant cases, all unexecuted) reports NOT_SATISFIED_FOR_TARGET (got: ${r.json?.realUatState})`);
    ok(r.json?.realUatRelevantCount === 4 && r.json?.realUatPassedCount === 0, `B: AUTH_B relevant=4 passed=0 (got relevant=${r.json?.realUatRelevantCount} passed=${r.json?.realUatPassedCount})`);
    ok(r.json?.verdict !== 'READY', 'B: AUTH_B is NOT_READY while its UAT cases are unexecuted');
  }

  // --- Negative control (section 10): temporarily unmap AUTH_B from all its --
  // --- UAT cases in the SCRIPT SOURCE -- ValidateFableScopeParity.mjs must ---
  // --- then FAIL (AUTH_B is FABLE=YES and NOT on the acknowledged-gaps list) -
  try {
    const unmapped = originalScript.replace(
      /'UAT-AUTH-01' = @\('AUTH_B'\)\n  'UAT-AUTH-02' = @\('AUTH_B'\)\n  'UAT-AUTH-03' = @\('AUTH_B'\)\n  'UAT-AUTH-04' = @\('AUTH_B'\)/,
      "'UAT-AUTH-01' = @('PARENT_C')\n  'UAT-AUTH-02' = @('PARENT_C')\n  'UAT-AUTH-03' = @('PARENT_C')\n  'UAT-AUTH-04' = @('PARENT_C')",
    );
    ok(unmapped !== originalScript, 'fixture sanity: unmapping AUTH_B\'s 4 UAT cases actually changed the script text');
    writeFileSync(scriptPath, unmapped, 'utf8');
    let parityFailed = false;
    let parityOutput = '';
    try {
      parityOutput = execFileSync('node', [join(repoRoot, 'tooling', 'release', 'ValidateFableScopeParity.mjs')], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      parityFailed = true;
      parityOutput = (err.stdout || '') + (err.stderr || '');
    }
    ok(parityFailed, 'negative control: with AUTH_B unmapped from all its UAT cases, ValidateFableScopeParity.mjs FAILS (AUTH_B is FABLE=YES and not an acknowledged gap)');
    ok(/REAL_UAT\/AUTH_B/.test(parityOutput), 'negative control: the parity failure specifically names REAL_UAT/AUTH_B');
  } finally {
    writeFileSync(scriptPath, originalScript, 'utf8');
  }
  ok(readFileSync(scriptPath, 'utf8') === originalScript, 'Invoke-ReleaseGateCheck.ps1 restored byte-identical after the AUTH_B-unmapping negative control');
  {
    // execFileSync THROWS on a non-zero exit -- this call is deliberately
    // wrapped (a sibling call above already was; this one previously was
    // NOT, a real bug: any non-zero exit here -- for any reason, including
    // a transient/environmental one -- would crash this WHOLE test script
    // with an uncaught exception instead of reporting one graceful `ok(false, ...)`
    // failure, which is indistinguishable from a genuine hang/crash in CI
    // output and defeats the point of every other assertion in this file
    // failing gracefully.
    let parityAfterRestore = '';
    let parityAfterRestoreOk = false;
    try {
      parityAfterRestore = execFileSync('node', [join(repoRoot, 'tooling', 'release', 'ValidateFableScopeParity.mjs')], { encoding: 'utf8' });
      parityAfterRestoreOk = true;
    } catch (err) {
      parityAfterRestore = (err.stdout || '') + (err.stderr || '');
    }
    ok(parityAfterRestoreOk && (/^PASS /m.test(parityAfterRestore) || /\nPASS /.test(parityAfterRestore)), 'ValidateFableScopeParity.mjs passes again once the script is restored');
  }

  // --- C/D. Transient, NEVER-COMMITTED uat_execution_log.json fixtures ------
  // Read the ORIGINAL content into a variable before any mutation, mutate,
  // test, and restore in a finally block -- the same safe pattern already
  // used above for the matrix/register/plan files. This does NOT write fake
  // PASS evidence into the real committed log at any point after this
  // function returns.
  function withMutatedUatLog(mutateFn, testFn) {
    const logObj = JSON.parse(originalLog);
    mutateFn(logObj);
    writeFileSync(uatLogPath, JSON.stringify(logObj, null, 2) + '\n', 'utf8');
    try {
      testFn(runGate('AUTH_B'));
    } finally {
      writeFileSync(uatLogPath, originalLog, 'utf8');
    }
  }

  // --- C. One AUTH_B case PASS, remaining 3 unexecuted = still NOT_READY ----
  withMutatedUatLog(
    (log) => {
      log.cases = [{ caseId: 'UAT-AUTH-01', result: 'PASS' }];
      log.casesLogged = 1;
    },
    (r) => {
      ok(r.json?.realUatState === 'NOT_SATISFIED_FOR_TARGET', `C: AUTH_B with 1 of 4 cases PASS reports NOT_SATISFIED_FOR_TARGET (got: ${r.json?.realUatState})`);
      ok(r.json?.realUatPassedCount === 1 && r.json?.realUatRelevantCount === 4, `C: AUTH_B passed=1 relevant=4 (got passed=${r.json?.realUatPassedCount} relevant=${r.json?.realUatRelevantCount})`);
      ok(r.json?.verdict !== 'READY', 'C: AUTH_B remains NOT_READY with a partially-passed UAT set');
    },
  );

  // --- D. ALL 4 AUTH_B cases PASS = SATISFIED_FOR_TARGET (transient fixture only) --
  withMutatedUatLog(
    (log) => {
      log.cases = ['UAT-AUTH-01', 'UAT-AUTH-02', 'UAT-AUTH-03', 'UAT-AUTH-04'].map((caseId) => ({ caseId, result: 'PASS' }));
      log.casesLogged = 4;
    },
    (r) => {
      ok(r.json?.realUatState === 'SATISFIED_FOR_TARGET', `D: AUTH_B with all 4 relevant cases PASS reports SATISFIED_FOR_TARGET (got: ${r.json?.realUatState})`);
      ok(r.json?.realUatPassedCount === 4 && r.json?.realUatRelevantCount === 4, `D: AUTH_B passed=4 relevant=4 (got passed=${r.json?.realUatPassedCount} relevant=${r.json?.realUatRelevantCount})`);
    },
  );

  // --- E. No test mutation persists ------------------------------------------
  ok(readFileSync(uatLogPath, 'utf8') === originalLog, 'E: uat_execution_log.json restored byte-identical after every transient fixture -- no fake PASS evidence was left behind');
}

console.log('');
console.log('=== Section 6: the four node validators still pass cleanly (unmodified invocation) ===');
{
  const parity = runGate('PUBLIC_A');
  ok(!failuresText(parity).includes('EXTERNAL_GATE_PARITY'), 'EXTERNAL_GATE_PARITY passes on the real (restored) repository state');
  ok(!failuresText(parity).includes('ValidateR3EvidenceDiscipline'), 'ValidateR3EvidenceDiscipline passes');
  ok(!failuresText(parity).includes('ValidateCanonicalTrustBoundary'), 'ValidateCanonicalTrustBoundary passes');
  ok(!failuresText(parity).includes('ValidateSafeZoneMutationBoundary'), 'ValidateSafeZoneMutationBoundary passes');
}

console.log('');
console.log(failures === 0 ? 'ALL PASS (0 failures)' : `${failures} FAILURE(S)`);
process.exitCode = failures === 0 ? 0 : 1;
