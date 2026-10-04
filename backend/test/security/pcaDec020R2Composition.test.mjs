import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

async function exists(relative) {
  try {
    await access(path.join(backendRoot, relative));
    return true;
  } catch {
    return false;
  }
}

test('R2 production composition keeps the legacy bootstrap path out of production, composes no Parent Genesis ceremony (PCA-DEC-037), and keeps device crypto fail-closed', async () => {
  const main = await readFile(path.join(backendRoot, 'src/main.ts'), 'utf8');
  assert.equal(main.includes('bootstrapFamilyAuthority('), false);
  // PCA-DEC-037 removed Parent Genesis: none of its services or stores may be composed.
  assert.doesNotMatch(main, /ParentGenesisService|GenesisChallengeService|MySqlGenesis(Transaction|StepUp|Challenge)Repository|resolveGenesisSignatureVerifier/);
  // Device-signature verification elsewhere stays explicitly fail-closed.
  assert.match(main, /new RejectingDeviceSignatureVerifier\(\)/);
  for (const deleted of [
    'src/parentaccount/ParentGenesisService.ts',
    'src/parentaccount/GenesisChallengeService.ts',
    'src/parentaccount/genesisProtocol.ts',
    'src/parentaccount/genesisVerifierComposition.ts',
    'src/parentaccount/sessionBinding.ts',
    'src/parentaccount/genesisDeviceSigner.ts',
  ]) {
    assert.equal(await exists(deleted), false, `${deleted} must stay deleted`);
  }
});

test('PCA-DEC-037: main.ts validates the Parent MFA key realm at boot and composes ParentAccountService over the real ParentMfaService', async () => {
  const main = await readFile(path.join(backendRoot, 'src/main.ts'), 'utf8');
  const bootCheckIndex = main.indexOf('  loadParentMfaKeyring(process.env);');
  const mfaServiceIndex = main.indexOf('const parentMfaService = new ParentMfaService({ repository: new MySqlParentMfaRepository(), keyring: () => loadParentMfaKeyring(process.env) });');
  const accountServiceIndex = main.indexOf('const parentAccountService = new ParentAccountService({');
  assert.ok(bootCheckIndex >= 0, 'the MFA keyring is loaded eagerly at boot so a missing key fails loudly');
  assert.ok(mfaServiceIndex > bootCheckIndex, 'the MFA service is composed after the boot-time key check');
  assert.ok(accountServiceIndex > mfaServiceIndex, 'ParentAccountService receives the already-composed MFA service');
  const accountServiceBlock = main.slice(accountServiceIndex, main.indexOf('});', accountServiceIndex));
  assert.match(accountServiceBlock, /mfaService: parentMfaService,/);
  assert.match(accountServiceBlock, /familyMembershipRepository,/);
});

test('PCA-DEC-037: no genesisCryptographyAvailable flag survives in the composition or ServerDependencies', async () => {
  const main = await readFile(path.join(backendRoot, 'src/main.ts'), 'utf8');
  const buildServer = await readFile(path.join(backendRoot, 'src/http/buildServer.ts'), 'utf8');
  assert.doesNotMatch(main, /genesisCryptographyAvailable|parentGenesisSignatureVerifier/);
  assert.doesNotMatch(buildServer, /genesisCryptographyAvailable/);
});

test('PCA-DEC-037: main.ts no longer constructs the attestation-chain ENGINE, its commercial resolver, or the request-challenge service -- the chain STORE survives only for protection alerts', async () => {
  const main = await readFile(path.join(backendRoot, 'src/main.ts'), 'utf8');
  assert.doesNotMatch(main, /new FamilyOwnerAttestationChainEngine\(/);
  assert.doesNotMatch(main, /new AttestationChainFamilyCommercialAuthorityResolver\(/);
  assert.doesNotMatch(main, /new FamilyAuthorityRequestChallengeService\(/);
  assert.doesNotMatch(main, /^\s*familyAuthorityRequestChallengeService,\s*$/m, 'no request-challenge service may reach the routes');
  // ONE store instance, read by the protection-alert Owner-device resolver.
  assert.equal((main.match(/new MySqlFamilyAuthorityAttestationChainStore\(\)/g) ?? []).length, 1);
  assert.match(main, /const familyAuthorityAttestationChainStore = new MySqlFamilyAuthorityAttestationChainStore\(\);/);
  assert.match(main, /new MySqlOwnerParentDeviceResolver\(familyAuthorityAttestationChainStore\)/);
});

test('R2 native production adapters remain fail-closed: Android wires the Wave-6C hardware-attested DSK composition, iOS wires the Wave-6D Secure Enclave DSK behind ONE shared reference-typed provider', async () => {
  const android = await readFile(path.resolve(backendRoot, '../android/app/src/main/java/org/pca/app/runtime/graph/PcaAppGraph.kt'), 'utf8');
  const ios = await readFile(path.resolve(backendRoot, '../ios/PCA/Transport/PCADeviceAPI.swift'), 'utf8');
  const iosComposition = await readFile(path.resolve(backendRoot, '../ios/PCA/Application/PCAApplication.swift'), 'utf8');
  // Wave 6C: Android production crypto activation moved from the typed-failure
  // default generator to the REAL AndroidKeyStore provider -- whose
  // fail-closed boundary is the post-generation hardware assertion (software
  // keys are refused with a typed SecureKeyUnavailable, never silently
  // accepted) plus the single-flight trust-root coordinator (no optimistic
  // commit). The pre-approval default generator and every test double must
  // never be constructed by the production graph.
  assert.match(android, /AndroidKeystoreDskProvider\(\)/);
  assert.equal(android.includes('NotApprovedDeviceKeyPairGenerator'), false, 'the pre-approval default generator must not be constructed in production');
  assert.equal(android.includes('TestConformanceDeviceKeyPairGenerator'), false, 'test-only key generators must never reach the production composition');
  assert.match(android, /firstDeviceTrustRootCoordinator/);
  // Wave 6D: the iOS production composition activates the REAL Secure
  // Enclave DSK-backed provider (fail-closed until an attempt prepares its
  // keys) and shares ONE reference-typed instance between the enrollment
  // path and the runtime-sync session client. The typed pending provider
  // remains in the transport file as the non-Apple-platform fallback and
  // must never be constructed by the production composition.
  assert.match(iosComposition, /FirstDeviceDskDeviceProofProvider\(/);
  assert.match(iosComposition, /SecureEnclaveDskProvider\(\)/);
  assert.match(iosComposition, /persistedAttemptId: \{ firstDeviceRootStore\.current\(\)\?\.seed\.attemptId \}/);
  assert.match(iosComposition, /enrollmentKeys: enrollmentKeyPreparation,/);
  assert.match(iosComposition, /firstDeviceRootStore: firstDeviceRootStore,/);
  assert.match(iosComposition, /proofProvider: deviceProofProvider,/);
  assert.match(iosComposition, /proof: deviceProofProvider\)/);
  assert.doesNotMatch(
    iosComposition,
    /proof: PendingPCADeviceProofProvider\(\)/,
    'the permissive pending proof provider must not back the session client in production',
  );
  assert.doesNotMatch(
    iosComposition,
    /proofProvider: PendingPCADeviceProofProvider,/,
    'the permissive pending proof provider must not back the enrollment path in production',
  );
  // The typed fail-closed defaults remain available (and unchanged) for
  // platforms without Security.framework and for integration tests.
  assert.match(ios, /PendingPCADeviceProofProvider/);
  assert.match(ios, /cryptoActivationPending/);
});
