import assert from 'node:assert/strict';
import test from 'node:test';

import { validateAndroidAssetLinksManifest } from '../src/lib/assetLinks.mjs';

// A synthetic value used only to exercise the validator. No assetlinks.json is
// checked in or emitted until the actual production certificate is supplied.
const testFingerprint = Array(32).fill('A1').join(':');
const validStatement = [
  {
    relation: ['delegate_permission/common.handle_all_urls'],
    target: {
      namespace: 'android_app',
      package_name: 'org.pca.app',
      sha256_cert_fingerprints: [testFingerprint],
    },
  },
];

test('asset-links validator accepts only the PCA Android App Links statement shape', () => {
  const normalized = validateAndroidAssetLinksManifest(JSON.stringify(validStatement));
  assert.deepEqual(JSON.parse(normalized), validStatement);
  assert.ok(normalized.endsWith('\n'));
});

test('asset-links validator rejects missing, malformed, or wrong-app certificate data', () => {
  assert.throws(() => validateAndroidAssetLinksManifest('not json'), /valid JSON/);
  assert.throws(() => validateAndroidAssetLinksManifest('{}'), /exactly one/);
  assert.throws(() => validateAndroidAssetLinksManifest(JSON.stringify([
    { ...validStatement[0], target: { ...validStatement[0].target, package_name: 'com.example.other' } },
  ])), /org\.pca\.app/);
  assert.throws(() => validateAndroidAssetLinksManifest(JSON.stringify([
    { ...validStatement[0], target: { ...validStatement[0].target, sha256_cert_fingerprints: ['debug-placeholder'] } },
  ])), /SHA-256/);
  assert.throws(() => validateAndroidAssetLinksManifest(JSON.stringify([
    { ...validStatement[0], unexpected: true },
  ])), /only relation and target/);
});
