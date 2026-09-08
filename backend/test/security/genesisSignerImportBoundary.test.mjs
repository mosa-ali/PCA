// PCA-DEC-020 / PCA-ADD-IDENT-009: the ephemeral genesis-device signer (an Ed25519 signer that
// exists only so a freshly registered parent can bootstrap a family without a trusted device)
// is NOT a reviewed production crypto suite. It may sign a genesis attestation; its Ed25519
// verifier factory exists for tests of that chain only and must never become the verifier the
// runtime-sync / device-auth acceptance paths use -- those stay wired to the Rejecting*
// verifiers until the human security review lands. This static boundary test fails the suite
// the moment anything outside the parent-account service imports the module, or any production
// file calls the verifier factory.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '..', '..', 'src');
const ALLOWED_IMPORTERS = ['parentaccount/ParentAccountService.ts'];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

const rel = (p) => relative(SRC, p).replace(/\\/g, '/');

test('only ParentAccountService imports the ephemeral genesis device signer', () => {
  const importers = walk(SRC)
    .filter((p) => /from\s+['"][^'"]*genesisDeviceSigner(\.js)?['"]/.test(readFileSync(p, 'utf8')))
    .map(rel)
    .sort();
  assert.deepEqual(importers, ALLOWED_IMPORTERS);
});

test('the Ed25519 verifier factory has no production call site -- it is a test-only convenience, never a wired verifier', () => {
  const callers = walk(SRC)
    .filter((p) => rel(p) !== 'parentaccount/genesisDeviceSigner.ts' && /createEd25519DeviceSignatureVerifier/.test(readFileSync(p, 'utf8')))
    .map(rel);
  assert.deepEqual(callers, []);
});

test('no verifier or acceptance path references the genesis signer, and main.ts keeps the Rejecting verifiers wired', () => {
  const forbidden = walk(SRC)
    .filter((p) => /(deviceauth|runtime-sync|familyenvelope|familytrustset)[\\/]/.test(p) && /genesisDeviceSigner/.test(readFileSync(p, 'utf8')))
    .map(rel);
  assert.deepEqual(forbidden, []);
  const main = readFileSync(join(SRC, 'main.ts'), 'utf8');
  assert.match(main, /RejectingDeviceSignatureVerifier/);
  assert.match(main, /RejectingEnvelopeSignatureVerifier/);
  assert.doesNotMatch(main, /genesisDeviceSigner/);
  assert.doesNotMatch(main, /createEd25519DeviceSignatureVerifier/);
});
