import assert from 'node:assert/strict';
import test from 'node:test';
import { ReleaseService } from '../../dist/release/ReleaseService.js';
import { PostgresReleaseRepository } from '../../dist/release/PostgresReleaseRepository.js';
import { closePool } from '../../dist/db/pool.js';

if (!process.env.PCA_DATABASE_URL) throw new Error('PCA_DATABASE_URL is required for backend/test/db tests.');

const repository = new PostgresReleaseRepository();
const service = new ReleaseService(repository, () => new Date());

let sequence = 0;
function uniquePlatform() {
  // MODEL_PACKAGE/SHARED lets each test use an isolated (packageType, platform) pointer lane
  // by varying version, while distinct package types below isolate identity entirely.
  sequence += 1;
  return sequence;
}

function release(overrides = {}) {
  const n = uniquePlatform();
  return {
    packageType: 'RULE_PACKAGE',
    platform: 'SHARED',
    version: `1.0.${n}`,
    artifactDigest: 'a'.repeat(64),
    artifactSizeBytes: 1024,
    signingKeyId: `key-${n}`,
    signedMetadata: Buffer.from(`signed-metadata-${n}`),
    ...overrides,
  };
}

test('PG: publish persists and package/version identity is DB-enforced unique', async () => {
  const input = release();
  const record = await service.publishRelease(input);
  assert.equal(record.state, 'PUBLISHED');
});

test('PG: same identity + different immutable artifact data is CONFLICT', async () => {
  const input = release();
  await service.publishRelease(input);
  await assert.rejects(
    () => service.publishRelease({ ...input, artifactDigest: 'b'.repeat(64) }),
    { code: 'CONFLICT' },
  );
});

test('PG: identical resubmission is idempotent', async () => {
  const input = release();
  const first = await service.publishRelease(input);
  const second = await service.publishRelease({ ...input, signedMetadata: Buffer.from(input.signedMetadata) });
  assert.equal(first.releaseId, second.releaseId);
});

test('PG: ordinary publish cannot silently move the current pointer backward', async () => {
  const packageType = 'MODEL_PACKAGE';
  const platform = 'ANDROID';
  const higher = release({ packageType, platform, version: '9.0.0', artifactDigest: 'c'.repeat(64) });
  const lower = release({ packageType, platform, version: '1.0.0', artifactDigest: 'd'.repeat(64) });
  await service.publishRelease(higher);
  await service.publishRelease(lower);
  const current = await service.getCurrentRelease(packageType, platform);
  assert.equal(current.version, '9.0.0');
});

test('PG: rollback is a distinct transaction that CAN move the pointer backward', async () => {
  const packageType = 'MODEL_PACKAGE';
  const platform = 'IOS';
  await service.publishRelease(release({ packageType, platform, version: '1.0.0', artifactDigest: 'e'.repeat(64) }));
  await service.publishRelease(release({ packageType, platform, version: '2.0.0', artifactDigest: 'f'.repeat(64) }));
  let current = await service.getCurrentRelease(packageType, platform);
  assert.equal(current.version, '2.0.0');

  await service.rollbackToRelease(packageType, platform, '1.0.0');
  current = await service.getCurrentRelease(packageType, platform);
  assert.equal(current.version, '1.0.0');
});

test('PG CONCURRENCY: many simultaneous publishes under the same identity -- exactly 1 wins, rest match or conflict deterministically', async () => {
  const input = release();
  const attempts = await Promise.allSettled(
    Array.from({ length: 15 }, (_, i) =>
      service.publishRelease(i % 2 === 0 ? { ...input } : { ...input, artifactDigest: 'b'.repeat(64) }),
    ),
  );
  const fulfilled = attempts.filter((a) => a.status === 'fulfilled');
  const rejected = attempts.filter((a) => a.status === 'rejected');
  // even-index calls (identical) succeed/idempotent-match; odd-index calls (conflicting digest) are rejected
  assert.equal(fulfilled.length, 8);
  assert.equal(rejected.length, 7);
  for (const failure of rejected) assert.equal(failure.reason.code, 'CONFLICT');
});

test.after(async () => {
  await closePool();
});
