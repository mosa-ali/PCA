import assert from 'node:assert/strict';
import test from 'node:test';
import { InMemoryWebRuleRepository } from '../../dist/web/WebRuleStore.js';
import { SignedRulePackageConsumer } from '../../dist/web/SignedRulePackageConsumer.js';

function pkg(overrides = {}) {
  return {
    packageVersion: '1.0.0',
    issuedAt: new Date('2026-01-01T00:00:00Z'),
    expiresAt: new Date('2026-06-01T00:00:00Z'),
    signature: 'sig',
    rules: [{ domain: 'malware.example', listType: 'DENY' }],
    ...overrides,
  };
}

function verifierThatSays(result) {
  return { verify: async () => result };
}

test('apply accepts a validly signed, newer package and writes SECURITY_DENYLIST rules', async () => {
  const repo = new InMemoryWebRuleRepository();
  const consumer = new SignedRulePackageConsumer(repo, verifierThatSays(true), () => new Date('2026-01-15T00:00:00Z'));
  const outcome = await consumer.apply(pkg());
  assert.equal(outcome.status, 'APPLIED');
  assert.equal(consumer.getActiveVersion(), '1.0.0');
  const matched = await repo.findMatching('any-family', 'malware.example');
  assert.equal(matched.length, 1);
  assert.equal(matched[0].source, 'SECURITY_DENYLIST');
});

test('apply rejects an invalid signature and leaves the previously active package untouched', async () => {
  const repo = new InMemoryWebRuleRepository();
  const consumer = new SignedRulePackageConsumer(repo, verifierThatSays(true), () => new Date('2026-01-15T00:00:00Z'));
  await consumer.apply(pkg());

  const badConsumer = new SignedRulePackageConsumer(repo, verifierThatSays(false), () => new Date('2026-02-15T00:00:00Z'));
  const outcome = await badConsumer.apply(pkg({ packageVersion: '2.0.0', rules: [{ domain: 'evil.example', listType: 'DENY' }] }));
  assert.equal(outcome.status, 'REJECTED_SIGNATURE');
  const matched = await repo.findMatching('any-family', 'evil.example');
  assert.equal(matched.length, 0);
  const stillThere = await repo.findMatching('any-family', 'malware.example');
  assert.equal(stillThere.length, 1);
});

test('apply rejects an expired package', async () => {
  const repo = new InMemoryWebRuleRepository();
  const consumer = new SignedRulePackageConsumer(repo, verifierThatSays(true), () => new Date('2026-12-01T00:00:00Z'));
  const outcome = await consumer.apply(pkg());
  assert.equal(outcome.status, 'REJECTED_EXPIRED');
});

test('apply rejects a stale/non-newer version (rollback protection)', async () => {
  const repo = new InMemoryWebRuleRepository();
  const consumer = new SignedRulePackageConsumer(repo, verifierThatSays(true), () => new Date('2026-01-15T00:00:00Z'));
  await consumer.apply(pkg({ packageVersion: '2.0.0' }));
  const outcome = await consumer.apply(pkg({ packageVersion: '1.5.0' }));
  assert.equal(outcome.status, 'REJECTED_STALE');
  assert.equal(outcome.activeVersion, '2.0.0');
});

test('apply rejects a malformed package without touching the repository', async () => {
  const repo = new InMemoryWebRuleRepository();
  const consumer = new SignedRulePackageConsumer(repo, verifierThatSays(true), () => new Date('2026-01-15T00:00:00Z'));
  const outcome = await consumer.apply(pkg({ rules: [{ domain: '192.168.1.1', listType: 'DENY' }] }));
  assert.equal(outcome.status, 'REJECTED_MALFORMED');
});

// ---------------------------------------------------------------------------
// PCA-NFR-053 (Writer65): does the consumer genuinely support rollback to a
// prior signed version? Two DISTINCT questions, verified separately below:
//
// (a) Can an operator ever legitimately recover a known-good prior RULESET
//     after a bad package was applied? YES -- by re-publishing the prior
//     content under a NEW, higher version number (the only way "rollback"
//     can ever work under a monotonic-version anti-downgrade scheme: the
//     version number itself never goes backward -- see the existing
//     REJECTED_STALE test above, which is deliberate anti-downgrade
//     protection, not a rollback bug).
//
// (b) Does reapplying prior-good content correctly REMOVE a bad rule the
//     intervening package introduced? NO, as currently implemented --
//     `apply()`'s repository writes are additive-only (it only ever calls
//     `repository.put(...)` for the new package's own rules; it never
//     calls `repository.remove(...)` for a domain that was present in the
//     previous active package but is absent from the new one). This is a
//     REAL, currently-uncovered gap: content-level rollback recovers
//     forward-compatible domains but does not retract a bad domain the
//     compromised/buggy intervening package added. Flagged here rather
//     than silently left uncovered -- see this lane's final report.
// ---------------------------------------------------------------------------

test('PCA-NFR-053 (a): content-level rollback via a NEW higher version number is genuinely supported -- reapplying prior-good content succeeds and is queryable again', async () => {
  const repo = new InMemoryWebRuleRepository();
  const clock = { now: new Date('2026-01-15T00:00:00Z') };
  const consumer = new SignedRulePackageConsumer(repo, verifierThatSays(true), () => clock.now);

  const goodOutcome = await consumer.apply(pkg({ packageVersion: '1.0.0', rules: [{ domain: 'known-good.example', listType: 'DENY' }] }));
  assert.equal(goodOutcome.status, 'APPLIED');

  // A "bad" package ships next (e.g. a compromised/erroneous feed update).
  const badOutcome = await consumer.apply(pkg({ packageVersion: '1.1.0', rules: [{ domain: 'bad-domain.example', listType: 'DENY' }] }));
  assert.equal(badOutcome.status, 'APPLIED');

  // Operator rolls back: re-publishes the ORIGINAL known-good content under
  // a fresh, higher version number (1.2.0 > 1.1.0) -- the only mechanically
  // possible way to recover prior content under this anti-downgrade scheme.
  const rollbackOutcome = await consumer.apply(pkg({ packageVersion: '1.2.0', rules: [{ domain: 'known-good.example', listType: 'DENY' }] }));
  assert.equal(rollbackOutcome.status, 'APPLIED');
  assert.equal(consumer.getActiveVersion(), '1.2.0');

  const stillPresent = await repo.findMatching('any-family', 'known-good.example');
  assert.equal(stillPresent.length, 1, 'the rolled-back-to content must be active again');
});

test('PCA-NFR-053 (b) KNOWN GAP: rollback does NOT retract a bad rule the intervening package introduced -- apply() is additive-only, never calls repository.remove()', async () => {
  const repo = new InMemoryWebRuleRepository();
  const clock = { now: new Date('2026-01-15T00:00:00Z') };
  const consumer = new SignedRulePackageConsumer(repo, verifierThatSays(true), () => clock.now);

  await consumer.apply(pkg({ packageVersion: '1.0.0', rules: [{ domain: 'known-good.example', listType: 'DENY' }] }));
  await consumer.apply(pkg({ packageVersion: '1.1.0', rules: [{ domain: 'bad-domain.example', listType: 'DENY' }] }));
  await consumer.apply(pkg({ packageVersion: '1.2.0', rules: [{ domain: 'known-good.example', listType: 'DENY' }] }));

  // EXPECTED-BUT-UNIMPLEMENTED full-rollback behavior would be for
  // 'bad-domain.example' to be gone once the operator has rolled back to a
  // package that no longer includes it. It is NOT gone -- this assertion
  // documents the actual (gap) behavior, not the desired one, so a future
  // fix intentionally flips this assertion rather than silently leaving
  // the gap uncovered.
  const badStillPresent = await repo.findMatching('any-family', 'bad-domain.example');
  assert.equal(badStillPresent.length, 1, 'KNOWN GAP: apply() never removes a domain absent from the new package -- true full-snapshot rollback is not yet implemented (see PCA-NFR-053 in this lane\'s final report)');
});
