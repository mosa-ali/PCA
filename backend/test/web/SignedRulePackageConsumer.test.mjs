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
