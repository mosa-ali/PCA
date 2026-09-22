import assert from 'node:assert/strict';
import test from 'node:test';
import { InMemoryActionIdempotencyLedger, PLATFORM_EMERGENCY_DIRECTIVE_SCOPE } from '../../dist/familyrbac/ActionIdempotencyLedger.js';

const FAMILY_A = 'family-a';
const FAMILY_B = 'family-b';

test('getRecorded returns null for an unseen idempotency key', async () => {
  const ledger = new InMemoryActionIdempotencyLedger();
  assert.equal(await ledger.getRecorded(FAMILY_A, 'key-1'), null);
});

test('record then getRecorded round-trips the same outcome', async () => {
  const ledger = new InMemoryActionIdempotencyLedger();
  await ledger.record(FAMILY_A, 'key-1', { actionId: 'act-1', outcome: '{"verdict":"ALLOW"}' });
  assert.deepEqual(await ledger.getRecorded(FAMILY_A, 'key-1'), { actionId: 'act-1', outcome: '{"verdict":"ALLOW"}' });
});

test('one scope never sees, overwrites or evicts another scope entry', async () => {
  const ledger = new InMemoryActionIdempotencyLedger();
  await ledger.record(FAMILY_A, 'shared-key', { actionId: 'act-a', outcome: '{"verdict":"ALLOW"}' });
  await ledger.record(FAMILY_B, 'shared-key', { actionId: 'act-b', outcome: '{"verdict":"ALLOW"}' });

  // Same key, different owners: each keeps ITS OWN record. A flat key space
  // would have let the second write displace the first.
  assert.equal((await ledger.getRecorded(FAMILY_A, 'shared-key')).actionId, 'act-a');
  assert.equal((await ledger.getRecorded(FAMILY_B, 'shared-key')).actionId, 'act-b');
  assert.equal(await ledger.getRecorded('family-c', 'shared-key'), null);

  // And the platform scope the model-directive caller uses stays separate again.
  await ledger.record(PLATFORM_EMERGENCY_DIRECTIVE_SCOPE, 'shared-key', { actionId: 'directive-1', outcome: 'ROLLBACK_APPLIED' });
  assert.equal((await ledger.getRecorded(PLATFORM_EMERGENCY_DIRECTIVE_SCOPE, 'shared-key')).outcome, 'ROLLBACK_APPLIED');
  assert.equal((await ledger.getRecorded(FAMILY_A, 'shared-key')).actionId, 'act-a');
});

test('the first writer wins: a later record for the same (scope, key) never replaces the recorded outcome', async () => {
  const ledger = new InMemoryActionIdempotencyLedger();
  await ledger.record(FAMILY_A, 'key-1', { actionId: 'act-1', outcome: '{"verdict":"ALLOW"}' });
  await ledger.record(FAMILY_A, 'key-1', { actionId: 'act-2', outcome: '{"verdict":"DENY","reason":"ROLE_NOT_PERMITTED"}' });
  assert.deepEqual(await ledger.getRecorded(FAMILY_A, 'key-1'), { actionId: 'act-1', outcome: '{"verdict":"ALLOW"}' });
});

test('a zero-capacity ledger never retains anything', async () => {
  const ledger = new InMemoryActionIdempotencyLedger(0);
  await ledger.record(FAMILY_A, 'key-1', { actionId: 'act-1', outcome: 'x' });
  assert.equal(await ledger.getRecorded(FAMILY_A, 'key-1'), null);
});

test('a bounded ledger evicts the oldest entry once capacity is exceeded', async () => {
  const ledger = new InMemoryActionIdempotencyLedger(2);
  await ledger.record(FAMILY_A, 'key-1', { actionId: 'act-1', outcome: 'a' });
  await ledger.record(FAMILY_A, 'key-2', { actionId: 'act-2', outcome: 'b' });
  await ledger.record(FAMILY_A, 'key-3', { actionId: 'act-3', outcome: 'c' });
  assert.equal(await ledger.getRecorded(FAMILY_A, 'key-1'), null);
  assert.notEqual(await ledger.getRecorded(FAMILY_A, 'key-2'), null);
  assert.notEqual(await ledger.getRecorded(FAMILY_A, 'key-3'), null);
});

test('capacity is a global bound across scopes, not a per-scope bound', async () => {
  const ledger = new InMemoryActionIdempotencyLedger(2);
  await ledger.record(FAMILY_A, 'key-1', { actionId: 'act-1', outcome: 'a' });
  await ledger.record(FAMILY_B, 'key-2', { actionId: 'act-2', outcome: 'b' });
  await ledger.record(FAMILY_B, 'key-3', { actionId: 'act-3', outcome: 'c' });
  // The oldest entry overall goes, whichever scope it belonged to -- a
  // per-scope bound would not bound memory at all, since the number of scopes
  // is not something this class controls.
  assert.equal(await ledger.getRecorded(FAMILY_A, 'key-1'), null);
  assert.notEqual(await ledger.getRecorded(FAMILY_B, 'key-2'), null);
  assert.notEqual(await ledger.getRecorded(FAMILY_B, 'key-3'), null);
});
