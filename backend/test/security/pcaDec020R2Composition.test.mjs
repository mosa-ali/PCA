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

test('R2 native production adapters remain explicitly fail-closed pending cross-client certification', async () => {
  const android = await readFile(path.resolve(backendRoot, '../android/app/src/main/java/org/pca/app/runtime/graph/PcaAppGraph.kt'), 'utf8');
  const ios = await readFile(path.resolve(backendRoot, '../ios/PCA/Transport/PCADeviceAPI.swift'), 'utf8');
  assert.match(android, /NotApprovedDeviceKeyPairGenerator/);
  assert.match(ios, /PendingPCADeviceProofProvider/);
  assert.match(ios, /cryptoActivationPending/);
});
