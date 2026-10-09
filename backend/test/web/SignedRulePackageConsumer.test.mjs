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



test('newer full snapshot retracts old security entries and preserves family rules', async () => {
  const repo = new InMemoryWebRuleRepository();
  await repo.put({ familyId: 'family', domain: 'parent.example', listType: 'ALLOW', source: 'PARENT_ALLOWLIST', createdAt: new Date() });
  const consumer = new SignedRulePackageConsumer(repo, verifierThatSays(true), () => new Date('2026-01-15'));
  await consumer.apply(pkg());
  await consumer.apply(pkg({ packageVersion: '1.1.0', rules: [{ domain: 'bad.example', listType: 'DENY' }] }));
  await consumer.apply(pkg({ packageVersion: '1.2.0' }));
  assert.equal((await repo.findMatching('family', 'bad.example')).length, 0);
  assert.equal((await repo.findMatching('family', 'malware.example')).length, 1);
  assert.equal((await repo.findMatching('family', 'parent.example')).length, 1);
  await consumer.apply(pkg({ packageVersion: '1.3.0', rules: [] }));
  assert.equal((await repo.findMatching('family', 'malware.example')).length, 0);
});

test('recreated consumer observes the repository rollback floor', async () => {
  const repo = new InMemoryWebRuleRepository();
  const make = () => new SignedRulePackageConsumer(repo, verifierThatSays(true), () => new Date('2026-01-15'));
  await make().apply(pkg({ packageVersion: '2.0.0' }));
  const consumer = make();
  assert.deepEqual(await consumer.apply(pkg()), { status: 'REJECTED_STALE', reason: 'NOT_NEWER_THAN_ACTIVE', activeVersion: '2.0.0' });
  assert.equal(consumer.getActiveVersion(), '2.0.0');
});

test('late verification cannot overwrite a newer committed snapshot', async () => {
  const repo = new InMemoryWebRuleRepository();
  let resolveOld;
  const older = new SignedRulePackageConsumer(repo, { verify: () => new Promise(resolve => { resolveOld = resolve; }) }, () => new Date('2026-01-15'));
  const newer = new SignedRulePackageConsumer(repo, verifierThatSays(true), () => new Date('2026-01-15'));
  const oldPending = older.apply(pkg());
  assert.equal((await newer.apply(pkg({ packageVersion: '2.0.0', rules: [{ domain: 'new.example', listType: 'DENY' }] }))).status, 'APPLIED');
  resolveOld(true);
  assert.equal((await oldPending).status, 'REJECTED_STALE');
  assert.equal((await repo.findMatching('family', 'new.example')).length, 1);
  assert.equal((await repo.findMatching('family', 'malware.example')).length, 0);
});

test('malformed timestamps, versions, allow entries and duplicate domains never reach verifier', async () => {
  const invalid = [null, pkg({ rules: null }), pkg({ issuedAt: new Date(NaN) }),
    pkg({ expiresAt: new Date(NaN) }), pkg({ issuedAt: new Date('2026-02-01') }),
    pkg({ packageVersion: '1.0.00' }), pkg({ packageVersion: '9007199254740992.0.0' }),
    pkg({ packageVersion: 'alpha' }), pkg({ rules: [{ domain: 'evil.example', listType: 'ALLOW' }] }),
    pkg({ rules: [{ domain: 'evil.example', listType: 'DENY' }, { domain: 'EVIL.EXAMPLE', listType: 'DENY' }] })];
  for (const candidate of invalid) {
    let verified = false;
    const consumer = new SignedRulePackageConsumer(new InMemoryWebRuleRepository(), { verify: async () => { verified = true; return true; } }, () => new Date('2026-01-15'));
    assert.equal((await consumer.apply(candidate)).status, 'REJECTED_MALFORMED');
    assert.equal(verified, false);
  }
});

test('signed security-package domains must already be canonical before verification', async () => {
  for (const domain of ['MALWARE.example', 'malware.example.', 'https://malware.example/path', 'münchen.example']) {
    let verified = false;
    const consumer = new SignedRulePackageConsumer(
      new InMemoryWebRuleRepository(),
      { verify: async () => { verified = true; return true; } },
      () => new Date('2026-01-15'),
    );
    assert.deepEqual(
      await consumer.apply(pkg({ rules: [{ domain, listType: 'DENY' }] })),
      { status: 'REJECTED_MALFORMED', reason: 'MALFORMED_PACKAGE' },
      domain,
    );
    assert.equal(verified, false, domain);
  }
});

test('captured signed input survives caller mutation while verification waits', async () => {
  const repo = new InMemoryWebRuleRepository();
  let resolveVerification;
  const candidate = pkg();
  const consumer = new SignedRulePackageConsumer(repo, { verify: () => new Promise(resolve => { resolveVerification = resolve; }) }, () => new Date('2026-01-15'));
  const pending = consumer.apply(candidate);
  candidate.packageVersion = '99.0.0';
  candidate.rules[0].domain = 'changed.example';
  resolveVerification(true);
  assert.equal((await pending).status, 'APPLIED');
  assert.equal(consumer.getActiveVersion(), '1.0.0');
  assert.equal((await repo.findMatching('family', 'changed.example')).length, 0);
});

test('package that expires during verification does not replace active snapshot', async () => {
  const repo = new InMemoryWebRuleRepository();
  let clock = new Date('2026-01-15');
  const consumer = new SignedRulePackageConsumer(repo, { verify: async () => { clock = new Date('2026-06-01'); return true; } }, () => clock);
  assert.equal((await consumer.apply(pkg())).status, 'REJECTED_EXPIRED');
  assert.equal((await repo.findMatching('family', 'malware.example')).length, 0);
});

test('atomic repository failure preserves prior snapshot and observed floor', async () => {
  const repo = new InMemoryWebRuleRepository();
  let unavailable = false;
  const consumer = new SignedRulePackageConsumer({ replaceSecurityPackageIfNewer: (...args) => {
    if (unavailable) throw new Error('storage unavailable');
    return repo.replaceSecurityPackageIfNewer(...args);
  } }, verifierThatSays(true), () => new Date('2026-01-15'));
  await consumer.apply(pkg());
  unavailable = true;
  await assert.rejects(consumer.apply(pkg({ packageVersion: '2.0.0', rules: [] })), /storage unavailable/);
  assert.equal(consumer.getActiveVersion(), '1.0.0');
  assert.equal((await repo.findMatching('family', 'malware.example')).length, 1);
});
