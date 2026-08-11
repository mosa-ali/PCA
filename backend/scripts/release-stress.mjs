// Repeatable stress verification for concurrent same-identity release
// publication (backend/src/release). Not part of the default `test:db`
// run (it is deliberately slower/heavier -- 15-way concurrency x N
// trials against real MySQL) -- run explicitly via `npm run
// test:release-stress` whenever src/release or its MySQL repository
// changes, and as part of this baseline's clean-room verification.
//
// Required invariant per every trial: for N concurrent publishRelease
// calls under the SAME package/platform/version identity but two
// different immutable payload variants, exactly one payload variant
// wins; every call requesting the winning variant's exact payload
// succeeds (idempotently, if it wasn't itself the first to land); every
// call requesting the OTHER variant is a clean, typed CONFLICT -- never
// a raw/uncaught error, and never a miscount.
import assert from 'node:assert/strict';
import { ReleaseService } from '../dist/release/ReleaseService.js';
import { MySqlReleaseRepository } from '../dist/release/MySqlReleaseRepository.js';
import { closePool } from '../dist/db/pool.js';

if (!process.env.PCA_DATABASE_URL) throw new Error('PCA_DATABASE_URL is required for release-stress.mjs.');

const TRIALS = Number.parseInt(process.env.RELEASE_STRESS_TRIALS ?? '50', 10);
const CONCURRENCY = 15;

const service = new ReleaseService(new MySqlReleaseRepository());
let mismatches = 0;

for (let trial = 0; trial < TRIALS; trial++) {
  const input = {
    packageType: 'RULE_PACKAGE',
    platform: 'SHARED',
    version: `9.${trial}.0`,
    artifactDigest: 'a'.repeat(64),
    artifactSizeBytes: 1024,
    signingKeyId: `stress-key-${trial}`,
    signedMetadata: Buffer.from(`stress-signed-metadata-${trial}`),
  };

  const attempts = await Promise.allSettled(
    Array.from({ length: CONCURRENCY }, (_, i) =>
      service.publishRelease(i % 2 === 0 ? { ...input } : { ...input, artifactDigest: 'b'.repeat(64) }),
    ),
  );
  const fulfilled = attempts.filter((a) => a.status === 'fulfilled');
  const rejected = attempts.filter((a) => a.status === 'rejected');

  try {
    assert.equal(fulfilled.length + rejected.length, CONCURRENCY);
    assert.ok(fulfilled.length > 0, 'the true winner must always succeed');
    const winningDigest = fulfilled[0].value.artifactDigest;
    for (const outcome of fulfilled) {
      assert.equal(outcome.value.artifactDigest, winningDigest, 'every fulfilled call must agree on the single canonical stored digest');
    }
    for (const failure of rejected) {
      assert.equal(failure.reason?.code, 'CONFLICT', 'every rejection must be a typed CONFLICT, never a raw/uncaught error');
    }
    const requestedWinningDigestCount = winningDigest === input.artifactDigest
      ? Math.ceil(CONCURRENCY / 2)
      : Math.floor(CONCURRENCY / 2);
    assert.equal(fulfilled.length, requestedWinningDigestCount, 'no caller may receive a spurious CONFLICT/miscount because the alternate variant won the race');
    console.log(`trial ${trial}: OK (fulfilled=${fulfilled.length}, rejected=${rejected.length})`);
  } catch (error) {
    mismatches++;
    console.error(`trial ${trial}: MISMATCH -- ${error.message} (fulfilled=${fulfilled.length}, rejected=${rejected.length})`);
  }
}

await closePool();
console.log(`\n${TRIALS - mismatches}/${TRIALS} trials passed, ${mismatches} mismatches`);
if (mismatches > 0) process.exit(1);
