// P1-04 (PCA full assessment, Wave 1) -- real disposable-MySQL coverage for
// MySqlActionIdempotencyLedger, the durable replacement for
// InMemoryActionIdempotencyLedger.
//
// WHAT THIS PROVES, AND WHY EACH CASE IS HERE. The defect being closed was not
// "the ledger forgets things" -- it was that losing the ledger silently reopens
// the replay window for an authorization the server had already answered, and
// that a per-process ledger made the guarantee per-instance. So the cases below
// are the ones that would have to hold for that claim to be true: durability
// across a fresh instance, first-writer-wins under a real INSERT race, scope
// isolation between owners, and fail-closed behaviour when the database refuses
// a write. A unit double with an in-memory Map cannot demonstrate ANY of them.
//
// DB-free equivalents live in test/familyrbac/ActionIdempotencyLedger.test.mjs;
// this file is the one that is evidence.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { getPool, closePool } from '../../dist/db/pool.js';
import { MySqlActionIdempotencyLedger } from '../../dist/familyrbac/MySqlActionIdempotencyLedger.js';
import { PLATFORM_EMERGENCY_DIRECTIVE_SCOPE } from '../../dist/familyrbac/ActionIdempotencyLedger.js';

if (!process.env.PCA_DATABASE_URL) throw new Error('PCA_DATABASE_URL is required for backend/test/db tests.');

/** Every case gets its own owner scope, so cases can never collide with each other or across runs. */
function uniqueScope() {
  return `test-family-${randomUUID()}`;
}

function uniqueKey() {
  return `idem-${randomUUID()}`;
}

function recorded(actionId, outcome, requestFingerprint = undefined) {
  return requestFingerprint === undefined ? { actionId, outcome } : { actionId, outcome, requestFingerprint };
}

async function rowCountForScope(scope) {
  const [rows] = await getPool().query('SELECT COUNT(*) AS n FROM action_idempotency_ledger WHERE scope = ?', [scope]);
  return rows[0].n;
}

test('MySQL: getRecorded returns null for an unseen (scope, key)', async () => {
  const ledger = new MySqlActionIdempotencyLedger();
  assert.equal(await ledger.getRecorded(uniqueScope(), 'never-recorded'), null);
});

test('MySQL: FIRST_USE -- record then getRecorded round-trips the outcome, its actionId and its fingerprint', async () => {
  const ledger = new MySqlActionIdempotencyLedger();
  const scope = uniqueScope();
  const key = uniqueKey();
  const fingerprint = 'a'.repeat(64);
  await ledger.record(scope, key, recorded('act-1', '{"verdict":"ALLOW"}', fingerprint));

  assert.deepEqual(await ledger.getRecorded(scope, key), {
    actionId: 'act-1',
    requestFingerprint: fingerprint,
    outcome: '{"verdict":"ALLOW"}',
  });
});

test('MySQL: an absent request fingerprint round-trips as ABSENT, never as the string "null"', async () => {
  // ModelLifecycleService's directive replay is the caller that never populates
  // it. A "null" string would make the call site compare against a value it
  // never wrote, so the cached record would never be recognised as a replay.
  const ledger = new MySqlActionIdempotencyLedger();
  const scope = uniqueScope();
  const key = uniqueKey();
  await ledger.record(scope, key, recorded('directive-1', 'ROLLBACK_APPLIED'));

  const stored = await ledger.getRecorded(scope, key);
  assert.equal(stored.requestFingerprint, undefined);
  assert.equal(stored.outcome, 'ROLLBACK_APPLIED');
});

test('MySQL: RESTART_SURVIVAL -- a brand-new ledger instance still sees the recorded authorization', async () => {
  const scope = uniqueScope();
  const key = uniqueKey();
  await new MySqlActionIdempotencyLedger().record(scope, key, recorded('act-restart', '{"verdict":"ALLOW"}'));

  // No shared in-process state whatsoever: this is the case the in-memory
  // ledger could not satisfy, and the reason the P1-04 finding existed.
  const afterRestart = await new MySqlActionIdempotencyLedger().getRecorded(scope, key);
  assert.equal(afterRestart.actionId, 'act-restart');
  assert.equal(afterRestart.outcome, '{"verdict":"ALLOW"}');
});

test('MySQL: MULTI_INSTANCE -- two independent instances share one durable record, and the second write never overwrites it', async () => {
  const instanceA = new MySqlActionIdempotencyLedger();
  const instanceB = new MySqlActionIdempotencyLedger();
  const scope = uniqueScope();
  const key = uniqueKey();

  await instanceA.record(scope, key, recorded('act-first', '{"verdict":"ALLOW"}'));
  await instanceB.record(scope, key, recorded('act-second', '{"verdict":"DENY","reason":"ROLE_NOT_PERMITTED"}'));

  // Both instances must agree, and must agree on the FIRST record: an
  // overwrite here would let whichever caller wrote last displace another
  // owner's recorded authorization.
  for (const instance of [instanceA, instanceB]) {
    const stored = await instance.getRecorded(scope, key);
    assert.equal(stored.actionId, 'act-first');
    assert.equal(stored.outcome, '{"verdict":"ALLOW"}');
  }
  assert.equal(await rowCountForScope(scope), 1);
});

test('MySQL: CROSS-FAMILY / CROSS-ACCOUNT ISOLATION -- one owner can neither read nor displace another owner\'s key', async () => {
  const ledger = new MySqlActionIdempotencyLedger();
  const familyA = uniqueScope();
  const familyB = uniqueScope();
  const sharedKey = 'same-key-both-families';
  const directiveScopeKey = 'same-key-both-families';

  await ledger.record(familyA, sharedKey, recorded('act-a', '{"verdict":"ALLOW"}'));
  await ledger.record(familyB, sharedKey, recorded('act-b', '{"verdict":"DENY","reason":"CROSS_FAMILY_TARGET"}'));
  await ledger.record(PLATFORM_EMERGENCY_DIRECTIVE_SCOPE, directiveScopeKey, recorded('directive-x', 'DISABLE_APPLIED'));

  assert.equal((await ledger.getRecorded(familyA, sharedKey)).outcome, '{"verdict":"ALLOW"}');
  assert.equal((await ledger.getRecorded(familyB, sharedKey)).outcome, '{"verdict":"DENY","reason":"CROSS_FAMILY_TARGET"}');
  assert.equal((await ledger.getRecorded(PLATFORM_EMERGENCY_DIRECTIVE_SCOPE, directiveScopeKey)).outcome, 'DISABLE_APPLIED');
  assert.equal(await ledger.getRecorded(uniqueScope(), sharedKey), null);
});

test('CONCURRENCY: concurrent records for the SAME (scope, key) resolve to exactly one durable row, never a mix', async () => {
  const scope = uniqueScope();
  const key = uniqueKey();
  const candidates = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

  // Eight writers, alternating instances on purpose: the arbiter must be the
  // database's own unique index, not any in-process serialisation these two
  // objects might happen to share.
  await Promise.all(
    candidates.map((candidate, index) =>
      new MySqlActionIdempotencyLedger().record(scope, key, recorded(`act-${candidate}`, `{"verdict":"${candidate}"}`)),
    ),
  );

  assert.equal(await rowCountForScope(scope), 1, 'exactly one row may exist for one (scope, key)');

  const stored = await new MySqlActionIdempotencyLedger().getRecorded(scope, key);
  assert.ok(
    candidates.some((candidate) => stored.outcome === `{"verdict":"${candidate}"}`),
    `the surviving outcome must be one of the writers' complete values, never a mix: got ${stored.outcome}`,
  );
  // And it must be STABLE -- a second read cannot disagree with the first.
  const reread = await new MySqlActionIdempotencyLedger().getRecorded(scope, key);
  assert.deepEqual(reread, stored);
});

test('MALFORMED_KEY = REJECT: a key the database refuses is surfaced, never silently accepted', async () => {
  const ledger = new MySqlActionIdempotencyLedger();
  const scope = uniqueScope();

  // Both shapes are outside the column's CHECK bounds. isPlausibleIdempotencyKey
  // rejects them at the route boundary long before this, so the point of this
  // case is the second line of defence: the ledger must not absorb them into a
  // "recorded" answer it never durably holds.
  await assert.rejects(() => ledger.record(scope, '', recorded('act-empty', '{"verdict":"ALLOW"}')));
  await assert.rejects(() => ledger.record(scope, 'k'.repeat(129), recorded('act-too-long', '{"verdict":"ALLOW"}')));
  assert.equal(await rowCountForScope(scope), 0);
});

test('DATABASE_FAILURE = FAIL CLOSED: a write the database rejects is propagated, so no caller can believe an unrecorded authorization is durable', async () => {
  const ledger = new MySqlActionIdempotencyLedger();
  const scope = uniqueScope();
  const key = uniqueKey();

  // `outcome` is NOT NULL. A swallowed error here is exactly the failure mode
  // this whole change exists to remove: the caller would report a recorded
  // authorization that a restart would lose.
  await assert.rejects(() => ledger.record(scope, key, { actionId: 'act-null-outcome', outcome: null }));
  assert.equal(await rowCountForScope(scope), 0);
  assert.equal(await ledger.getRecorded(scope, key), null);
});

test.after(async () => {
  await closePool();
});
