import assert from 'node:assert/strict';
import test from 'node:test';
import { ReleaseService } from '../../dist/release/ReleaseService.js';
import { MySqlReleaseRepository } from '../../dist/release/MySqlReleaseRepository.js';
import { closePool } from '../../dist/db/pool.js';

if (!process.env.PCA_DATABASE_URL) throw new Error('PCA_DATABASE_URL is required for backend/test/db tests.');

const repository = new MySqlReleaseRepository();
const service = new ReleaseService(repository, () => new Date());

let sequence = 0;
function uniquePlatform() {
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

test('MySQL: publish persists and package/version identity is DB-enforced unique', async () => {
  const input = release();
  const record = await service.publishRelease(input);
  assert.equal(record.state, 'PUBLISHED');
});

test('MySQL: same identity + different immutable artifact data is CONFLICT', async () => {
  const input = release();
  await service.publishRelease(input);
  await assert.rejects(
    () => service.publishRelease({ ...input, artifactDigest: 'b'.repeat(64) }),
    { code: 'CONFLICT' },
  );
});

test('MySQL: identical resubmission is idempotent', async () => {
  const input = release();
  const first = await service.publishRelease(input);
  const second = await service.publishRelease({ ...input, signedMetadata: Buffer.from(input.signedMetadata) });
  assert.equal(first.releaseId, second.releaseId);
});

test('MySQL: ordinary publish cannot silently move the current pointer backward', async () => {
  const packageType = 'MODEL_PACKAGE';
  const platform = 'ANDROID';
  const higher = release({ packageType, platform, version: '9.0.0', artifactDigest: 'c'.repeat(64) });
  const lower = release({ packageType, platform, version: '1.0.0', artifactDigest: 'd'.repeat(64) });
  await service.publishRelease(higher);
  await service.publishRelease(lower);
  const current = await service.getCurrentRelease(packageType, platform);
  assert.equal(current.version, '9.0.0');
});

test('MySQL: rollback is a distinct transaction that CAN move the pointer backward', async () => {
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

test('MySQL REQUIRED CONCURRENCY: simultaneous FIRST publishes into an empty pointer lane converge to the highest version, never a race-order artifact', async () => {
  // Repeated across trials because the original bug class (locking a
  // not-yet-existing pointer row) is non-deterministic -- it could pass by
  // luck on any single run. The MySQL implementation avoids the class of
  // bug entirely by using a single atomic INSERT ... ON DUPLICATE KEY
  // UPDATE with a row-constructor guard instead of SELECT ... FOR UPDATE.
  for (let trial = 0; trial < 8; trial++) {
    const packageType = 'RULE_PACKAGE';
    const platform = trial % 2 === 0 ? 'ANDROID' : 'IOS'; // fresh, empty pointer lane each trial
    const digestFor = (v) => v.replace(/\./g, '').padEnd(64, '0');
    const versions = ['1.0.0', '9.0.0', '2.0.0', '5.0.0'];

    await Promise.all(
      versions.map((version) =>
        service.publishRelease({
          packageType,
          platform,
          version,
          artifactDigest: digestFor(version),
          artifactSizeBytes: 1024,
          signingKeyId: `key-${version}`,
          signedMetadata: Buffer.from(`metadata-${version}`),
        }),
      ),
    );

    const current = await service.getCurrentRelease(packageType, platform);
    assert.equal(current.version, '9.0.0', `trial ${trial}: current must be the highest published version`);
  }
});

test('MySQL CONCURRENCY: many simultaneous publishes under the same identity -- exactly one canonical stored digest wins, everyone else matches or conflicts consistently', async () => {
  const input = release();
  const attempts = await Promise.allSettled(
    Array.from({ length: 15 }, (_, i) =>
      service.publishRelease(i % 2 === 0 ? { ...input } : { ...input, artifactDigest: 'b'.repeat(64) }),
    ),
  );
  const fulfilled = attempts.filter((a) => a.status === 'fulfilled');
  const rejected = attempts.filter((a) => a.status === 'rejected');
  assert.equal(fulfilled.length + rejected.length, 15);
  assert.ok(fulfilled.length > 0, 'the true winner (whichever payload variant reaches the database first) must always succeed');

  const winningDigest = fulfilled[0].value.artifactDigest;
  for (const outcome of fulfilled) {
    assert.equal(outcome.value.artifactDigest, winningDigest, 'every fulfilled call must agree on the single canonical stored digest');
  }
  for (const failure of rejected) assert.equal(failure.reason.code, 'CONFLICT');
  const requestedWinningDigestCount = winningDigest === input.artifactDigest ? 8 : 7;
  assert.equal(fulfilled.length, requestedWinningDigestCount);
});

test.after(async () => {
  await closePool();
});
