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

test('R2 native production adapters remain explicitly fail-closed pending cross-client certification', async () => {
  const android = await readFile(path.resolve(backendRoot, '../android/app/src/main/java/org/pca/app/runtime/graph/PcaAppGraph.kt'), 'utf8');
  const ios = await readFile(path.resolve(backendRoot, '../ios/PCA/Transport/PCADeviceAPI.swift'), 'utf8');
  assert.match(android, /NotApprovedDeviceKeyPairGenerator/);
  assert.match(ios, /PendingPCADeviceProofProvider/);
  assert.match(ios, /cryptoActivationPending/);
});
