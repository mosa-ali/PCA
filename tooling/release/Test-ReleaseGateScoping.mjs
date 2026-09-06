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
// and interleaves ANSI color codes -- confirmed empirically: a message can
// be split mid-phrase (e.g. a line break landing between two words with a
// reset code in between), which breaks a naive contiguous-phrase regex even
// though the underlying message text is complete and correct. Every regex
// check below is run against this stripped-and-unwrapped form: ANSI escapes
// removed, then line breaks collapsed to single spaces, so a phrase that
// happens to wrap across a terminal-width boundary still matches.
function normalizeForMatching(text) {
  return text.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '').replace(/\r?\n/g, ' ');
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
ok(results.PUBLIC_A.json.technicalGatesPass === true, 'PUBLIC_A: TECHNICAL_GATES_PASS is true (only owner/external gates remain open)');
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

  withMutatedGate('DEPLOYED_TLS_TERMINATION_CONFIG', (g) => { delete g.releaseScope; }, (r) => {
    ok(r.exitCode !== 0, 'a gate with releaseScope entirely REMOVED makes the whole script fail closed (never fails open)');
    ok(/missing the required property 'releaseScope'/.test(r.out), 'the failure names the missing releaseScope property');
  });
  withMutatedGate('DEPLOYED_TLS_TERMINATION_CONFIG', (g) => { g.releaseScope = null; }, (r) => {
    ok(r.exitCode !== 0, 'a gate with releaseScope = null makes the whole script fail closed (never fails open)');
    ok(/releaseScope' = null/.test(r.out), 'the failure names the null releaseScope');
  });
  withMutatedGate('DEPLOYED_TLS_TERMINATION_CONFIG', (g) => { g.releaseScope = 'PUBLIC_A'; }, (r) => {
    ok(r.exitCode !== 0, 'a gate with a SCALAR (bare string) releaseScope makes the whole script fail closed (never fails open)');
    ok(/non-array 'releaseScope'/.test(r.out), 'the failure names the non-array releaseScope');
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
      ok(/duplicate gate id/.test(dupResult.out), 'the failure names the duplicate gate id defect');
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
    ok(/case-to-target map identity drift/.test(missingResult.out) && /UAT-ENR-01/.test(missingResult.out), 'the failure names the map-identity drift and cites UAT-ENR-01');
    writeFileSync(uatPlanPath, originalPlan, 'utf8');

    const extra = originalPlan.replace(
      '### 4.15 Arabic / RTL',
      '### 4.16 Test fixture only\n- UAT-FIXTURE-99: transient test-only case, must never persist past this test run.\n\n### 4.15 Arabic / RTL',
    );
    ok(extra !== originalPlan, 'fixture sanity: adding a fixture-only case actually changed the plan text');
    writeFileSync(uatPlanPath, extra, 'utf8');
    const extraResult = runGateRaw(['-ReleaseTarget', 'ANDROID_D']);
    ok(extraResult.exitCode !== 0, 'an EXTRA case ID present in the plan but absent from the map fails closed');
    ok(/case-to-target map identity drift/.test(extraResult.out) && /UAT-FIXTURE-99/.test(extraResult.out), 'the failure names the map-identity drift and cites UAT-FIXTURE-99');
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
