import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BlockDecisionStateService,
  InMemoryBlockDecisionStateRepository,
  SafeBrowserError,
} from '../../dist/safebrowser/BlockDecisionStateStore.js';
import {
  InMemoryParentUnblockRequestRepository,
  ParentUnblockRequestService,
  UnblockRequestError,
} from '../../dist/safebrowser/ParentUnblockRequestService.js';

function decision(overrides = {}) {
  return {
    domain: 'blocked.example',
    outcome: 'BLOCK',
    source: 'PARENT_DENYLIST',
    reasonCode: "blocked by your parent's block list",
    coverage: 'DOMAIN_ONLY',
    ...overrides,
  };
}

test('record stores the full URL/title, which only ever exists in the Safe Browser context', async () => {
  const service = new BlockDecisionStateService(new InMemoryBlockDecisionStateRepository(), () => new Date('2026-01-01T00:00:00Z'));
  const state = await service.record('fam-1', 'prof-1', 'https://blocked.example/page?x=1', 'Blocked Page', decision());
  assert.equal(state.url, 'https://blocked.example/page?x=1');
  assert.equal(state.pageTitle, 'Blocked Page');
  assert.equal(state.domain, 'blocked.example');
  assert.equal(state.requestable, true);
});

test('record marks a SECURITY_DENYLIST block as not requestable', async () => {
  const service = new BlockDecisionStateService(new InMemoryBlockDecisionStateRepository());
  const state = await service.record(
    'fam-1',
    'prof-1',
    'https://malware.example/',
    null,
    decision({ domain: 'malware.example', source: 'SECURITY_DENYLIST' }),
  );
  assert.equal(state.requestable, false);
});

test('repository snapshots block decision input and read results, preserving security decision state', async () => {
  const repository = new InMemoryBlockDecisionStateRepository();
  const service = new BlockDecisionStateService(repository, () => new Date('2026-01-01T00:00:00Z'));
  const returned = await service.record(
    'fam-1', 'prof-1', 'https://malware.example/path', 'Malware Page',
    decision({ domain: 'malware.example', source: 'SECURITY_DENYLIST' }),
  );

  returned.requestable = true;
  returned.familyId = 'foreign-family';
  returned.profileId = 'foreign-profile';
  returned.domain = 'safe.example';
  returned.url = 'https://safe.example/';
  returned.pageTitle = 'changed';
  returned.createdAt.setTime(0);

  const unblockService = new ParentUnblockRequestService(
    new InMemoryParentUnblockRequestRepository(), repository,
    () => new Date('2026-01-01T00:00:00Z'),
  );
  await assert.rejects(
    () => unblockService.submit('fam-1', 'prof-1', returned.id),
    (err) => err instanceof UnblockRequestError && err.code === 'NOT_REQUESTABLE',
  );

  const fromGet = await repository.get(returned.id);
  assert.equal(fromGet.familyId, 'fam-1');
  assert.equal(fromGet.profileId, 'prof-1');
  assert.equal(fromGet.domain, 'malware.example');
  assert.equal(fromGet.url, 'https://malware.example/path');
  assert.equal(fromGet.pageTitle, 'Malware Page');
  assert.equal(fromGet.requestable, false);
  assert.equal(fromGet.createdAt.toISOString(), '2026-01-01T00:00:00.000Z');

  fromGet.requestable = true;
  fromGet.createdAt.setTime(0);
  const fromList = (await repository.listRecentForFamily('fam-1', 'prof-1', 10))[0];
  assert.equal(fromList.requestable, false);
  assert.equal(fromList.createdAt.toISOString(), '2026-01-01T00:00:00.000Z');

  fromList.url = 'https://mutated.example/';
  fromList.createdAt.setTime(0);
  const retained = await repository.get(returned.id);
  assert.equal(retained.requestable, false);
  assert.equal(retained.url, 'https://malware.example/path');
  assert.equal(retained.createdAt.toISOString(), '2026-01-01T00:00:00.000Z');
});

test('record marks an ALLOW decision as not requestable', async () => {
  const service = new BlockDecisionStateService(new InMemoryBlockDecisionStateRepository());
  const state = await service.record(
    'fam-1',
    'prof-1',
    'https://ok.example/',
    null,
    decision({ domain: 'ok.example', outcome: 'ALLOW', source: 'DEFAULT' }),
  );
  assert.equal(state.requestable, false);
});

test('record rejects a URL whose host does not match the decision domain', async () => {
  const service = new BlockDecisionStateService(new InMemoryBlockDecisionStateRepository());
  await assert.rejects(
    () => service.record('fam-1', 'prof-1', 'https://other.example/', null, decision()),
    (err) => err instanceof SafeBrowserError && err.code === 'DOMAIN_MISMATCH',
  );
});

test('record rejects an implausible URL', async () => {
  const service = new BlockDecisionStateService(new InMemoryBlockDecisionStateRepository());
  await assert.rejects(
    () => service.record('fam-1', 'prof-1', '', null, decision()),
    (err) => err instanceof SafeBrowserError && err.code === 'INVALID_URL',
  );
});

test('listRecentForFamily returns only the requesting family\'s decisions, newest first', async () => {
  const repository = new InMemoryBlockDecisionStateRepository();
  const service = new BlockDecisionStateService(repository, () => new Date('2026-01-01T00:00:00Z'));
  await service.record('fam-1', 'prof-1', 'https://a.example/', null, decision({ domain: 'a.example' }));
  const service2 = new BlockDecisionStateService(repository, () => new Date('2026-01-02T00:00:00Z'));
  await service2.record('fam-1', 'prof-1', 'https://b.example/', null, decision({ domain: 'b.example' }));
  const otherFamilyService = new BlockDecisionStateService(repository, () => new Date('2026-01-03T00:00:00Z'));
  await otherFamilyService.record('fam-2', 'prof-9', 'https://c.example/', null, decision({ domain: 'c.example' }));

  const recent = await repository.listRecentForFamily('fam-1', null, 10);
  assert.equal(recent.length, 2);
  assert.equal(recent[0].domain, 'b.example');
  assert.equal(recent[1].domain, 'a.example');
});

test('listRecentForFamily narrows to one child when profileId is supplied', async () => {
  const repository = new InMemoryBlockDecisionStateRepository();
  const service = new BlockDecisionStateService(repository);
  await service.record('fam-1', 'prof-1', 'https://a.example/', null, decision({ domain: 'a.example' }));
  await service.record('fam-1', 'prof-2', 'https://b.example/', null, decision({ domain: 'b.example' }));

  const recent = await repository.listRecentForFamily('fam-1', 'prof-2', 10);
  assert.equal(recent.length, 1);
  assert.equal(recent[0].domain, 'b.example');
});

test('listRecentForFamily caps results at the supplied limit', async () => {
  const repository = new InMemoryBlockDecisionStateRepository();
  const service = new BlockDecisionStateService(repository);
  for (let i = 0; i < 5; i += 1) {
    await service.record('fam-1', 'prof-1', `https://site${i}.example/`, null, decision({ domain: `site${i}.example` }));
  }

  const recent = await repository.listRecentForFamily('fam-1', null, 2);
  assert.equal(recent.length, 2);
});

test('listRecentForFamily returns an empty array for a family with no recorded decisions', async () => {
  const repository = new InMemoryBlockDecisionStateRepository();
  const recent = await repository.listRecentForFamily('fam-empty', null, 10);
  assert.deepEqual(recent, []);
});
