import assert from 'node:assert/strict';
import test from 'node:test';
import { InMemoryActionIdempotencyLedger } from '../../dist/familyrbac/ActionIdempotencyLedger.js';
import { InMemoryModelLifecycleRepository } from '../../dist/model/ModelLifecycleRepository.js';
import { ModelLifecycleService } from '../../dist/model/ModelLifecycleService.js';
import { PackageVerificationGate } from '../../dist/model/PackageVerificationGate.js';
import { LifecycleGatedClassifier } from '../../dist/ai/LifecycleGatedClassifier.js';

const NOW = new Date('2026-06-01T00:00:00Z');
const GOOD_DIGEST = 'a'.repeat(64);
const DEVICE = { platform: 'ANDROID', supportedFormats: ['LITERT_ANDROID'] };
const PURPOSE = 'phishing/scam supplementary signal';

function metadata(overrides = {}) {
  return {
    modelId: 'model-1',
    releaseId: 'MODEL_PACKAGE:SHARED:1.0.0',
    version: '1.0.0',
    formatRuntimeCompatibility: ['LITERT_ANDROID'],
    targetPlatform: 'ANDROID',
    supportedLocales: ['en'],
    purpose: PURPOSE,
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

function release() {
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
  };
}

function gate() {
  return new PackageVerificationGate({ verifySignature: async () => true }, { runSelfTest: async () => true }, () => NOW);
}

async function activateModel(service) {
  await service.registerDiscovered(metadata());
  await service.markDownloaded('model-1');
  await service.beginVerification('model-1');
  await service.completeVerification('model-1', gate(), release(), GOOD_DIGEST, DEVICE);
  await service.stage('model-1');
  return service.activate('model-1');
}

function capability() {
  return { modelId: 'model-1', supportedSurfaces: ['PHISHING_SCAM_SUPPLEMENTARY_SIGNAL'], supportedLocales: ['en'], requiresNetwork: false };
}

test('classify() returns MODEL_NOT_ACTIVE (never runs inference) when no model is active for this purpose', async () => {
  const repo = new InMemoryModelLifecycleRepository();
  const service = new ModelLifecycleService(repo, { verify: async () => true }, new InMemoryActionIdempotencyLedger(), () => NOW);
  let inferenceCalled = false;
  const classifier = new LifecycleGatedClassifier(capability(), service, PURPOSE, async () => {
    inferenceCalled = true;
    return { modelVersion: '1.0.0', labels: [], confidence: 'HIGH', disposition: 'ALLOW' };
  });

  const result = await classifier.classify({ surface: 'PHISHING_SCAM_SUPPLEMENTARY_SIGNAL', locale: 'en', content: 'x' });
  assert.equal(result.reason, 'MODEL_NOT_ACTIVE');
  assert.equal(inferenceCalled, false);
});

test('classify() runs inference once a model is ACTIVE for this purpose', async () => {
  const repo = new InMemoryModelLifecycleRepository();
  const service = new ModelLifecycleService(repo, { verify: async () => true }, new InMemoryActionIdempotencyLedger(), () => NOW);
  await activateModel(service);

  const classifier = new LifecycleGatedClassifier(capability(), service, PURPOSE, async (_input, activeModelId) => {
    assert.equal(activeModelId, 'model-1');
    return { modelVersion: '1.0.0', labels: ['PHISHING'], confidence: 'HIGH', disposition: 'BLOCK' };
  });

  const result = await classifier.classify({ surface: 'PHISHING_SCAM_SUPPLEMENTARY_SIGNAL', locale: 'en', content: 'x' });
  assert.equal(result.modelId, 'model-1');
  assert.equal(result.disposition, 'BLOCK');
  assert.equal(result.explanation.kind, 'SUPPLEMENTARY_RISK_SIGNAL');
});

test('the kill switch stops inference immediately: classify() returns MODEL_NOT_ACTIVE after disable()', async () => {
  const repo = new InMemoryModelLifecycleRepository();
  const service = new ModelLifecycleService(repo, { verify: async () => true }, new InMemoryActionIdempotencyLedger(), () => NOW);
  await activateModel(service);
  await service.disable({ directiveId: 'directive-1', action: 'DISABLE', modelId: 'model-1', rollbackToModelId: null, issuedAt: NOW, signature: 'sig' });

  let inferenceCalled = false;
  const classifier = new LifecycleGatedClassifier(capability(), service, PURPOSE, async () => {
    inferenceCalled = true;
    return { modelVersion: '1.0.0', labels: [], confidence: 'HIGH', disposition: 'ALLOW' };
  });
  const result = await classifier.classify({ surface: 'PHISHING_SCAM_SUPPLEMENTARY_SIGNAL', locale: 'en', content: 'x' });
  assert.equal(result.reason, 'MODEL_NOT_ACTIVE');
  assert.equal(inferenceCalled, false);
});

test('classify() rejects an unsupported surface without ever consulting the lifecycle service', async () => {
  const repo = new InMemoryModelLifecycleRepository();
  const service = new ModelLifecycleService(repo, { verify: async () => true }, new InMemoryActionIdempotencyLedger(), () => NOW);
  await activateModel(service);
  const classifier = new LifecycleGatedClassifier(capability(), service, PURPOSE, async () => {
    throw new Error('should not be called');
  });
  const result = await classifier.classify({ surface: 'EYE_DISTANCE_CALIBRATION', locale: 'en', content: 'x' });
  assert.equal(result.reason, 'UNSUPPORTED_SURFACE');
});

test('classify() rejects an unsupported locale', async () => {
  const repo = new InMemoryModelLifecycleRepository();
  const service = new ModelLifecycleService(repo, { verify: async () => true }, new InMemoryActionIdempotencyLedger(), () => NOW);
  await activateModel(service);
  const classifier = new LifecycleGatedClassifier(capability(), service, PURPOSE, async () => {
    throw new Error('should not be called');
  });
  const result = await classifier.classify({ surface: 'PHISHING_SCAM_SUPPLEMENTARY_SIGNAL', locale: 'ar', content: 'x' });
  assert.equal(result.reason, 'UNSUPPORTED_LOCALE');
});

test('a raw inference failure (e.g. airplane-mode-unrelated runtime crash) fails safely to RUNTIME_UNAVAILABLE, never throws out of classify()', async () => {
  const repo = new InMemoryModelLifecycleRepository();
  const service = new ModelLifecycleService(repo, { verify: async () => true }, new InMemoryActionIdempotencyLedger(), () => NOW);
  await activateModel(service);
  const classifier = new LifecycleGatedClassifier(capability(), service, PURPOSE, async () => {
    throw new Error('simulated runtime crash');
  });
  const result = await classifier.classify({ surface: 'PHISHING_SCAM_SUPPLEMENTARY_SIGNAL', locale: 'en', content: 'x' });
  assert.equal(result.reason, 'RUNTIME_UNAVAILABLE');
});

test('the capability object declares requiresNetwork: false -- local inference never requires a network call', () => {
  assert.equal(capability().requiresNetwork, false);
});

// PCA-16A correction (BACKEND_I18N_NOT_WIRED, section 6): REAL production-path integration
// tests -- classify() IS the real production call path (not translate() called directly).

test('AR ROUTE: classify() with presentationLocale "ar" returns a genuinely Arabic explanationText through the real classification path', async () => {
  const repo = new InMemoryModelLifecycleRepository();
  const service = new ModelLifecycleService(repo, { verify: async () => true }, new InMemoryActionIdempotencyLedger(), () => NOW);
  await activateModel(service);
  const classifier = new LifecycleGatedClassifier(capability(), service, PURPOSE, async () => ({
    modelVersion: '1.0.0',
    labels: ['PHISHING'],
    confidence: 'HIGH',
    disposition: 'BLOCK',
  }));

  const result = await classifier.classify({ surface: 'PHISHING_SCAM_SUPPLEMENTARY_SIGNAL', locale: 'en', content: 'x' }, 'ar');
  assert.equal(result.explanation.kind, 'SUPPLEMENTARY_RISK_SIGNAL');
  assert.equal(result.explanationText, 'تم وضع علامة عليه بواسطة إشارة خطر تكميلية لمراجعة الوالدين');
  assert.ok(/[؀-ۿ]/.test(result.explanationText), 'expected Arabic script, not an English fallback');
});

test('AR ROUTE: a MODEL_NOT_ACTIVE unavailable result also carries Arabic explanationText through the real path', async () => {
  const repo = new InMemoryModelLifecycleRepository();
  const service = new ModelLifecycleService(repo, { verify: async () => true }, new InMemoryActionIdempotencyLedger(), () => NOW);
  const classifier = new LifecycleGatedClassifier(capability(), service, PURPOSE, async () => {
    throw new Error('should not be called');
  });
  const result = await classifier.classify({ surface: 'PHISHING_SCAM_SUPPLEMENTARY_SIGNAL', locale: 'en', content: 'x' }, 'ar');
  assert.equal(result.reason, 'MODEL_NOT_ACTIVE');
  assert.equal(result.explanationText, 'تعذر إجراء التحليل على الجهاز لهذا العنصر');
});

test('EN ROUTE (regression): classify() with no presentationLocale argument (or explicit "en") still returns the exact prior English text', async () => {
  const repo = new InMemoryModelLifecycleRepository();
  const service = new ModelLifecycleService(repo, { verify: async () => true }, new InMemoryActionIdempotencyLedger(), () => NOW);
  await activateModel(service);
  const classifier = new LifecycleGatedClassifier(capability(), service, PURPOSE, async () => ({
    modelVersion: '1.0.0',
    labels: ['PHISHING'],
    confidence: 'HIGH',
    disposition: 'BLOCK',
  }));

  const defaulted = await classifier.classify({ surface: 'PHISHING_SCAM_SUPPLEMENTARY_SIGNAL', locale: 'en', content: 'x' });
  assert.equal(defaulted.explanationText, 'flagged by a supplementary risk signal for parent review');

  const explicit = await classifier.classify({ surface: 'PHISHING_SCAM_SUPPLEMENTARY_SIGNAL', locale: 'en', content: 'x' }, 'en');
  assert.equal(explicit.explanationText, 'flagged by a supplementary risk signal for parent review');
});

test('explanation.kind (stable machine key) is identical across presentation locales; only explanationText differs', async () => {
  const repo = new InMemoryModelLifecycleRepository();
  const service = new ModelLifecycleService(repo, { verify: async () => true }, new InMemoryActionIdempotencyLedger(), () => NOW);
  await activateModel(service);
  const classifier = new LifecycleGatedClassifier(capability(), service, PURPOSE, async () => ({
    modelVersion: '1.0.0',
    labels: ['PHISHING'],
    confidence: 'HIGH',
    disposition: 'BLOCK',
  }));
  const en = await classifier.classify({ surface: 'PHISHING_SCAM_SUPPLEMENTARY_SIGNAL', locale: 'en', content: 'x' }, 'en');
  const ar = await classifier.classify({ surface: 'PHISHING_SCAM_SUPPLEMENTARY_SIGNAL', locale: 'en', content: 'x' }, 'ar');
  assert.equal(en.explanation.kind, ar.explanation.kind);
  assert.notEqual(en.explanationText, ar.explanationText);
});

test('classify() never receives or returns the raw content -- the result never echoes the input payload', async () => {
  const repo = new InMemoryModelLifecycleRepository();
  const service = new ModelLifecycleService(repo, { verify: async () => true }, new InMemoryActionIdempotencyLedger(), () => NOW);
  await activateModel(service);
  const secretContent = { pageText: 'super secret raw page content', url: 'https://example.com/secret' };
  const classifier = new LifecycleGatedClassifier(capability(), service, PURPOSE, async () => ({
    modelVersion: '1.0.0',
    labels: ['PHISHING'],
    confidence: 'HIGH',
    disposition: 'BLOCK',
  }));
  const result = await classifier.classify({ surface: 'PHISHING_SCAM_SUPPLEMENTARY_SIGNAL', locale: 'en', content: secretContent });
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes('super secret'), false);
  assert.equal(serialized.includes('example.com'), false);
});
