import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateReleaseIntegrity } from '../../dist/tamper/ReleaseIntegrityEvaluator.js';

const TRUSTED = new Set(['a'.repeat(64), 'b'.repeat(64)]);

test('an installed artifact whose digest is trusted, at/above the minimum version, is OK', () => {
  const verdict = evaluateReleaseIntegrity({ artifactDigest: 'a'.repeat(64), version: '2.0.0' }, TRUSTED, '1.0.0');
  assert.equal(verdict, 'OK');
});

test('an untrusted digest is DIGEST_MISMATCH regardless of version', () => {
  const verdict = evaluateReleaseIntegrity({ artifactDigest: 'c'.repeat(64), version: '9.9.9' }, TRUSTED, null);
  assert.equal(verdict, 'DIGEST_MISMATCH');
});

test('a legitimately-not-yet-updated install (older trusted digest) is still OK -- update lag is not tamper', () => {
  const verdict = evaluateReleaseIntegrity({ artifactDigest: 'b'.repeat(64), version: '1.0.0' }, TRUSTED, '1.0.0');
  assert.equal(verdict, 'OK');
});

test('a trusted digest but a version below the minimum supported is BELOW_MINIMUM_SUPPORTED_VERSION', () => {
  const verdict = evaluateReleaseIntegrity({ artifactDigest: 'a'.repeat(64), version: '0.9.0' }, TRUSTED, '1.0.0');
  assert.equal(verdict, 'BELOW_MINIMUM_SUPPORTED_VERSION');
});

test('digest mismatch is checked before (and independent of) the version floor', () => {
  const verdict = evaluateReleaseIntegrity({ artifactDigest: 'c'.repeat(64), version: '99.0.0' }, TRUSTED, '1.0.0');
  assert.equal(verdict, 'DIGEST_MISMATCH');
});

test('a null minimum supported version means no version floor is enforced', () => {
  const verdict = evaluateReleaseIntegrity({ artifactDigest: 'a'.repeat(64), version: '0.0.1' }, TRUSTED, null);
  assert.equal(verdict, 'OK');
});
