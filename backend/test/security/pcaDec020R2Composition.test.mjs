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

test('R2 native production adapters remain explicitly fail-closed pending cross-client certification', async () => {
  const android = await readFile(path.resolve(backendRoot, '../android/app/src/main/java/org/pca/app/runtime/graph/PcaAppGraph.kt'), 'utf8');
  const ios = await readFile(path.resolve(backendRoot, '../ios/PCA/Transport/PCADeviceAPI.swift'), 'utf8');
  assert.match(android, /NotApprovedDeviceKeyPairGenerator/);
  assert.match(ios, /PendingPCADeviceProofProvider/);
  assert.match(ios, /cryptoActivationPending/);
});
