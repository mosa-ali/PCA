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
  const first = await ledger.record(FAMILY_A, 'key-1', { actionId: 'act-1', outcome: '{"verdict":"ALLOW"}' });
  await ledger.record(FAMILY_A, 'key-1', { actionId: 'act-2', outcome: '{"verdict":"DENY","reason":"ROLE_NOT_PERMITTED"}' });
  assert.deepEqual(first, { actionId: 'act-1', outcome: '{"verdict":"ALLOW"}' });
  assert.deepEqual(await ledger.getRecorded(FAMILY_A, 'key-1'), { actionId: 'act-1', outcome: '{"verdict":"ALLOW"}' });
});

test('record returns the entry that is durably present, not merely the one just offered', async () => {
  const ledger = new InMemoryActionIdempotencyLedger();

  // Nothing was recorded for this key, so what we offered is what is durable.
  const first = await ledger.record(FAMILY_A, 'key-1', { actionId: 'act-1', outcome: '{"verdict":"ALLOW"}' });
  assert.deepEqual(first, { actionId: 'act-1', outcome: '{"verdict":"ALLOW"}' });

  // A second, conflicting offer loses the first-writer-wins race. The caller
  // must BE TOLD that, because authorize() returns this value: handing back the
  // loser's own verdict would leave the caller holding an answer the ledger
  // contradicts. This is the unit-level half of the concurrent-duplicate fix.
  const loser = await ledger.record(FAMILY_A, 'key-1', { actionId: 'act-1', requestFingerprint: 'f'.repeat(64), outcome: '{"verdict":"DENY","reason":"ROLE_NOT_PERMITTED"}' });
  assert.deepEqual(loser, first);
  assert.deepEqual(await ledger.getRecorded(FAMILY_A, 'key-1'), first);
});

test('a non-positive capacity is rejected at construction rather than silently retaining nothing', () => {
  // A zero budget used to make record() a no-op, i.e. the ledger would serve
  // verdicts while protecting against nothing and never say so -- fail-open in
  // the one component whose contract is exactly-once authorization replay.
  for (const capacity of [0, -1, 1.5, Number.NaN]) {
    assert.throws(() => new InMemoryActionIdempotencyLedger(capacity), /capacity must be a positive integer/);
  }
  // The default and any explicit positive budget still construct.
  assert.doesNotThrow(() => new InMemoryActionIdempotencyLedger());
  assert.doesNotThrow(() => new InMemoryActionIdempotencyLedger(1));
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
  //
  // This is a REAL and DELIBERATE limitation, not a bug being pinned: one
  // family's write volume can therefore evict another family's -- or the
  // platform's -- replay record before its window is over, which degrades
  // exactly-once to at-most-once for the evicted key. Nobody should read the
  // fixed bound as a guarantee per scope. Retaining the right to that guarantee
  // needs an explicit replay-retention policy (window + bound + what a miss
  // means to each caller), which is a decisions-log item rather than something
  // this implementation may invent.
  assert.equal(await ledger.getRecorded(FAMILY_A, 'key-1'), null);
  assert.notEqual(await ledger.getRecorded(FAMILY_B, 'key-2'), null);
  assert.notEqual(await ledger.getRecorded(FAMILY_B, 'key-3'), null);
});
