// Wave 6D D-SEC local kill surface: structural, source-level guards for the
// iOS first-device trust root. These assertions are behavioral mutation
// targets -- each one dies the moment the corresponding property is edited
// away (software fallback introduced, provider identity duplicated, guard
// order changed, optimistic commit added, submission re-signed, keys minted
// on the signing path, etc.). The Swift RUNTIME behaviors are additionally
// enforced by the new XCTest suites (FirstDeviceCanonicalTests,
// P256DerSignatureTests, SecureEnclaveDskProviderTests,
// FirstDeviceDskDeviceProofProviderTests, IosAppAttestAdapterTests,
// FirstDeviceTrustRootCoordinatorTests), which run in the CI iOS job.
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const backendRoot = path.resolve(import.meta.dirname, '..', '..');
const repoRoot = path.resolve(backendRoot, '..');
const iosRoot = path.join(repoRoot, 'ios');
const firstDeviceDir = path.join(iosRoot, 'PCA', 'FirstDevice');

const readSource = (relative) => readFile(path.join(iosRoot, relative), 'utf8');

test('D-SEC-001: the Secure Enclave provider is the ONLY key source and has zero software-fallback surfaces', async () => {
  const source = await readSource(path.join('PCA', 'FirstDevice', 'SecureEnclaveDskProvider.swift'));
  // SE-only creation vocabulary is present.
  assert.match(source, /kSecAttrTokenIDSecureEnclave/);
  assert.match(source, /SecAccessControlCreateWithFlags/);
  assert.match(source, /\.privateKeyUsage/);
  assert.match(source, /SecureEnclave\.isAvailable/, 'the real availability check must be the production default');
  assert.match(source, /secureEnclaveUnavailable/);
  assert.match(source, /hardwareBindingVerificationFailed/);
  assert.match(source, /keyAliasConflict/);
  assert.match(source, /keyMaterialMissing/);
  // The binding assertion runs at generation, signing AND loading.
  const bindingGuards = (source.match(/isSecureEnclaveBound\(/g) ?? []).length;
  assert.ok(bindingGuards >= 4, `expected >= 4 isSecureEnclaveBound call sites (definition + generate + sign + load), found ${bindingGuards}`);
  // No software key path, no raw-key import, no weaker accessibility.
  assert.doesNotMatch(source, /P256\.Signing/);
  assert.doesNotMatch(source, /Curve25519/);
  assert.doesNotMatch(source, /SecKeyCreateWithData/);
  assert.doesNotMatch(source, /kSecAttrAccessibleWhenUnlocked(?!ThisDeviceOnly)/);
  assert.doesNotMatch(source, /SecKeyCreateDecryptedData/);
  // The provider NEVER generates keys inside the signing path. Scope every
  // count to the CLASS body (the protocol requirements legitimately declare
  // the same names above it).
  const classStart = source.indexOf('public final class SecureEnclaveDskProvider');
  assert.ok(classStart >= 0, 'the provider class must exist');
  const classBody = source.slice(classStart);
  assert.equal((classBody.match(/func generateSigningKeyPair\(attemptId:/g) ?? []).length, 1);
  assert.equal((classBody.match(/func generateEncryptionKeyPair\(attemptId:/g) ?? []).length, 1);
  assert.equal((classBody.match(/try generate\(role: \.dsk, attemptId: attemptId\)/g) ?? []).length, 1);
  assert.equal((classBody.match(/try generate\(role: \.dek, attemptId: attemptId\)/g) ?? []).length, 1);
  const signStart = classBody.indexOf('public func signCanonical');
  assert.ok(signStart >= 0, 'signing implementation must exist');
  const signBody = classBody.slice(signStart, classBody.indexOf('public func loadPublicKeyBase64', signStart));
  assert.ok(!signBody.includes('generateSigningKeyPair'), 'the signing path must never mint a replacement DSK');
  assert.ok(!signBody.includes('generateEncryptionKeyPair'), 'the signing path must never mint a replacement DEK');
  assert.ok(!signBody.includes('try generate('), 'the signing path must never enter the generation routine');
});

test('D-SEC-017: exactly ONE production provider instance backs both transports; the pending provider is never wired', async () => {
  const composition = await readSource(path.join('PCA', 'Application', 'PCAApplication.swift'));
  assert.equal((composition.match(/FirstDeviceDskDeviceProofProvider\(/g) ?? []).length, 1, 'exactly one shared provider instance');
  assert.match(composition, /proof: deviceProofProvider\)/, 'the session client must receive the shared instance');
  assert.match(composition, /proofProvider: deviceProofProvider,/);
  assert.match(composition, /persistedAttemptId: \{ firstDeviceRootStore\.current\(\)\?\.seed\.attemptId \}/);
  assert.doesNotMatch(composition, /proof: PendingPCADeviceProofProvider\(\)/);
  assert.doesNotMatch(composition, /proofProvider: PendingPCADeviceProofProvider,/);
  // The pending provider must never be listed in the shared-instance path.
  assert.equal((composition.match(/PendingPCADeviceProofProvider\(\)/g) ?? []).length, 1, 'pending provider only as the non-Apple-platform fallback');
});

test('enrollment ordering: attemptId BEFORE keygen, keys BEFORE the request, seed capture BEFORE any clear', async () => {
  const composition = await readSource(path.join('PCA', 'Application', 'PCAApplication.swift'));
  const indexOf = (needle) => {
    const index = composition.indexOf(needle);
    assert.ok(index >= 0, `missing expected occurrence: ${needle}`);
    return index;
  };
  const saveAttempt = indexOf('dependencies.attemptStore.saveAttempt(attempt)');
  const prepare = indexOf('prepareEnrollmentKeys(attemptId: attempt.attemptId)');
  const pubkeyGuard = indexOf('guard !dependencies.proofProvider.signingPublicKey.isEmpty');
  const request = indexOf('PCAEnrollmentBootstrapRequest(');
  const bootstrap = indexOf('dependencies.enrollmentClient.bootstrap(request)');
  const seedCapture = indexOf('captureFirstDeviceSeed(attempt: attempt, response: response)');
  const sweep = indexOf('dependencies.keyDeletion?.deleteOrphanedAttemptKeys(keepAttemptIds: keepAttemptIds)');
  assert.ok(saveAttempt < prepare, 'the attempt record must exist before any key is generated');
  assert.ok(prepare < pubkeyGuard, 'key preparation must precede the public-key read');
  assert.ok(pubkeyGuard < request, 'the request must read prepared public keys');
  assert.ok(request < bootstrap, 'the request must be built from prepared keys');
  assert.ok(bootstrap < seedCapture, 'the seed is captured from a successful bootstrap');
  assert.ok(seedCapture < sweep, 'over the freshly captured seed the sweep keeps this attempt');
  // The sweep keep-set is the UNION of this attempt and the durable root
  // record's attempt (the Wave-6C Stage-B parity fix): a committed root's
  // Secure Enclave keys can never be reclaimed by a later enrollment round.
  assert.match(composition, /keepAttemptIds\.insert\(persistedAttempt\)/);
  assert.match(composition, /firstDeviceRootStore\?\.current\(\)\?\.seed\.attemptId/);
  // The seed capture is blank-guarded (fail closed, never a wedged identity).
  assert.match(composition, /guard !dskPublicKey\.isEmpty, !dekPublicKey\.isEmpty else \{ return false \}/);

  // Seed persistence is owned by the root store: it writes, flushes and then
  // reads back the exact candidate. The same store preserves an existing
  // same-attempt ceremony and only replaces a different attempt at an
  // explicitly allowed terminal state.
  const rootStoreSource = await readSource(path.join('PCA', 'FirstDevice', 'FirstDeviceRootStore.swift'));
  const keychainStore = rootStoreSource.slice(rootStoreSource.indexOf('public final class KeychainFirstDeviceRootStore'));
  const captureStart = keychainStore.indexOf('public func captureSeed(_ candidate: FirstDeviceRootRecord');
  const captureEnd = keychainStore.indexOf('public func confirmDurable', captureStart);
  assert.ok(captureStart >= 0 && captureEnd > captureStart);
  const captureBody = keychainStore.slice(captureStart, captureEnd);
  assert.match(captureBody, /guard let existing else \{\s*return saveAndConfirmUnlocked\(candidate\)/);
  assert.match(captureBody, /existing\.seed\.attemptId == candidate\.seed\.attemptId/);
  assert.match(captureBody, /replacingTerminalStates\.contains\(existing\.state\)/);
  const saveAndConfirm = keychainStore.slice(keychainStore.indexOf('private func saveAndConfirmUnlocked'));
  assert.match(saveAndConfirm, /guard saveUnlocked\(record\) else \{ return false \}[\s\S]{0,80}flush\(\)[\s\S]{0,80}isCurrentUnlocked\(record\)/);

  const coordinator = await readSource(path.join('PCA', 'FirstDevice', 'FirstDeviceTrustRootCoordinator.swift'));
  // A successful capture precedes the single child-confirmation clear.
  assert.ok(composition.includes('captureFirstDeviceSeed(attempt: attempt, response: response)'));
  assert.equal(
    (composition.match(/dependencies\.attemptStore\.clearAttempt\(\)/g) ?? []).length,
    1,
    'the pending-attempt clear must exist exactly once, in the child-confirmation step',
  );
  assert.ok(!coordinator.includes('clearAttempt'), 'the coordinator must not touch the attempt store');
});

test('coordinator iron rules are structurally enforced (no optimistic commit, no re-challenge, no re-signing, no key minting)', async () => {
  const source = await readSource(path.join('PCA', 'FirstDevice', 'FirstDeviceTrustRootCoordinator.swift'));
  // Explicit FIFO gate wraps every public entry point.
  assert.match(source, /actor FirstDeviceSingleFlightGate/);
  const gateRuns = (source.match(/gate\.run \{/g) ?? []).length;
  assert.ok(gateRuns >= 4, `expected all four public entry points through gate.run, found ${gateRuns}`);
  // Committed is written ONLY after an ACCEPTED response or COMMITTED+ACCEPTED status.
  assert.match(source, /guard response\.status == "ACCEPTED"/);
  assert.match(source, /case "COMMITTED":[\s\S]*?if outcome\.outcome == "ACCEPTED"/);
  assert.match(source, /case \.rootCommitted:\s*\n\s*return \/\/ the root WAS committed/);
  // No re-challenge once a submission is persisted.
  assert.match(source, /if current\.submission != nil \{\s*\n\s*await refreshStatusLocked\(\)/);
  // Byte-stable replay: resubmit never builds or signs.
  const resubmit = source.indexOf('private func resubmitExactLocked');
  assert.ok(resubmit >= 0);
  const resubmitBody = source.slice(resubmit, resubmit + 400);
  assert.ok(!resubmitBody.includes('buildPayload'), 'a replay must never rebuild the payload');
  assert.ok(!resubmitBody.includes('signCanonical'), 'a replay must never re-sign');
  // Persist, read back, and confirm durability before the first send.
  const submit = source.indexOf('private func submitLocked()');
  const submitEnd = source.indexOf('private func resubmitExactLocked');
  assert.ok(submit >= 0 && submitEnd > submit);
  const submitBody = source.slice(submit, submitEnd);
  const persist = submitBody.indexOf('persistIfCurrent(expected: current, submitting)');
  const durableReadback = submitBody.indexOf('rootStore.confirmDurable(refreshed)');
  const send = submitBody.indexOf('await sendPayload(refreshed, payload: payload)');
  assert.ok(persist >= 0 && durableReadback > persist && send > durableReadback, 'the submission payload must be durably persisted and read back BEFORE the first send');
  assert.match(submitBody, /refreshed == submitting/);
  assert.match(submitBody, /refreshed\.submission == payload/);
  assert.match(submitBody, /rootStore\.current\(\) == refreshed/);
  // Never mints keys; signing goes through the injected material only.
  assert.doesNotMatch(source, /generateSigningKeyPair|generateEncryptionKeyPair/);
  assert.match(source, /keyMaterial\.signCanonical/);
  // Commit clears one-time material.
  assert.match(source, /committed\.seed\.attemptRecoveryToken = ""/);
  assert.match(source, /committed\.submission = nil/);
  // EXPIRED trims the persisted submission.
  assert.match(source, /var expired = current[\s\S]{0,40}expired\.submission = nil/);
});

test('App Attest adapter: fail-closed order, enrollment-stable clientDataHash, transcript hash, 16 KiB budget', async () => {
  const source = await readSource(path.join('PCA', 'FirstDevice', 'IosAppAttestAdapter.swift'));
  const support = source.indexOf('guard service.isSupported else');
  const generate = source.indexOf('service.generateKey()');
  assert.ok(support >= 0 && support < generate, 'unsupported devices must fail before any platform call');
  assert.match(source, /iosAttestationClientData\(/);
  assert.match(source, /FirstDeviceCanonical\.sha256\(Data\(attestationClientData\.utf8\)\)/);
  assert.match(source, /FirstDeviceCanonical\.sha256\(Data\(transcript\.utf8\)\)/);
  assert.match(source, /maxEvidenceBytes = 16_384/);
  assert.match(source, /\.sortedKeys/);
  assert.doesNotMatch(source, /print\(|NSLog|os_log/, 'no evidence or key material may ever be logged');
});

test('every FirstDevice Swift source is registered in the Xcode project (pbxproj completeness)', async () => {
  const pbxproj = await readFile(path.join(iosRoot, 'PCA.xcodeproj', 'project.pbxproj'), 'utf8');
  const files = await readdir(firstDeviceDir);
  const swiftFiles = files.filter((name) => name.endsWith('.swift'));
  assert.ok(swiftFiles.length >= 8, `expected the full FirstDevice package, found ${swiftFiles.length}`);
  for (const name of swiftFiles) {
    assert.ok(
      pbxproj.includes(`${name} in Sources`),
      `${name} is missing from the Xcode Sources phases`,
    );
  }
  const testDir = path.join(iosRoot, 'PCATests');
  const testFiles = (await readdir(testDir)).filter((name) => name.endsWith('.swift') && name.endsWith('Tests.swift'));
  assert.ok(testFiles.length >= 20, `expected the full PCATests suite, found ${testFiles.length}`);
  for (const name of [
    'FirstDeviceCanonicalTests.swift',
    'P256DerSignatureTests.swift',
    'SecureEnclaveDskProviderTests.swift',
    'FirstDeviceDskDeviceProofProviderTests.swift',
    'IosAppAttestAdapterTests.swift',
    'FirstDeviceTrustRootCoordinatorTests.swift',
  ]) {
    assert.ok(testFiles.includes(name), `${name} must exist under PCATests`);
    assert.ok(pbxproj.includes(`${name} in Sources`), `${name} is missing from the Xcode Sources phases`);
  }
});
