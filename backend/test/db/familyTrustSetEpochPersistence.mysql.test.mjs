// WAVE 5A -- durable Family Trust Set epoch persistence (migration 0060:
// `family_trust_set_epochs` + `family_epoch_floors`), exercised against a
// live disposable MySQL.
//
// WHAT THIS PROVES, AND WHY EACH CASE IS HERE. The defect being closed is
// that no production Family Trust Set store exists at all (main.ts: "no
// durable production store yet"; only an InMemory store). Durable
// persistence must not merely "remember" epochs -- it must make
// re-acceptance of a superseded epoch, a downgrade of key-epoch material,
// or a conflicting reuse of an already-accepted trust-set epoch number
// IMPOSSIBLE at the storage layer, because a caller that loses the floor
// can re-open the exact trust-on-first-use / anti-downgrade windows the
// acceptance engine exists to close. So the cases below are the ones that
// must hold for that claim: byte-exact readback, idempotent retry vs
// genuine conflict, stale trust-set and stale key rejections, full
// rollback attempts, cross-family isolation, REAL concurrent contenders
// (Promise.all against the same live database -- MySqlTrustSetEpochStore
// holds no in-process state, so nothing serializes contenders
// client-side), restart readback, malformed-input rejection before any
// SQL, the migration's own CHECK backstop, and the exact column surface.
//
// Executed by the disposable-DB lanes: registered in `test:db:inner` in the
// same commit that adds migration 0060 (which must run before this file).
// It requires PCA_DATABASE_URL like every file in this directory.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { getPool, closePool } from '../../dist/db/pool.js';
import { TrustSetEpochStoreError } from '../../dist/familytrustset/TrustSetEpochStore.js';
import { MySqlTrustSetEpochStore } from '../../dist/familytrustset/MySqlTrustSetEpochStore.js';
import { MySqlKeyEpochStore } from '../../dist/familytrustset/MySqlKeyEpochStore.js';
import { MySqlEpochFloorStore } from '../../dist/familytrustset/MySqlEpochFloorStore.js';

if (!process.env.PCA_DATABASE_URL) throw new Error('PCA_DATABASE_URL is required for backend/test/db tests.');

/** Every case gets its own family id, so cases can never collide with each other or across runs. */
function uniqueFamilyId() {
  return `fts-epoch-${randomUUID()}`;
}

/**
 * A `new Date()` truncated to whole seconds, so DATETIME round-trips are
 * exact under any supported column precision (the acceptance records carry
 * caller-supplied instants; precision loss would be a fixture artifact,
 * not a store defect).
 */
function stamp() {
  const value = new Date();
  value.setUTCMilliseconds(0);
  return value;
}

/** Byte-unique fixture per call: the signed bytes embed a fresh UUID, so two calls never collide except when a test deliberately clones one. */
function makeRecord(familyId, trustSetEpoch, keyEpoch, overrides = {}) {
  return {
    familyId,
    trustSetEpoch,
    keyEpoch,
    supersedesEpoch: trustSetEpoch > 1 ? trustSetEpoch - 1 : null,
    signedEpochBytes: Buffer.from(`signed-epoch|${familyId}|${trustSetEpoch}|${randomUUID()}`, 'utf8'),
    signature: `sig-${randomUUID()}`,
    signerKeyId: `key-${randomUUID()}`,
    signerDeviceId: `dev-${randomUUID()}`,
    issuedAt: stamp(),
    receivedAt: stamp(),
    ...overrides,
  };
}

async function countEpochRows(familyId, trustSetEpoch = null) {
  const [rows] =
    trustSetEpoch === null
      ? await getPool().query('SELECT COUNT(*) AS n FROM family_trust_set_epochs WHERE family_id = ?', [familyId])
      : await getPool().query('SELECT COUNT(*) AS n FROM family_trust_set_epochs WHERE family_id = ? AND trust_set_epoch = ?', [
          familyId,
          trustSetEpoch,
        ]);
  return Number(rows[0].n);
}

/**
 * CONCURRENCY OUTCOME RECORDER -- deliberately tiny. It fires every
 * contender through one `Promise.all` (genuinely concurrent transactions
 * on separate pooled connections) and returns the RAW outcome objects, in
 * contender order, unmodified and unwrapped, while also recording them
 * under `label` in CONCURRENCY_OUTCOMES so the coordinator lane can report
 * the CONCURRENT_* fields without re-deriving them. Do not reformat the
 * outcomes here.
 */
export const CONCURRENCY_OUTCOMES = {};

export async function recordConcurrentOutcomes(label, contenders) {
  const outcomes = await Promise.all(contenders.map((contender) => contender()));
  CONCURRENCY_OUTCOMES[label] = outcomes;
  return outcomes;
}

// ---------------------------------------------------------------------
// 1. FRESH APPEND + BYTE-EXACT READBACK
// ---------------------------------------------------------------------

test('APPEND: a fresh accepted epoch is APPENDED, and readLatestEpoch/listEpochs read the exact bytes back', async () => {
  const store = new MySqlTrustSetEpochStore();
  const familyId = uniqueFamilyId();
  const record = makeRecord(familyId, 1, 1);

  assert.deepEqual(await store.appendAcceptedEpoch(record), { outcome: 'APPENDED' });

  const latest = await store.readLatestEpoch(familyId);
  assert.notEqual(latest, null);
  assert.equal(latest.familyId, familyId);
  assert.equal(latest.trustSetEpoch, 1);
  assert.equal(latest.keyEpoch, 1);
  assert.equal(latest.supersedesEpoch, null);
  assert.ok(latest.signedEpochBytes.equals(record.signedEpochBytes), 'signed bytes must round-trip byte-equal');
  assert.equal(latest.signature, record.signature);
  assert.equal(latest.signerKeyId, record.signerKeyId);
  assert.equal(latest.signerDeviceId, record.signerDeviceId);
  assert.equal(latest.issuedAt.getTime(), record.issuedAt.getTime());
  assert.equal(latest.receivedAt.getTime(), record.receivedAt.getTime());

  const epochs = await store.listEpochs(familyId);
  assert.equal(epochs.length, 1);
  assert.equal(epochs[0].trustSetEpoch, 1);
  assert.ok(epochs[0].signedEpochBytes.equals(record.signedEpochBytes));
});

// ---------------------------------------------------------------------
// 2. IDEMPOTENT RETRY vs CONFLICT
// ---------------------------------------------------------------------

test('IDEMPOTENT_MATCH / CONFLICT: an identical retry appends nothing; a different-bytes reuse of the same trust-set epoch changes nothing', async () => {
  const store = new MySqlTrustSetEpochStore();
  const floorStore = new MySqlEpochFloorStore();
  const familyId = uniqueFamilyId();
  const record = makeRecord(familyId, 1, 2);

  assert.deepEqual(await store.appendAcceptedEpoch(record), { outcome: 'APPENDED' });
  const floorsAfterFirst = await floorStore.readFloors(familyId);
  assert.deepEqual(floorsAfterFirst, { minimumAcceptedTrustSetEpoch: 1, minimumAcceptedKeyEpoch: 2 });

  // Identical bytes + signature + keyEpoch -> a retry of an accepted epoch, not a second row.
  assert.deepEqual(await store.appendAcceptedEpoch({ ...record }), { outcome: 'IDEMPOTENT_MATCH' });
  assert.equal(await countEpochRows(familyId), 1, 'an idempotent retry must not add a row');

  // Same trust-set epoch number, different signed content -> CONFLICT, no state change.
  assert.deepEqual(await store.appendAcceptedEpoch(makeRecord(familyId, 1, 2)), { outcome: 'CONFLICT' });
  assert.equal(await countEpochRows(familyId), 1, 'a conflict must not add a row');
  assert.deepEqual(await floorStore.readFloors(familyId), floorsAfterFirst, 'a conflict must not move the floors');
  const latest = await store.readLatestEpoch(familyId);
  assert.ok(latest.signedEpochBytes.equals(record.signedEpochBytes), 'the originally accepted bytes must survive a conflict');
  assert.equal(latest.signature, record.signature);
});

// ---------------------------------------------------------------------
// 3. STALE TRUST-SET EPOCH
// ---------------------------------------------------------------------

test('STALE_TRUST_SET_EPOCH: a reuse of the current number conflicts; an older number is rejected as stale', async () => {
  const store = new MySqlTrustSetEpochStore();
  const floorStore = new MySqlEpochFloorStore();
  const familyId = uniqueFamilyId();

  assert.deepEqual(await store.appendAcceptedEpoch(makeRecord(familyId, 2, 1)), { outcome: 'APPENDED' });

  assert.deepEqual(await store.appendAcceptedEpoch(makeRecord(familyId, 2, 1)), { outcome: 'CONFLICT' });
  assert.deepEqual(await store.appendAcceptedEpoch(makeRecord(familyId, 1, 1)), {
    outcome: 'REJECTED_STALE',
    reason: 'STALE_TRUST_SET_EPOCH',
  });

  assert.equal(await countEpochRows(familyId), 1);
  const latest = await store.readLatestEpoch(familyId);
  assert.equal(latest.trustSetEpoch, 2);
  assert.deepEqual(await floorStore.readFloors(familyId), { minimumAcceptedTrustSetEpoch: 2, minimumAcceptedKeyEpoch: 1 });
});

// ---------------------------------------------------------------------
// 4. STALE KEY EPOCH + GREATEST FLOOR SEMANTICS
// ---------------------------------------------------------------------

test('STALE_KEY_EPOCH: a higher trust-set epoch with a rotated-back key epoch is rejected; equal key epoch is allowed and floors use GREATEST', async () => {
  const store = new MySqlTrustSetEpochStore();
  const floorStore = new MySqlEpochFloorStore();
  const familyId = uniqueFamilyId();

  assert.deepEqual(await store.appendAcceptedEpoch(makeRecord(familyId, 3, 2)), { outcome: 'APPENDED' });

  assert.deepEqual(await store.appendAcceptedEpoch(makeRecord(familyId, 4, 1)), {
    outcome: 'REJECTED_STALE',
    reason: 'STALE_KEY_EPOCH',
  });
  assert.equal(await countEpochRows(familyId), 1, 'a stale key epoch must not add a row');
  assert.deepEqual(await floorStore.readFloors(familyId), { minimumAcceptedTrustSetEpoch: 3, minimumAcceptedKeyEpoch: 2 });

  // Metadata-only epoch: trustSetEpoch advances, keyEpoch stays EQUAL -- allowed.
  const metadataOnly = makeRecord(familyId, 4, 2);
  assert.deepEqual(await store.appendAcceptedEpoch(metadataOnly), { outcome: 'APPENDED' });
  assert.deepEqual(await floorStore.readFloors(familyId), { minimumAcceptedTrustSetEpoch: 4, minimumAcceptedKeyEpoch: 2 });
  const latest = await store.readLatestEpoch(familyId);
  assert.equal(latest.trustSetEpoch, 4);
  assert.equal(latest.keyEpoch, 2);
  assert.ok(latest.signedEpochBytes.equals(metadataOnly.signedEpochBytes));
});

// ---------------------------------------------------------------------
// 5. ROLLBACK ATTEMPT
// ---------------------------------------------------------------------

test('ROLLBACK ATTEMPT: after (5,5), every lower submission is rejected and floors/latest never move backwards', async () => {
  const store = new MySqlTrustSetEpochStore();
  const floorStore = new MySqlEpochFloorStore();
  const familyId = uniqueFamilyId();

  const accepted = makeRecord(familyId, 5, 5);
  assert.deepEqual(await store.appendAcceptedEpoch(accepted), { outcome: 'APPENDED' });

  for (const [ts, key] of [
    [4, 5],
    [4, 6],
    [1, 1],
  ]) {
    assert.deepEqual(
      await store.appendAcceptedEpoch(makeRecord(familyId, ts, key)),
      { outcome: 'REJECTED_STALE', reason: 'STALE_TRUST_SET_EPOCH' },
      `ts=${ts} must never land below the accepted floor`,
    );
  }
  assert.deepEqual(await store.appendAcceptedEpoch(makeRecord(familyId, 5, 5)), { outcome: 'CONFLICT' });

  assert.equal(await countEpochRows(familyId), 1, 'no rollback attempt may create a row');
  assert.deepEqual(await floorStore.readFloors(familyId), { minimumAcceptedTrustSetEpoch: 5, minimumAcceptedKeyEpoch: 5 });
  const latest = await store.readLatestEpoch(familyId);
  assert.equal(latest.trustSetEpoch, 5);
  assert.ok(latest.signedEpochBytes.equals(accepted.signedEpochBytes), 'the accepted ts=5 row must remain the recorded one');
});

// ---------------------------------------------------------------------
// 6. CROSS-FAMILY ISOLATION
// ---------------------------------------------------------------------

test('CROSS-FAMILY ISOLATION: two families with identical epoch numbers append independently; floors and canonical key epoch are per family', async () => {
  const store = new MySqlTrustSetEpochStore();
  const floorStore = new MySqlEpochFloorStore();
  const keyEpochStore = new MySqlKeyEpochStore();
  const familyA = uniqueFamilyId();
  const familyB = uniqueFamilyId();

  assert.deepEqual(await store.appendAcceptedEpoch(makeRecord(familyA, 1, 1)), { outcome: 'APPENDED' });
  assert.deepEqual(await store.appendAcceptedEpoch(makeRecord(familyB, 1, 1)), { outcome: 'APPENDED' });

  // Family A advances; family B must not move.
  assert.deepEqual(await store.appendAcceptedEpoch(makeRecord(familyA, 2, 2)), { outcome: 'APPENDED' });

  assert.deepEqual(await floorStore.readFloors(familyA), { minimumAcceptedTrustSetEpoch: 2, minimumAcceptedKeyEpoch: 2 });
  assert.deepEqual(await floorStore.readFloors(familyB), { minimumAcceptedTrustSetEpoch: 1, minimumAcceptedKeyEpoch: 1 });
  assert.deepEqual(await keyEpochStore.readCanonicalKeyEpoch(familyA), { trustSetEpoch: 2, keyEpoch: 2 });
  assert.deepEqual(await keyEpochStore.readCanonicalKeyEpoch(familyB), { trustSetEpoch: 1, keyEpoch: 1 });

  // Family B still accepts the very same epoch numbers family A already used.
  assert.deepEqual(await store.appendAcceptedEpoch(makeRecord(familyB, 2, 2)), { outcome: 'APPENDED' });

  assert.equal(await countEpochRows(familyA), 2);
  assert.equal(await countEpochRows(familyB), 2);
  assert.equal((await store.readLatestEpoch(familyB)).familyId, familyB);
});

// ---------------------------------------------------------------------
// 7. REAL CONCURRENCY (Promise.all, live database as the arbiter)
// ---------------------------------------------------------------------

test('CONCURRENCY (a) CONCURRENT_HIGHER_HIGHER: simultaneous (2,2) and (3,3) resolve so the floor ends at 3 with exactly one latest=3', async () => {
  const store = new MySqlTrustSetEpochStore();
  const floorStore = new MySqlEpochFloorStore();
  const familyId = uniqueFamilyId();

  const [lowOutcome, highOutcome] = await recordConcurrentOutcomes('CONCURRENT_HIGHER_HIGHER', [
    () => store.appendAcceptedEpoch(makeRecord(familyId, 2, 2)),
    () => store.appendAcceptedEpoch(makeRecord(familyId, 3, 3)),
  ]);

  assert.deepEqual(highOutcome, { outcome: 'APPENDED' }, 'the higher contender must always land');
  assert.ok(
    lowOutcome.outcome === 'APPENDED' ||
      (lowOutcome.outcome === 'REJECTED_STALE' && lowOutcome.reason === 'STALE_TRUST_SET_EPOCH'),
    `unexpected ts=2 contender outcome: ${JSON.stringify(lowOutcome)}`,
  );

  assert.deepEqual(await floorStore.readFloors(familyId), { minimumAcceptedTrustSetEpoch: 3, minimumAcceptedKeyEpoch: 3 });
  assert.equal(await countEpochRows(familyId, 3), 1, 'exactly one ts=3 row may exist');
  const latest = await store.readLatestEpoch(familyId);
  assert.equal(latest.trustSetEpoch, 3);

  // Any REJECTED outcome left no partial row; any APPENDED outcome is durable.
  for (const [ts, outcome] of [
    [2, lowOutcome],
    [3, highOutcome],
  ]) {
    if (outcome.outcome === 'REJECTED_STALE') {
      assert.equal(await countEpochRows(familyId, ts), 0, `rejected ts=${ts} must leave no row`);
    }
    if (outcome.outcome === 'APPENDED') {
      assert.equal(await countEpochRows(familyId, ts), 1, `appended ts=${ts} must exist exactly once`);
    }
  }
});

test('CONCURRENCY (b) CONCURRENT_HIGHER_LOWER: after (4,4), simultaneous (5,5) and (3,6) -- the lower trust-set epoch can never land', async () => {
  const store = new MySqlTrustSetEpochStore();
  const floorStore = new MySqlEpochFloorStore();
  const familyId = uniqueFamilyId();

  assert.deepEqual(await store.appendAcceptedEpoch(makeRecord(familyId, 4, 4)), { outcome: 'APPENDED' });

  const [higherOutcome, lowerOutcome] = await recordConcurrentOutcomes('CONCURRENT_HIGHER_LOWER', [
    () => store.appendAcceptedEpoch(makeRecord(familyId, 5, 5)),
    () => store.appendAcceptedEpoch(makeRecord(familyId, 3, 6)),
  ]);

  assert.deepEqual(higherOutcome, { outcome: 'APPENDED' });
  assert.ok(
    (lowerOutcome.outcome === 'REJECTED_STALE' && lowerOutcome.reason === 'STALE_TRUST_SET_EPOCH') || lowerOutcome.outcome === 'CONFLICT',
    `the lower trust-set epoch must not land behind the higher contender: ${JSON.stringify(lowerOutcome)}`,
  );
  assert.equal(await countEpochRows(familyId, 3), 0, 'ts=3 must never land');
  assert.equal(await countEpochRows(familyId, 5), 1);

  // Final floors and latest reflect the higher trust-set epoch.
  assert.deepEqual(await floorStore.readFloors(familyId), { minimumAcceptedTrustSetEpoch: 5, minimumAcceptedKeyEpoch: 5 });
  assert.equal((await store.readLatestEpoch(familyId)).trustSetEpoch, 5);
});

test('CONCURRENCY (c) SAME_VALUE_RETRY: a concurrent identical-bytes retry pair never conflicts and leaves exactly one row', async () => {
  const store = new MySqlTrustSetEpochStore();
  const familyId = uniqueFamilyId();
  const record = makeRecord(familyId, 2, 2);

  const outcomes = await recordConcurrentOutcomes('SAME_VALUE_RETRY', [
    () => store.appendAcceptedEpoch(record),
    () => store.appendAcceptedEpoch({ ...record }),
  ]);

  for (const outcome of outcomes) {
    assert.ok(
      outcome.outcome === 'APPENDED' || outcome.outcome === 'IDEMPOTENT_MATCH',
      `an identical-bytes retry can never be ${JSON.stringify(outcome)}`,
    );
  }
  const appendedCount = outcomes.filter((outcome) => outcome.outcome === 'APPENDED').length;
  assert.ok(appendedCount <= 1, 'at most one contender may append');
  if (appendedCount === 1) {
    assert.equal(outcomes.filter((outcome) => outcome.outcome === 'IDEMPOTENT_MATCH').length, 1);
  }
  assert.equal(await countEpochRows(familyId), 1, 'exactly one durable row');
  const latest = await store.readLatestEpoch(familyId);
  assert.ok(latest.signedEpochBytes.equals(record.signedEpochBytes));
});

// ---------------------------------------------------------------------
// 8. RESTART / READBACK DURABILITY
// ---------------------------------------------------------------------

test('RESTART/READBACK DURABILITY: brand-new store instances (and raw pool queries) read identical values', async () => {
  const familyId = uniqueFamilyId();
  const first = makeRecord(familyId, 1, 1);
  const second = makeRecord(familyId, 2, 3);
  assert.deepEqual(await new MySqlTrustSetEpochStore().appendAcceptedEpoch(first), { outcome: 'APPENDED' });
  assert.deepEqual(await new MySqlTrustSetEpochStore().appendAcceptedEpoch(second), { outcome: 'APPENDED' });

  // "Process B": fresh instances, no shared in-process state whatsoever.
  const latest = await new MySqlTrustSetEpochStore().readLatestEpoch(familyId);
  assert.equal(latest.trustSetEpoch, 2);
  assert.equal(latest.keyEpoch, 3);
  assert.ok(latest.signedEpochBytes.equals(second.signedEpochBytes));
  assert.equal(latest.signature, second.signature);

  const epochs = await new MySqlTrustSetEpochStore().listEpochs(familyId);
  assert.deepEqual(epochs.map((epoch) => epoch.trustSetEpoch), [1, 2]);
  assert.ok(epochs[0].signedEpochBytes.equals(first.signedEpochBytes));

  assert.deepEqual(await new MySqlKeyEpochStore().readCanonicalKeyEpoch(familyId), { trustSetEpoch: 2, keyEpoch: 3 });
  assert.deepEqual(await new MySqlEpochFloorStore().readFloors(familyId), { minimumAcceptedTrustSetEpoch: 2, minimumAcceptedKeyEpoch: 3 });

  // A raw pool statement (its own connection) sees the same durable bytes.
  const [rows] = await getPool().query(
    'SELECT signed_epoch_bytes, signature FROM family_trust_set_epochs WHERE family_id = ? AND trust_set_epoch = 2',
    [familyId],
  );
  assert.equal(rows.length, 1);
  assert.ok(rows[0].signed_epoch_bytes.equals(second.signedEpochBytes));
  assert.equal(rows[0].signature, second.signature);
});

// ---------------------------------------------------------------------
// 9. MALFORMED INPUT -> INVALID_INPUT BEFORE ANY SQL
// ---------------------------------------------------------------------

test('INVALID_INPUT: malformed submissions throw before any SQL and create neither an epoch row nor a floors row', async () => {
  async function assertInvalidInput(mutate) {
    const store = new MySqlTrustSetEpochStore();
    const familyId = uniqueFamilyId();
    const record = mutate(makeRecord(familyId, 1, 1));
    const checkedFamilyId =
      typeof record.familyId === 'string' && record.familyId.length > 0 ? record.familyId : familyId;

    await assert.rejects(
      () => store.appendAcceptedEpoch(record),
      (error) => {
        assert.ok(
          error instanceof TrustSetEpochStoreError,
          `expected TrustSetEpochStoreError, got ${error?.constructor?.name ?? String(error)}`,
        );
        assert.equal(error.code, 'INVALID_INPUT');
        return true;
      },
    );
    assert.equal(await countEpochRows(checkedFamilyId), 0, 'malformed input must never create an epoch row');
    assert.equal(
      await new MySqlEpochFloorStore().readFloors(checkedFamilyId),
      null,
      'malformed input must never create a floors row (validation runs before any SQL)',
    );
  }

  await assertInvalidInput((record) => ({ ...record, trustSetEpoch: 0 }));
  await assertInvalidInput((record) => ({ ...record, trustSetEpoch: -1 }));
  await assertInvalidInput((record) => ({ ...record, trustSetEpoch: Number.NaN }));
  await assertInvalidInput((record) => ({ ...record, keyEpoch: 0 }));
  await assertInvalidInput((record) => ({ ...record, keyEpoch: -2 }));
  await assertInvalidInput((record) => ({ ...record, keyEpoch: Number.NaN }));
  await assertInvalidInput((record) => ({ ...record, signature: '' }));
  await assertInvalidInput((record) => ({ ...record, signature: 's'.repeat(513) }));
  await assertInvalidInput((record) => ({ ...record, signedEpochBytes: Buffer.alloc(300 * 1024, 7) }));
  await assertInvalidInput((record) => ({ ...record, signedEpochBytes: 'not-a-buffer' }));
  await assertInvalidInput((record) => ({ ...record, familyId: '' }));
  await assertInvalidInput((record) => ({ ...record, familyId: 'f'.repeat(129) }));
  await assertInvalidInput((record) => ({ ...record, signerKeyId: 'k'.repeat(65) }));
  await assertInvalidInput((record) => ({ ...record, signerDeviceId: '' }));
  await assertInvalidInput((record) => ({ ...record, supersedesEpoch: 0 }));
  await assertInvalidInput((record) => ({ ...record, supersedesEpoch: 5 }));
  await assertInvalidInput((record) => ({ ...record, issuedAt: new Date(Number.NaN) }));
  await assertInvalidInput((record) => ({ ...record, receivedAt: 'not-a-date' }));
});

// ---------------------------------------------------------------------
// 10. DATABASE-LEVEL BACKSTOP (CHECK constraints, bypassing the store)
// ---------------------------------------------------------------------

test('DATABASE BACKSTOP: a raw INSERT bypassing the store with trust_set_epoch=0 or key_epoch=0 is refused by the schema itself', async () => {
  function assertCheckConstraintViolation(error) {
    assert.ok(
      error?.code === 'ER_CHECK_CONSTRAINT_VIOLATED' || error?.errno === 3819,
      `expected MySQL error 3819 (CHECK constraint violated), got ${error?.code ?? String(error)}`,
    );
    return true;
  }

  const familyId = uniqueFamilyId();
  const insertSql = `INSERT INTO family_trust_set_epochs
      (family_id, trust_set_epoch, key_epoch, supersedes_epoch, signed_epoch_bytes, signature, signer_key_id, signer_device_id, issued_at, received_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
  const rawRow = (trustSetEpoch, keyEpoch) => [
    familyId,
    trustSetEpoch,
    keyEpoch,
    null,
    Buffer.from('raw-bypass', 'utf8'),
    'raw-sig',
    'raw-key',
    'raw-dev',
    new Date(),
    new Date(),
  ];

  await assert.rejects(() => getPool().query(insertSql, rawRow(0, 1)), assertCheckConstraintViolation);
  await assert.rejects(() => getPool().query(insertSql, rawRow(1, 0)), assertCheckConstraintViolation);

  assert.equal(await countEpochRows(familyId), 0, 'no raw row may survive a CHECK refusal');
});

// ---------------------------------------------------------------------
// 11. COLUMN SURFACE (privacy assertion)
// ---------------------------------------------------------------------

test('PRIVACY/SHAPE: the epoch table has exactly the ten declared columns and the mapped record exposes exactly the ten public fields', async () => {
  const [rows] = await getPool().query(
    `SELECT COLUMN_NAME AS column_name
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'family_trust_set_epochs'
     ORDER BY COLUMN_NAME`,
  );
  const actual = rows.map((row) => String(row.column_name));
  assert.equal(actual.length, 10, `family_trust_set_epochs must have exactly 10 columns, found ${actual.length}`);
  assert.deepEqual(actual, [
    'family_id',
    'issued_at',
    'key_epoch',
    'received_at',
    'signature',
    'signed_epoch_bytes',
    'signer_device_id',
    'signer_key_id',
    'supersedes_epoch',
    'trust_set_epoch',
  ]);

  const store = new MySqlTrustSetEpochStore();
  const familyId = uniqueFamilyId();
  assert.deepEqual(await store.appendAcceptedEpoch(makeRecord(familyId, 1, 1)), { outcome: 'APPENDED' });
  const record = await store.readLatestEpoch(familyId);
  assert.deepEqual(Object.keys(record).sort(), [
    'familyId',
    'issuedAt',
    'keyEpoch',
    'receivedAt',
    'signature',
    'signedEpochBytes',
    'signerDeviceId',
    'signerKeyId',
    'supersedesEpoch',
    'trustSetEpoch',
  ]);
});

// ---------------------------------------------------------------------
// 12. MACHINE-READABLE CONCURRENCY OUTCOMES (for the coordinator lane)
// ---------------------------------------------------------------------

test('CONCURRENCY OUTCOMES (machine-readable): raw outcomes are captured per scenario for the coordinator lane', async () => {
  for (const label of ['CONCURRENT_HIGHER_HIGHER', 'CONCURRENT_HIGHER_LOWER', 'SAME_VALUE_RETRY']) {
    assert.ok(Object.prototype.hasOwnProperty.call(CONCURRENCY_OUTCOMES, label), `${label} must have been recorded`);
  }
  console.log(`[familytrustset-epoch-persistence-concurrency-outcomes] ${JSON.stringify(CONCURRENCY_OUTCOMES)}`);
});

test.after(async () => {
  await closePool();
});
