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

const repoRoot = fileURLToPath(new URL('../../', import.meta.url)).replace(/\/$/, '').replace(/\//g, '\\');
const matrixPath = `${repoRoot}\\docs\\release_readiness\\external_gate_matrix.json`;
const registerPath = `${repoRoot}\\.agent-runtime\\manifests\\pca-r3-final\\R3_EXTERNAL_GATE_REGISTER.csv`;
const scriptPath = `${repoRoot}\\tooling\\release\\Invoke-ReleaseGateCheck.ps1`;

let failures = 0;
function ok(cond, label) {
  if (cond) { console.log(`PASS: ${label}`); } else { console.log(`FAIL: ${label}`); failures += 1; }
}

function runGateRaw(args, timeoutMs = 60000) {
  const started = Date.now();
  try {
    const out = execFileSync('pwsh', ['-NoProfile', '-NonInteractive', '-File', scriptPath, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: timeoutMs });
    return { exitCode: 0, out, ms: Date.now() - started, timedOut: false };
  } catch (err) {
    return { exitCode: err.status ?? 1, out: (err.stdout || '') + (err.stderr || ''), ms: Date.now() - started, timedOut: !!err.signal && err.status === null };
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
console.log('=== Section 3: -IgnoreExternalGates never produces a genuine READY, and never skips crypto/REAL_UAT ===');
{
  const ignoreAndroid = runGate('ANDROID_D', ['-IgnoreExternalGates']);
  ok(ignoreAndroid.exitCode !== 0, '-IgnoreExternalGates on ANDROID_D still exits non-zero today (crypto + REAL_UAT are real, still-open, still-enforced blockers)');
  ok(failuresText(ignoreAndroid).includes('PRODUCTION_CRYPTO_SUITE') && /REAL_UAT/.test(failuresText(ignoreAndroid)), '-IgnoreExternalGates does not skip the crypto or REAL_UAT signals');
  ok(ignoreAndroid.json.ownerGatesPendingCount === 0, '-IgnoreExternalGates genuinely skips the external gate matrix loop (0 owner gates evaluated)');
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
  ok(/invalid\/undeclared releaseScope token/.test(badScope.out), 'the failure message names the invalid releaseScope token defect');
  writeFileSync(matrixPath, originalMatrix, 'utf8');

  const matrixObj3 = JSON.parse(originalMatrix);
  matrixObj3.gates.push({
    id: 'TEST_FIXTURE_UNDECLARED_GATE_ONLY',
    status: 'BLOCKED',
    description: 'Transient test fixture gate with no register row -- must never persist past this test run.',
    owner: 'Test fixture (not a real owner)',
    evidence: null,
    releaseScope: ['PUBLIC_A'],
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
