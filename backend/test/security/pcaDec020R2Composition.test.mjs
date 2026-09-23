import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('R2 production composition keeps the legacy bootstrap path out of production and keeps crypto fail-closed', async () => {
  const main = await readFile(path.join(backendRoot, 'src/main.ts'), 'utf8');
  assert.equal(main.includes('bootstrapFamilyAuthority('), false);
  assert.match(main, /new ParentGenesisService\(/);
  assert.match(main, /new MySqlGenesisTransactionRepository\(\)/);
  assert.match(main, /new RejectingDeviceSignatureVerifier\(\)/);
  assert.match(main, /new MySqlGenesisStepUpRepository\(\)/);
});

test('F-A/F2: main.ts derives genesisCryptographyAvailable from the ONE verifier instance the ceremony composes', async () => {
  const main = await readFile(path.join(backendRoot, 'src/main.ts'), 'utf8');
  // The verifier is named and is the SAME instance for both consumers: the
  // challenge service (proof verification) and ParentGenesisService
  // (anchor/attestation verification).
  assert.match(main, /const parentGenesisSignatureVerifier = new RejectingDeviceSignatureVerifier\(\);/);
  assert.match(main, /new GenesisChallengeService\(new MySqlGenesisChallengeRepository\(\), parentGenesisSignatureVerifier\)/);
  // The availability flag is DERIVED from that instance -- never a second
  // constant that can drift from the composition it describes.
  assert.match(main, /const genesisCryptographyAvailable = !\(parentGenesisSignatureVerifier instanceof RejectingDeviceSignatureVerifier\);/);
  // ... and threaded into the server composition.
  assert.match(main, /^    genesisCryptographyAvailable,$/m);

  const buildServer = await readFile(path.join(backendRoot, 'src/http/buildServer.ts'), 'utf8');
  assert.match(buildServer, /genesisCryptographyAvailable\?: boolean;/);
  assert.match(buildServer, /genesisCryptographyAvailable: deps\.genesisCryptographyAvailable,/);
});

test('E-3/A-2: main.ts passes the ONE request-challenge service into the authority engine as its sixth argument', async () => {
  const main = await readFile(path.join(backendRoot, 'src/main.ts'), 'utf8');
  // Issuance (routes) and consumption (the engine's proof branch) must share
  // one service: the engine refuses EVERY proof when none is composed
  // (FamilyOwnerAttestationChainEngine:307), so the production composition
  // must pass it explicitly.
  const engineMatch = main.match(/new FamilyOwnerAttestationChainEngine\(([\s\S]*?)\);/);
  assert.ok(engineMatch, 'main.ts must construct the authority chain engine');
  assert.match(engineMatch[1], /familyAuthorityRequestChallengeService,/);
  const challengeServiceIndex = main.indexOf('const familyAuthorityRequestChallengeService = new FamilyAuthorityRequestChallengeService(');
  const engineIndex = main.indexOf('const familyAuthorityChainEngine = new FamilyOwnerAttestationChainEngine(');
  assert.ok(challengeServiceIndex >= 0, 'the shared challenge service must be constructed in main.ts');
  assert.ok(engineIndex >= 0, 'the engine must be constructed in main.ts');
  assert.ok(
    challengeServiceIndex < engineIndex,
    'the challenge service must be declared BEFORE the engine that receives it (one instance for issuance and consumption)',
  );
  // The same instance must also reach the routes (issuance).
  assert.match(main, /^    familyAuthorityRequestChallengeService,$/m);
});

test('R2 native production adapters remain explicitly fail-closed pending cross-client certification', async () => {
  const android = await readFile(path.resolve(backendRoot, '../android/app/src/main/java/org/pca/app/runtime/graph/PcaAppGraph.kt'), 'utf8');
  const ios = await readFile(path.resolve(backendRoot, '../ios/PCA/Transport/PCADeviceAPI.swift'), 'utf8');
  assert.match(android, /NotApprovedDeviceKeyPairGenerator/);
  assert.match(ios, /PendingPCADeviceProofProvider/);
  assert.match(ios, /cryptoActivationPending/);
});
