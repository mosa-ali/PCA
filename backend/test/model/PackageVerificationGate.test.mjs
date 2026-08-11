import assert from 'node:assert/strict';
import test from 'node:test';
import { PackageVerificationGate } from '../../dist/model/PackageVerificationGate.js';

const NOW = new Date('2026-06-01T00:00:00Z');
const GOOD_DIGEST = 'a'.repeat(64);

function metadata(overrides = {}) {
  return {
    modelId: 'model-1',
    releaseId: 'MODEL_PACKAGE:SHARED:1.0.0',
    version: '1.0.0',
    formatRuntimeCompatibility: ['LITERT_ANDROID'],
    targetPlatform: 'ANDROID',
    supportedLocales: ['en'],
    purpose: 'phishing/scam supplementary signal',
    inScopeInputSurfaces: ['PHISHING_SCAM_SUPPLEMENTARY_SIGNAL'],
    prohibitedUses: [],
    sourceLicenseProvenanceRef: 'ref://p/1',
    datasetRightsAndChildDataExclusionRef: 'ref://d/1',
    targetLabels: ['PHISHING'],
    calibrationThresholdVersion: 'cal-1',
    expectedLatencyMs: 100,
    expectedMemoryBytes: 1024,
    falsePositiveNegativeEvidenceRef: 'ref://e/1',
    privacyImpactReviewRef: 'ref://pr/1',
    biasSafetyReviewRef: 'ref://b/1',
    redTeamFindingsRef: 'ref://rt/1',
    residualRiskAccepted: true,
    releaseChannel: 'PRODUCTION',
    rolloutPercentage: 100,
    expiresAt: new Date('2030-01-01T00:00:00Z'),
    rollbackTargetModelId: null,
    killSwitchSupported: true,
    ...overrides,
  };
}

function release(overrides = {}) {
  return {
    releaseId: 'MODEL_PACKAGE:SHARED:1.0.0',
    packageType: 'MODEL_PACKAGE',
    platform: 'SHARED',
    version: '1.0.0',
    artifactDigest: GOOD_DIGEST,
    artifactSizeBytes: 1024,
    signingKeyId: 'key-1',
    signedMetadata: Buffer.from('x'),
    minimumSupportedVersion: null,
    state: 'PUBLISHED',
    publishedAt: NOW,
    retiredAt: null,
    ...overrides,
  };
}

const DEVICE = { platform: 'ANDROID', supportedFormats: ['LITERT_ANDROID'] };

function gate({ signatureOk = true, selfTestOk = true } = {}) {
  return new PackageVerificationGate(
    { verifySignature: async () => signatureOk },
    { runSelfTest: async () => selfTestOk },
    () => NOW,
  );
}

test('a well-formed, correctly signed, self-tested package PASSES', async () => {
  const result = await gate().verify(metadata(), release(), GOOD_DIGEST, DEVICE);
  assert.deepEqual(result, { outcome: 'PASSED' });
});

test('bad signature fails closed with BAD_SIGNATURE', async () => {
  const result = await gate({ signatureOk: false }).verify(metadata(), release(), GOOD_DIGEST, DEVICE);
  assert.deepEqual(result, { outcome: 'FAILED', reason: 'BAD_SIGNATURE' });
});

test('wrong digest fails closed with WRONG_DIGEST', async () => {
  const result = await gate().verify(metadata(), release(), 'b'.repeat(64), DEVICE);
  assert.deepEqual(result, { outcome: 'FAILED', reason: 'WRONG_DIGEST' });
});

test('expired package fails closed with EXPIRED_PACKAGE', async () => {
  const result = await gate().verify(metadata({ expiresAt: new Date('2020-01-01T00:00:00Z') }), release(), GOOD_DIGEST, DEVICE);
  assert.deepEqual(result, { outcome: 'FAILED', reason: 'EXPIRED_PACKAGE' });
});

test('unsupported runtime fails closed with UNSUPPORTED_RUNTIME', async () => {
  const result = await gate().verify(metadata({ formatRuntimeCompatibility: ['COREML_IOS'] }), release(), GOOD_DIGEST, DEVICE);
  assert.deepEqual(result, { outcome: 'FAILED', reason: 'UNSUPPORTED_RUNTIME' });
});

test('unsupported format (empty compatibility list) fails closed with UNSUPPORTED_FORMAT', async () => {
  const result = await gate().verify(metadata({ formatRuntimeCompatibility: [] }), release(), GOOD_DIGEST, DEVICE);
  assert.deepEqual(result, { outcome: 'FAILED', reason: 'UNSUPPORTED_FORMAT' });
});

test('wrong platform fails closed with WRONG_PLATFORM', async () => {
  const result = await gate().verify(metadata({ targetPlatform: 'IOS', formatRuntimeCompatibility: ['COREML_IOS'] }), release(), GOOD_DIGEST, DEVICE);
  assert.deepEqual(result, { outcome: 'FAILED', reason: 'WRONG_PLATFORM' });
});

test('failed self-test fails closed with FAILED_SELF_TEST', async () => {
  const result = await gate({ selfTestOk: false }).verify(metadata(), release(), GOOD_DIGEST, DEVICE);
  assert.deepEqual(result, { outcome: 'FAILED', reason: 'FAILED_SELF_TEST' });
});

test('invalid provenance metadata (malformed shape) fails closed with INVALID_PROVENANCE_METADATA', async () => {
  const result = await gate().verify(metadata({ inScopeInputSurfaces: [] }), release(), GOOD_DIGEST, DEVICE);
  assert.deepEqual(result, { outcome: 'FAILED', reason: 'INVALID_PROVENANCE_METADATA' });
});

test('a prohibited-use declaration fails closed with PROHIBITED_USE_CASE_DECLARATION', async () => {
  const result = await gate().verify(metadata({ purpose: 'face identity recognition' }), release(), GOOD_DIGEST, DEVICE);
  assert.deepEqual(result, { outcome: 'FAILED', reason: 'PROHIBITED_USE_CASE_DECLARATION' });
});

test('a path-traversal-shaped package identifier fails closed with INVALID_PROVENANCE_METADATA', async () => {
  for (const badId of ['../../../etc/passwd', '..\\..\\windows\\system32', 'model/../../secret', 'a'.repeat(200)]) {
    const result = await gate().verify(metadata({ modelId: badId }), release(), GOOD_DIGEST, DEVICE);
    assert.equal(result.outcome, 'FAILED', `expected ${badId} to fail`);
    assert.equal(result.reason, 'INVALID_PROVENANCE_METADATA');
  }
});

test('the first failing check short-circuits: structural failure is reported even when signature/self-test would also fail', async () => {
  const result = await gate({ signatureOk: false, selfTestOk: false }).verify(metadata({ inScopeInputSurfaces: [] }), release(), GOOD_DIGEST, DEVICE);
  assert.equal(result.reason, 'INVALID_PROVENANCE_METADATA');
});
