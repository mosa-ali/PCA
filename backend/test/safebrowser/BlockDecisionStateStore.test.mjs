import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BlockDecisionStateService,
  InMemoryBlockDecisionStateRepository,
  SafeBrowserError,
} from '../../dist/safebrowser/BlockDecisionStateStore.js';

function decision(overrides = {}) {
  return {
    domain: 'blocked.example',
    outcome: 'BLOCK',
    source: 'PARENT_DENYLIST',
    reasonCode: "blocked by your family's block list",
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
