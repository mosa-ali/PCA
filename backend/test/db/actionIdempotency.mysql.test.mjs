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
import { ParentActionAuthorizationService } from '../../dist/familyrbac/ParentActionAuthorizationService.js';
import { FamilyTrustSetRoleResolver } from '../../dist/familyrbac/TrustSetRoleResolver.js';
import { defaultFamilyRbacPolicyConfig } from '../../dist/familyrbac/types.js';
import { InMemoryFamilyTrustSetStore } from '../../dist/familytrustset/InMemoryFamilyTrustSetStore.js';

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
  const results = await Promise.all(
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
  // Every writer is told the SAME thing -- the durable row -- not its own
  // verdict. This is the read-back under genuine concurrency rather than a
  // sequential duplicate, so `record`'s return value is exercised for real.
  // deepEqual rather than a field-by-field check on purpose: it is what caught
  // record() handing back a caller's object with the `requestFingerprint` key
  // simply absent while getRecorded() returned the key present-and-undefined.
  for (const result of results) assert.deepEqual(result, stored);
  // Pin the canonical shape explicitly, so "present but undefined" cannot come
  // back as a regression that deepEqual happens to see identically on both sides.
  for (const result of [...results, stored]) {
    assert.equal('requestFingerprint' in result, false, 'an absent fingerprint must be OMITTED, not present-with-undefined');
  }
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

// ---------------------------------------------------------------------------
// REAL-WRITER COVERAGE (SEC-1 regression, added after independent review)
//
// Every case above writes a SYNTHETIC 64-hex fingerprint. That is fine for
// proving the STORE behaves, but it silently assumes the WRITER produces such
// a value -- and it did not: ParentActionAuthorizationService emitted a raw
// "family|device|operation|kind|id" composite, the column's hex CHECK rejected
// every production write, and because a CHECK violation is not a duplicate-key
// error the ledger rethrew it, so authorize() rejected on every single call.
// The durability guarantee was therefore not delivered at all, and this entire
// file stayed green throughout. The two cases below close that hole by driving
// the REAL service into the REAL table, so writer and constraint can never
// drift apart unnoticed again.
// ---------------------------------------------------------------------------
const FP_T0 = new Date('2026-01-01T00:00:00Z');

function trustSetEpoch(familyId) {
  return {
    familyId,
    trustSetEpoch: 5,
    keyEpoch: 3,
    entries: [
      { deviceId: 'dev-owner', role: 'OWNER', dskKeyId: 'k1', dskPublicKey: 'pk1', dekKeyId: 'k2', dekPublicKey: 'pk2', status: 'ACTIVE' },
    ],
    issuedAt: FP_T0,
    supersedesEpoch: null,
    signature: 'sig',
  };
}

/** The real service under test, wired to whatever ledger the case supplies. */
function makeRealWriterService(ledger, familyId) {
  const store = new InMemoryFamilyTrustSetStore();
  store.setCurrentEpoch(trustSetEpoch(familyId));
  const service = new ParentActionAuthorizationService(
    new FamilyTrustSetRoleResolver(store),
    defaultFamilyRbacPolicyConfig,
    ledger,
    () => FP_T0,
  );
  return { service, store };
}

function realWriterRequest(familyId, actionId, idempotencyKey) {
  return {
    familyId,
    actorDeviceId: 'dev-owner',
    operation: 'EDIT_CHILD_POLICY',
    targetScope: { kind: 'FAMILY', id: familyId },
    issuedAt: FP_T0,
    expiresAt: new Date(FP_T0.getTime() + 15 * 60 * 1000),
    stepUp: null,
    idempotencyKey,
    actionId,
  };
}

test('REAL WRITER: the fingerprint ParentActionAuthorizationService actually produces is accepted by the durable column', async () => {
  const familyId = uniqueScope();
  const ledger = new MySqlActionIdempotencyLedger();
  const { service } = makeRealWriterService(ledger, familyId);

  const decision = await service.authorize(realWriterRequest(familyId, 'act-real-1', 'idem-real-1'));
  assert.equal(decision.verdict, 'ALLOW');

  const stored = await ledger.getRecorded(familyId, 'idem-real-1');
  assert.notEqual(stored, null, 'the real writer must leave a durable record behind');
  assert.match(stored.requestFingerprint, /^[0-9a-f]{64}$/, 'the writer must produce exactly what the column CHECK accepts');
  // The verdict the caller received is the verdict the ledger holds: if these
  // two could differ, replaying the action would not return what the caller saw.
  assert.deepEqual(JSON.parse(stored.outcome), decision);
  assert.equal(await rowCountForScope(familyId), 1);
});

test('REAL WRITER REPLAY across a restarted process returns the RECORDED verdict even after the trust set would now deny it', async () => {
  const familyId = uniqueScope();
  const first = await makeRealWriterService(new MySqlActionIdempotencyLedger(), familyId).service
    .authorize(realWriterRequest(familyId, 'act-real-2', 'idem-real-2'));
  assert.equal(first.verdict, 'ALLOW');

  // A second service with its OWN ledger instance is a restarted process. The
  // owner is demoted to VIEWER first, so a re-evaluation would now DENY -- and
  // returning that would hand the caller a different answer for an action the
  // server already authorized. Only a fingerprint that round-trips through the
  // column lets the replay be recognised as one at all.
  const restarted = makeRealWriterService(new MySqlActionIdempotencyLedger(), familyId);
  restarted.store.setCurrentEpoch({
    ...trustSetEpoch(familyId),
    trustSetEpoch: 6,
    entries: [
      { deviceId: 'dev-owner', role: 'VIEWER', dskKeyId: 'k1', dskPublicKey: 'pk1', dekKeyId: 'k2', dekPublicKey: 'pk2', status: 'ACTIVE' },
    ],
  });

  const replayed = await restarted.service.authorize(realWriterRequest(familyId, 'act-real-2', 'idem-real-2'));
  assert.deepEqual(replayed, first);
  const afterReplay = await new MySqlActionIdempotencyLedger().getRecorded(familyId, 'idem-real-2');
  assert.equal(afterReplay.actionId, 'act-real-2');
  assert.equal(afterReplay.outcome, JSON.stringify(first));
  assert.equal(await rowCountForScope(familyId), 1, 'a replay must never add a second row');
});

test('REAL WRITER: a raw composite fingerprint is REFUSED by the column, so hashing is mandatory rather than decorative', async () => {
  // The negative half of the case above, and the reason it cannot be repaired by
  // loosening the schema later. ParentActionAuthorizationService's fingerprint
  // exists to bind a cached outcome to a request SHAPE; the column is
  // deliberately hash-material (see the privacy classification file and
  // migration 0047), so a readable "family|device|operation|kind|id" composite
  // must be rejected rather than accommodated. If this ever starts passing, the
  // fix is to restore the hashing writer, not to widen the CHECK.
  const ledger = new MySqlActionIdempotencyLedger();
  const scope = uniqueScope();
  await assert.rejects(
    () => ledger.record(scope, uniqueKey(), recorded('act-raw', '{"verdict":"ALLOW"}', 'fam-1|dev-owner|EDIT_CHILD_POLICY|FAMILY|fam-1')),
    /fingerprint/i,
  );
  assert.equal(await rowCountForScope(scope), 0);
});

test('MULTI_INSTANCE read-back: the LOSER of the insert race is handed the WINNER entry, never its own', async () => {
  // Pins `return existing` on the ER_DUP_ENTRY path. Without it the loser is
  // told its own verdict, and AuthorizeRequest callers would then hold an answer
  // the durable record contradicts -- so this assertion is load-bearing, not
  // decoration: delete that return and this case fails.
  const scope = uniqueScope();
  const key = uniqueKey();
  const winner = recorded('act-winner', '{"verdict":"ALLOW"}', 'b'.repeat(64));
  const loser = recorded('act-loser', '{"verdict":"DENY","reason":"STEP_UP_FAILED"}', 'c'.repeat(64));

  const firstResult = await new MySqlActionIdempotencyLedger().record(scope, key, winner);
  const secondResult = await new MySqlActionIdempotencyLedger().record(scope, key, loser);

  assert.deepEqual(firstResult, winner, 'the winner is told what it just recorded');
  assert.deepEqual(secondResult, winner, 'the loser must be told what is DURABLE, not what it offered');
  assert.notDeepEqual(secondResult, loser);
  assert.equal(await rowCountForScope(scope), 1);
});

test('CAPACITY TRIM: the DELETE executes against real MySQL, the just-written row survives its own trim, and no failure is swallowed', async () => {
  // The trim is unreachable in every other case here: the default capacity is
  // 4096 rows, so `total <= capacity` is always true and the DELETE never runs.
  // A small capacity forces it onto the real server, which is the only way to
  // know the statement is accepted by MySQL 8.4 rather than merely plausible --
  // the failure mode is a logged-and-swallowed error leaving the table silently
  // unbounded. Put LAST in this file on purpose: the bound is global (see the
  // class doc comment), so this case necessarily trims rows written by others.
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => {
    warnings.push(args.map(String).join(' '));
  };
  let survivor;
  try {
    const ledger = new MySqlActionIdempotencyLedger(1); // capacity 1: the third write certainly overflows
    const scope = uniqueScope();
    survivor = { scope, key: uniqueKey() };
    await ledger.record(uniqueScope(), uniqueKey(), recorded('act-trim-1', 'a'));
    await ledger.record(uniqueScope(), uniqueKey(), recorded('act-trim-2', 'b'));
    await ledger.record(survivor.scope, survivor.key, recorded('act-trim-3', '{"verdict":"ALLOW"}'));
  } finally {
    console.warn = originalWarn;
  }

  assert.equal(
    warnings.filter((warning) => warning.includes('action_idempotency_ledger_trim_failed')).length,
    0,
    'a trim failure is logged, so any occurrence here means the DELETE was rejected by MySQL',
  );
  // created_at is DATETIME(3), so all three writes can share a millisecond and
  // the `keep` set is then a tie. The just-written row must survive regardless:
  // it is excluded by predicate, not by ordering.
  const stored = await new MySqlActionIdempotencyLedger().getRecorded(survivor.scope, survivor.key);
  assert.notEqual(stored, null, 'the row this call just wrote must never be the one its own trim deletes');
  assert.equal(stored.outcome, '{"verdict":"ALLOW"}');
});

test.after(async () => {
  await closePool();
});
