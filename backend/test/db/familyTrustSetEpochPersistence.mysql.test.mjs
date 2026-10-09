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
import { generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
import test from 'node:test';
import { getPool, closePool } from '../../dist/db/pool.js';
import { TrustSetEpochStoreError } from '../../dist/familytrustset/TrustSetEpochStore.js';
import { MySqlTrustSetEpochStore as MySqlTrustSetEpochStoreBase } from '../../dist/familytrustset/MySqlTrustSetEpochStore.js';
import { MySqlKeyEpochStore } from '../../dist/familytrustset/MySqlKeyEpochStore.js';
import { MySqlEpochFloorStore } from '../../dist/familytrustset/MySqlEpochFloorStore.js';
import { isFamilyEpochNumber, MAX_FAMILY_EPOCH } from '../../dist/familyepoch/bounds.js';
import { isPlausibleOpaqueId, isPlausibleSignature } from '../../dist/familytrustset/policy.js';

if (!process.env.PCA_DATABASE_URL) throw new Error('PCA_DATABASE_URL is required for backend/test/db tests.');

/** Every case gets its own family id, so cases can never collide with each other or across runs. */
function uniqueFamilyId() {
  return randomUUID();
}

const fixtureDeviceIds = new Map();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function fixtureDeviceId(familyId) {
  let deviceId = fixtureDeviceIds.get(familyId);
  if (!deviceId) {
    deviceId = randomUUID();
    fixtureDeviceIds.set(familyId, deviceId);
  }
  return deviceId;
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
    // device_public_keys.key_id is CHAR(36); use the same UUID shape as
    // production device DSK identifiers so the lifecycle fixture can bind
    // this persisted signer exactly.
    signerKeyId: randomUUID(),
    signerDeviceId: fixtureDeviceId(familyId),
    issuedAt: stamp(),
    receivedAt: stamp(),
    ...overrides,
  };
}

/** A unique valid P-256 point for the synthetic DSK row used by store-only tests. */
function makeTestDskPublicKey() {
  const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = pair.publicKey.export({ format: 'jwk' });
  const decode = (value) => Buffer.from(value, 'base64url');
  return Buffer.concat([Buffer.from([0x04]), decode(jwk.x), decode(jwk.y)]).toString('base64url');
}

async function insertActiveDsk(deviceId, keyId) {
  await getPool().query(
    `INSERT IGNORE INTO device_public_keys
       (device_id, key_id, key_purpose, public_key, status, created_at, revoked_at)
     VALUES (?, ?, 'DSK', ?, 'ACTIVE', ?, NULL)`,
    [deviceId, keyId, makeTestDskPublicKey(), new Date()],
  );
}

async function ensureActiveLifecycleFixture(record) {
  const recordShapeIsValid = Boolean(record) &&
    isPlausibleOpaqueId(record.familyId) &&
    isFamilyEpochNumber(record.trustSetEpoch, 1) &&
    isFamilyEpochNumber(record.keyEpoch, 1) &&
    (record.supersedesEpoch === null ||
      (isFamilyEpochNumber(record.supersedesEpoch, 1) && record.supersedesEpoch <= record.trustSetEpoch - 1)) &&
    Buffer.isBuffer(record.signedEpochBytes) && record.signedEpochBytes.length >= 1 && record.signedEpochBytes.length <= 262_144 &&
    isPlausibleSignature(record.signature) &&
    typeof record.signerKeyId === 'string' && record.signerKeyId.length > 0 && record.signerKeyId.length <= 64 &&
    typeof record.signerDeviceId === 'string' && record.signerDeviceId.length > 0 && record.signerDeviceId.length <= 64 &&
    record.issuedAt instanceof Date && !Number.isNaN(record.issuedAt.getTime()) &&
    record.receivedAt instanceof Date && !Number.isNaN(record.receivedAt.getTime());
  if (
    !recordShapeIsValid ||
    !UUID_RE.test(record.familyId) ||
    !UUID_RE.test(record.signerDeviceId)
  ) return;

  const now = new Date();
  await getPool().query(
    `INSERT IGNORE INTO families (family_id, family_reference_hash, created_at, status)
     VALUES (?, ?, ?, 'ACTIVE')`,
    [record.familyId, randomBytes(32), now],
  );
  await getPool().query(
    `INSERT IGNORE INTO devices (device_id, family_id, platform, status, created_at)
     VALUES (?, ?, 'ANDROID', 'ACTIVE', ?)`,
    [record.signerDeviceId, record.familyId, now],
  );
  await insertActiveDsk(record.signerDeviceId, record.signerKeyId);
}

// Existing persistence cases exercise the production store while keeping
// their normal fixture concise. New lifecycle-rejection tests below use the
// unwrapped base store and seed/mutate these rows explicitly.
class MySqlTrustSetEpochStore extends MySqlTrustSetEpochStoreBase {
  async appendAcceptedEpoch(record, expectedHead) {
    // Preserve the production method's synchronous input snapshot semantics
    // even though this test-only wrapper must await fixture creation.
    const expectedHeadSnapshot = expectedHead === null || expectedHead === undefined
      ? expectedHead
      : {
          ...expectedHead,
          signedEpochBytes: Buffer.isBuffer(expectedHead.signedEpochBytes)
            ? Buffer.from(expectedHead.signedEpochBytes)
            : expectedHead.signedEpochBytes,
        };
    if (expectedHead !== undefined) await ensureActiveLifecycleFixture(record);
    return super.appendAcceptedEpoch(record, expectedHeadSnapshot);
  }
}

function expectedHeadFrom(record) {
  return record === null
    ? null
    : {
        trustSetEpoch: record.trustSetEpoch,
        keyEpoch: record.keyEpoch,
        signedEpochBytes: Buffer.from(record.signedEpochBytes),
        signature: record.signature,
  };
}

async function insertEpochWithoutFloors(record) {
  await getPool().query(
    `INSERT INTO family_trust_set_epochs
       (family_id, trust_set_epoch, key_epoch, supersedes_epoch, signed_epoch_bytes, signature, signer_key_id, signer_device_id, issued_at, received_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      record.familyId,
      record.trustSetEpoch,
      record.keyEpoch,
      record.supersedesEpoch,
      record.signedEpochBytes,
      record.signature,
      record.signerKeyId,
      record.signerDeviceId,
      record.issuedAt,
      record.receivedAt,
    ],
  );
}

async function appendAgainstCurrent(store, record) {
  const current = await store.readLatestEpoch(record.familyId);
  return store.appendAcceptedEpoch(record, expectedHeadFrom(current));
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

async function insertFamilyAndActiveDevice(familyId, deviceId, signerKeyId) {
  const now = new Date();
  await getPool().query(
    `INSERT INTO families (family_id, family_reference_hash, created_at, status)
     VALUES (?, ?, ?, 'ACTIVE')`,
    [familyId, randomBytes(32), now],
  );
  await getPool().query(
    `INSERT INTO devices (device_id, family_id, platform, status, created_at)
     VALUES (?, ?, 'ANDROID', 'ACTIVE', ?)`,
    [deviceId, familyId, now],
  );
  if (signerKeyId) await insertActiveDsk(deviceId, signerKeyId);
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

  assert.deepEqual(await appendAgainstCurrent(store, record), { outcome: 'APPENDED' });

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

  assert.deepEqual(await appendAgainstCurrent(store, record), { outcome: 'APPENDED' });
  const floorsAfterFirst = await floorStore.readFloors(familyId);
  assert.deepEqual(floorsAfterFirst, { minimumAcceptedTrustSetEpoch: 1, minimumAcceptedKeyEpoch: 2 });

  // Identical bytes + signature + keyEpoch -> a retry of an accepted epoch, not a second row.
  assert.deepEqual(await appendAgainstCurrent(store, { ...record }), { outcome: 'IDEMPOTENT_MATCH' });
  assert.equal(await countEpochRows(familyId), 1, 'an idempotent retry must not add a row');

  // Same trust-set epoch number, different signed content -> CONFLICT, no state change.
  assert.deepEqual(await appendAgainstCurrent(store, makeRecord(familyId, 1, 2)), { outcome: 'CONFLICT' });
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

  assert.deepEqual(await appendAgainstCurrent(store, makeRecord(familyId, 2, 1)), { outcome: 'APPENDED' });

  assert.deepEqual(await appendAgainstCurrent(store, makeRecord(familyId, 2, 1)), { outcome: 'CONFLICT' });
  assert.deepEqual(await appendAgainstCurrent(store, makeRecord(familyId, 1, 1)), {
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

  assert.deepEqual(await appendAgainstCurrent(store, makeRecord(familyId, 3, 2)), { outcome: 'APPENDED' });

  assert.deepEqual(await appendAgainstCurrent(store, makeRecord(familyId, 4, 1)), {
    outcome: 'REJECTED_STALE',
    reason: 'STALE_KEY_EPOCH',
  });
  assert.equal(await countEpochRows(familyId), 1, 'a stale key epoch must not add a row');
  assert.deepEqual(await floorStore.readFloors(familyId), { minimumAcceptedTrustSetEpoch: 3, minimumAcceptedKeyEpoch: 2 });

  // Metadata-only epoch: trustSetEpoch advances, keyEpoch stays EQUAL -- allowed.
  const metadataOnly = makeRecord(familyId, 4, 2);
  assert.deepEqual(await appendAgainstCurrent(store, metadataOnly), { outcome: 'APPENDED' });
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
  assert.deepEqual(await appendAgainstCurrent(store, accepted), { outcome: 'APPENDED' });

  for (const [ts, key] of [
    [4, 5],
    [4, 6],
    [1, 1],
  ]) {
    assert.deepEqual(
      await appendAgainstCurrent(store, makeRecord(familyId, ts, key)),
      { outcome: 'REJECTED_STALE', reason: 'STALE_TRUST_SET_EPOCH' },
      `ts=${ts} must never land below the accepted floor`,
    );
  }
  assert.deepEqual(await appendAgainstCurrent(store, makeRecord(familyId, 5, 5)), { outcome: 'CONFLICT' });

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

  assert.deepEqual(await appendAgainstCurrent(store, makeRecord(familyA, 1, 1)), { outcome: 'APPENDED' });
  assert.deepEqual(await appendAgainstCurrent(store, makeRecord(familyB, 1, 1)), { outcome: 'APPENDED' });

  // Family A advances; family B must not move.
  assert.deepEqual(await appendAgainstCurrent(store, makeRecord(familyA, 2, 2)), { outcome: 'APPENDED' });

  assert.deepEqual(await floorStore.readFloors(familyA), { minimumAcceptedTrustSetEpoch: 2, minimumAcceptedKeyEpoch: 2 });
  assert.deepEqual(await floorStore.readFloors(familyB), { minimumAcceptedTrustSetEpoch: 1, minimumAcceptedKeyEpoch: 1 });
  assert.deepEqual(await keyEpochStore.readCanonicalKeyEpoch(familyA), { trustSetEpoch: 2, keyEpoch: 2 });
  assert.deepEqual(await keyEpochStore.readCanonicalKeyEpoch(familyB), { trustSetEpoch: 1, keyEpoch: 1 });

  // Family B still accepts the very same epoch numbers family A already used.
  assert.deepEqual(await appendAgainstCurrent(store, makeRecord(familyB, 2, 2)), { outcome: 'APPENDED' });

  assert.equal(await countEpochRows(familyA), 2);
  assert.equal(await countEpochRows(familyB), 2);
  assert.equal((await store.readLatestEpoch(familyB)).familyId, familyB);
});

// ---------------------------------------------------------------------
// 7. REAL CONCURRENCY (Promise.all, live database as the arbiter)
// ---------------------------------------------------------------------

test('CONCURRENCY (a) SAME_VALIDATED_HEAD: different increasing candidates validated against one head yield one append and one stale-authority rejection', async () => {
  const store = new MySqlTrustSetEpochStore();
  const floorStore = new MySqlEpochFloorStore();
  const familyId = uniqueFamilyId();
  const headRecord = makeRecord(familyId, 1, 1);
  assert.deepEqual(await appendAgainstCurrent(store, headRecord), { outcome: 'APPENDED' });
  const expectedHead = expectedHeadFrom(headRecord);
  const lowRecord = makeRecord(familyId, 2, 1);
  const highRecord = makeRecord(familyId, 3, 1);

  const [lowOutcome, highOutcome] = await recordConcurrentOutcomes('CONCURRENT_SAME_VALIDATED_HEAD', [
    () => store.appendAcceptedEpoch(lowRecord, expectedHead),
    () => store.appendAcceptedEpoch(highRecord, expectedHead),
  ]);

  assert.equal([lowOutcome, highOutcome].filter((outcome) => outcome.outcome === 'APPENDED').length, 1);
  assert.equal([lowOutcome, highOutcome].filter((outcome) => outcome.outcome === 'REJECTED_STALE_AUTHORITY').length, 1);
  const winnerEpoch = lowOutcome.outcome === 'APPENDED' ? 2 : 3;
  const loserEpoch = winnerEpoch === 2 ? 3 : 2;
  assert.equal(await countEpochRows(familyId, winnerEpoch), 1, 'the winner has one durable row');
  assert.equal(await countEpochRows(familyId, loserEpoch), 0, 'the stale candidate leaves no row');
  const latest = await store.readLatestEpoch(familyId);
  assert.equal(latest.trustSetEpoch, winnerEpoch);
  assert.deepEqual(await floorStore.readFloors(familyId), {
    minimumAcceptedTrustSetEpoch: winnerEpoch,
    minimumAcceptedKeyEpoch: 1,
  });
});

test('CONCURRENCY (b) CONCURRENT_HIGHER_LOWER: two increasing candidates on one head yield one append and one stale-authority rejection', async () => {
  const store = new MySqlTrustSetEpochStore();
  const floorStore = new MySqlEpochFloorStore();
  const familyId = uniqueFamilyId();

  const headRecord = makeRecord(familyId, 1, 1);
  assert.deepEqual(await appendAgainstCurrent(store, headRecord), { outcome: 'APPENDED' });
  const expectedHead = expectedHeadFrom(headRecord);

  const [higherOutcome, lowerOutcome] = await recordConcurrentOutcomes('CONCURRENT_HIGHER_LOWER', [
    () => store.appendAcceptedEpoch(makeRecord(familyId, 5, 5), expectedHead),
    () => store.appendAcceptedEpoch(makeRecord(familyId, 3, 6), expectedHead),
  ]);

  assert.equal([higherOutcome, lowerOutcome].filter((outcome) => outcome.outcome === 'APPENDED').length, 1);
  assert.equal([higherOutcome, lowerOutcome].filter((outcome) => outcome.outcome === 'REJECTED_STALE_AUTHORITY').length, 1);
  const winnerEpoch = higherOutcome.outcome === 'APPENDED' ? 5 : 3;
  const loserEpoch = winnerEpoch === 5 ? 3 : 5;
  const winnerKeyEpoch = winnerEpoch === 5 ? 5 : 6;
  assert.equal(await countEpochRows(familyId, winnerEpoch), 1);
  assert.equal(await countEpochRows(familyId, loserEpoch), 0, 'the candidate against the old head leaves no row');
  assert.deepEqual(await floorStore.readFloors(familyId), {
    minimumAcceptedTrustSetEpoch: winnerEpoch,
    minimumAcceptedKeyEpoch: winnerKeyEpoch,
  });
  assert.equal((await store.readLatestEpoch(familyId)).trustSetEpoch, winnerEpoch);
});

test('CONCURRENCY (c) SAME_VALUE_RETRY: a concurrent identical-bytes retry pair never conflicts and leaves exactly one row', async () => {
  const store = new MySqlTrustSetEpochStore();
  const familyId = uniqueFamilyId();
  const record = makeRecord(familyId, 2, 2);
  const expectedHead = null;

  const outcomes = await recordConcurrentOutcomes('SAME_VALUE_RETRY', [
    () => store.appendAcceptedEpoch(record, expectedHead),
    () => store.appendAcceptedEpoch({ ...record }, expectedHead),
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

test('DUPLICATE PRECEDENCE: exact replay and same-epoch conflict are resolved before a stale expected-head check', async () => {
  const store = new MySqlTrustSetEpochStore();
  const familyId = uniqueFamilyId();
  const accepted = makeRecord(familyId, 1, 1);
  assert.deepEqual(await appendAgainstCurrent(store, accepted), { outcome: 'APPENDED' });

  assert.deepEqual(
    await store.appendAcceptedEpoch({ ...accepted }, null),
    { outcome: 'IDEMPOTENT_MATCH' },
    'an exact historical replay remains idempotent even when its original expected head is stale',
  );
  assert.deepEqual(
    await store.appendAcceptedEpoch(makeRecord(familyId, 1, 1), null),
    { outcome: 'CONFLICT' },
    'same-epoch conflicting bytes remain a conflict before expected-head evaluation',
  );
  assert.equal(await countEpochRows(familyId), 1);
  assert.deepEqual(await new MySqlEpochFloorStore().readFloors(familyId), {
    minimumAcceptedTrustSetEpoch: 1,
    minimumAcceptedKeyEpoch: 1,
  });
});

// ---------------------------------------------------------------------
// 8. RESTART / READBACK DURABILITY
// ---------------------------------------------------------------------

test('RESTART/READBACK DURABILITY: brand-new store instances (and raw pool queries) read identical values', async () => {
  const familyId = uniqueFamilyId();
  const first = makeRecord(familyId, 1, 1);
  const second = makeRecord(familyId, 2, 3);
  const firstStore = new MySqlTrustSetEpochStore();
  assert.deepEqual(await appendAgainstCurrent(firstStore, first), { outcome: 'APPENDED' });
  assert.deepEqual(await appendAgainstCurrent(new MySqlTrustSetEpochStore(), second), { outcome: 'APPENDED' });

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
    const validRecord = makeRecord(familyId, 1, 1);
    const record = mutate(validRecord);

    await assert.rejects(
      () => store.appendAcceptedEpoch(record, null),
      (error) => {
        assert.ok(
          error instanceof TrustSetEpochStoreError,
          `expected TrustSetEpochStoreError, got ${error?.constructor?.name ?? String(error)}`,
        );
        assert.equal(error.code, 'INVALID_INPUT');
        return true;
      },
    );
    assert.equal(await countEpochRows(familyId), 0, 'malformed input must never create an epoch row');
    assert.equal(
      await new MySqlEpochFloorStore().readFloors(familyId),
      null,
      'malformed input must never create a floors row (validation runs before any SQL)',
    );
    const [[families]] = await getPool().query('SELECT COUNT(*) AS n FROM families WHERE family_id = ?', [familyId]);
    const [[devices]] = await getPool().query('SELECT COUNT(*) AS n FROM devices WHERE device_id = ?', [validRecord.signerDeviceId]);
    assert.equal(Number(families.n), 0, 'invalid records must not cause the fixture wrapper to create a family');
    assert.equal(Number(devices.n), 0, 'invalid records must not cause the fixture wrapper to create a device');
  }

  await assertInvalidInput((record) => ({ ...record, trustSetEpoch: 0 }));
  await assertInvalidInput((record) => ({ ...record, trustSetEpoch: -1 }));
  await assertInvalidInput((record) => ({ ...record, trustSetEpoch: Number.NaN }));
  await assertInvalidInput((record) => ({ ...record, trustSetEpoch: MAX_FAMILY_EPOCH + 1 }));
  await assertInvalidInput((record) => ({ ...record, keyEpoch: 0 }));
  await assertInvalidInput((record) => ({ ...record, keyEpoch: -2 }));
  await assertInvalidInput((record) => ({ ...record, keyEpoch: Number.NaN }));
  await assertInvalidInput((record) => ({ ...record, keyEpoch: MAX_FAMILY_EPOCH + 1 }));
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
  await assertInvalidInput((record) => ({ ...record, supersedesEpoch: MAX_FAMILY_EPOCH + 1 }));
  await assertInvalidInput((record) => ({ ...record, issuedAt: new Date(Number.NaN) }));
  await assertInvalidInput((record) => ({ ...record, receivedAt: 'not-a-date' }));
});

test('EXPECTED_HEAD_REQUIRED: an omitted expected head cannot bypass the compare-and-append contract', async () => {
  const store = new MySqlTrustSetEpochStore();
  const familyId = uniqueFamilyId();
  const record = makeRecord(familyId, 1, 1);

  await assert.rejects(
    () => store.appendAcceptedEpoch(record),
    (error) => error instanceof TrustSetEpochStoreError && error.code === 'INVALID_INPUT',
  );
  assert.equal(await countEpochRows(familyId), 0);
  assert.equal(await new MySqlEpochFloorStore().readFloors(familyId), null);
});

test('EXPECTED_HEAD_SNAPSHOT: caller mutation after invocation cannot change the locked compare target', async () => {
  const store = new MySqlTrustSetEpochStore();
  const familyId = uniqueFamilyId();
  const first = makeRecord(familyId, 1, 1);
  assert.deepEqual(await store.appendAcceptedEpoch(first, null), { outcome: 'APPENDED' });

  const expectedHead = expectedHeadFrom(first);
  const candidate = makeRecord(familyId, 2, 1);
  const appendPromise = store.appendAcceptedEpoch(candidate, expectedHead);
  expectedHead.signedEpochBytes.fill(0);

  assert.deepEqual(await appendPromise, { outcome: 'APPENDED' });
  const latest = await store.readLatestEpoch(familyId);
  assert.equal(latest?.trustSetEpoch, 2);
  assert.ok(latest?.signedEpochBytes.equals(candidate.signedEpochBytes));
});

test('EXPECTED_HEAD_INVALID: malformed compare targets throw before creating epoch or floors rows', async () => {
  const store = new MySqlTrustSetEpochStore();
  const familyId = uniqueFamilyId();
  const record = makeRecord(familyId, 1, 1);

  await assert.rejects(
    () => store.appendAcceptedEpoch(record, {
      trustSetEpoch: 0,
      keyEpoch: 1,
      signedEpochBytes: Buffer.from('head'),
      signature: 'sig',
    }),
    (error) => error instanceof TrustSetEpochStoreError && error.code === 'INVALID_INPUT',
  );
  assert.equal(await countEpochRows(familyId), 0);
  assert.equal(await new MySqlEpochFloorStore().readFloors(familyId), null);

  await assert.rejects(
    () => store.appendAcceptedEpoch(record, {
      trustSetEpoch: MAX_FAMILY_EPOCH + 1,
      keyEpoch: 1,
      signedEpochBytes: Buffer.from('head'),
      signature: 'sig',
    }),
    (error) => error instanceof TrustSetEpochStoreError && error.code === 'INVALID_INPUT',
  );
  assert.equal(await countEpochRows(familyId), 0);
  assert.equal(await new MySqlEpochFloorStore().readFloors(familyId), null);
});

test('OUT-OF-RANGE STORED VALUES: epoch rows and floors fail closed without rewriting persisted data', async () => {
  const store = new MySqlTrustSetEpochStore();
  const floorStore = new MySqlEpochFloorStore();
  const epochFamilyId = uniqueFamilyId();
  const overRangeRecord = makeRecord(epochFamilyId, MAX_FAMILY_EPOCH + 1, 1);
  await insertEpochWithoutFloors(overRangeRecord);

  await assert.rejects(() => store.readLatestEpoch(epochFamilyId), /outside the supported protocol range/);
  await assert.rejects(() => new MySqlKeyEpochStore().readCanonicalKeyEpoch(epochFamilyId), /outside the supported protocol range/);
  const [persistedEpochRows] = await getPool().query(
    'SELECT COUNT(*) AS count FROM family_trust_set_epochs WHERE family_id = ?',
    [epochFamilyId],
  );
  assert.equal(Number(persistedEpochRows[0].count), 1, 'out-of-range existing row is preserved');

  const floorFamilyId = uniqueFamilyId();
  await getPool().query(
    `INSERT INTO family_epoch_floors
       (family_id, minimum_accepted_trust_set_epoch, minimum_accepted_key_epoch, updated_at)
     VALUES (?, ?, 1, ?)`,
    [floorFamilyId, MAX_FAMILY_EPOCH + 1, stamp()],
  );
  await assert.rejects(() => floorStore.readFloors(floorFamilyId), /outside the supported protocol range/);
  const [persistedFloorRows] = await getPool().query(
    'SELECT COUNT(*) AS count FROM family_epoch_floors WHERE family_id = ?',
    [floorFamilyId],
  );
  assert.equal(Number(persistedFloorRows[0].count), 1, 'out-of-range existing floor is preserved');
});

test('STALE_AUTHORITY_ROLLBACK: a stale comparison leaves no recreated floors row when storage was already inconsistent', async () => {
  const store = new MySqlTrustSetEpochStore();
  const familyId = uniqueFamilyId();
  const first = makeRecord(familyId, 1, 1);
  await insertEpochWithoutFloors(first);
  assert.equal(await new MySqlEpochFloorStore().readFloors(familyId), null);

  const stale = await store.appendAcceptedEpoch(makeRecord(familyId, 2, 1), null);
  assert.deepEqual(stale, { outcome: 'REJECTED_STALE_AUTHORITY' });
  assert.equal(await new MySqlEpochFloorStore().readFloors(familyId), null);
  assert.equal(await countEpochRows(familyId), 1);
  assert.equal((await store.readLatestEpoch(familyId))?.trustSetEpoch, 1);
});

test('DUPLICATE_ROLLBACK: exact replay and same-epoch conflict preserve duplicate precedence without recreating missing floors', async () => {
  const store = new MySqlTrustSetEpochStore();

  for (const expectedOutcome of ['IDEMPOTENT_MATCH', 'CONFLICT']) {
    const familyId = uniqueFamilyId();
    const first = makeRecord(familyId, 1, 1);
    await insertEpochWithoutFloors(first);

    const replay = expectedOutcome === 'IDEMPOTENT_MATCH'
      ? { ...first, signedEpochBytes: Buffer.from(first.signedEpochBytes) }
      : makeRecord(familyId, 1, 1);
    assert.deepEqual(await store.appendAcceptedEpoch(replay, null), { outcome: expectedOutcome });
    assert.equal(await new MySqlEpochFloorStore().readFloors(familyId), null);
    assert.equal(await countEpochRows(familyId), 1);
  }
});

test('LIFECYCLE RACE: revocation and ordinary epoch append serialize on the signer row', async () => {
  const familyId = uniqueFamilyId();
  const deviceId = randomUUID();
  const store = new MySqlTrustSetEpochStoreBase();
  const floorStore = new MySqlEpochFloorStore();
  const first = makeRecord(familyId, 1, 1, { signerDeviceId: deviceId });
  await insertFamilyAndActiveDevice(familyId, deviceId, first.signerKeyId);
  assert.deepEqual(await store.appendAcceptedEpoch(first, null), { outcome: 'APPENDED' });
  const floorsBeforeRace = await floorStore.readFloors(familyId);
  const next = makeRecord(familyId, 2, 2, { signerDeviceId: deviceId, signerKeyId: first.signerKeyId });

  // Competing real transactions contend on devices.device_id. If the append
  // obtains the lock first it may commit before revocation; if revocation
  // wins, append must return stale authority without committing its floor or
  // history changes.
  const [appendOutcome] = await Promise.all([
    store.appendAcceptedEpoch(next, expectedHeadFrom(first)),
    getPool().query(
      `UPDATE devices SET status = 'REVOKED', revoked_at = NOW(3)
        WHERE device_id = ? AND family_id = ? AND status = 'ACTIVE'`,
      [deviceId, familyId],
    ),
  ]);

  const [[deviceState]] = await getPool().query(
    'SELECT status FROM devices WHERE device_id = ? AND family_id = ?',
    [deviceId, familyId],
  );
  assert.equal(deviceState?.status, 'REVOKED');
  assert.ok(
    appendOutcome.outcome === 'APPENDED' || appendOutcome.outcome === 'REJECTED_STALE_AUTHORITY',
    `unexpected serialized outcome: ${appendOutcome.outcome}`,
  );

  if (appendOutcome.outcome === 'APPENDED') {
    assert.equal(await countEpochRows(familyId), 2, 'the append linearized before revocation');
    assert.deepEqual(await floorStore.readFloors(familyId), {
      minimumAcceptedTrustSetEpoch: 2,
      minimumAcceptedKeyEpoch: 2,
    });
    assert.equal((await store.readLatestEpoch(familyId))?.trustSetEpoch, 2);
  } else {
    assert.equal(await countEpochRows(familyId), 1, 'revocation won before the append');
    assert.deepEqual(await floorStore.readFloors(familyId), floorsBeforeRace, 'rejected append leaves floors unchanged');
    assert.equal((await store.readLatestEpoch(familyId))?.trustSetEpoch, 1);
  }
});

test('LIFECYCLE SCOPE: revoked, moved, and cross-family signer devices cannot append or mutate floors/history', async () => {
  const familyA = uniqueFamilyId();
  const familyB = uniqueFamilyId();
  const familyC = uniqueFamilyId();
  const deviceA = randomUUID();
  const deviceB = randomUUID();
  const deviceC = randomUUID();
  const first = makeRecord(familyA, 1, 1, { signerDeviceId: deviceA });
  await insertFamilyAndActiveDevice(familyA, deviceA, first.signerKeyId);
  await insertFamilyAndActiveDevice(familyB, deviceB);
  await insertFamilyAndActiveDevice(familyC, deviceC);

  const store = new MySqlTrustSetEpochStoreBase();
  const floorStore = new MySqlEpochFloorStore();
  assert.deepEqual(await store.appendAcceptedEpoch(first, null), { outcome: 'APPENDED' });
  const floorsBefore = await floorStore.readFloors(familyA);

  const foreignSigner = makeRecord(familyA, 2, 2, { signerDeviceId: deviceB });
  assert.deepEqual(await store.appendAcceptedEpoch(foreignSigner, expectedHeadFrom(first)), {
    outcome: 'REJECTED_STALE_AUTHORITY',
  });

  await getPool().query(
    'UPDATE devices SET family_id = ? WHERE device_id = ? AND family_id = ? AND status = \'ACTIVE\'',
    [familyB, deviceA, familyA],
  );
  const movedSigner = makeRecord(familyA, 2, 2, { signerDeviceId: deviceA });
  assert.deepEqual(await store.appendAcceptedEpoch(movedSigner, expectedHeadFrom(first)), {
    outcome: 'REJECTED_STALE_AUTHORITY',
  });

  assert.equal(await countEpochRows(familyA), 1);
  assert.equal(await countEpochRows(familyB), 0);
  assert.deepEqual(await floorStore.readFloors(familyA), floorsBefore);
  assert.equal(await floorStore.readFloors(familyB), null, 'foreign signer rejection must not create another family floor');
  assert.equal((await store.readLatestEpoch(familyA))?.trustSetEpoch, 1);
  assert.equal(await store.readLatestEpoch(familyB), null);

  await getPool().query(
    `UPDATE devices SET status = 'REVOKED', revoked_at = NOW(3)
      WHERE device_id = ? AND family_id = ? AND status = 'ACTIVE'`,
    [deviceC, familyC],
  );
  const firstAttemptAfterRevocation = makeRecord(familyC, 1, 1, { signerDeviceId: deviceC });
  assert.deepEqual(await store.appendAcceptedEpoch(firstAttemptAfterRevocation, null), {
    outcome: 'REJECTED_STALE_AUTHORITY',
  });
  assert.equal(await countEpochRows(familyC), 0);
  assert.equal(await floorStore.readFloors(familyC), null, 'revoked first append must roll back its provisional floor');
});

test('LIFECYCLE REPLAY: an exact accepted epoch replay after signer revocation is rejected without changing history or floors', async () => {
  const familyId = uniqueFamilyId();
  const deviceId = randomUUID();
  const store = new MySqlTrustSetEpochStoreBase();
  const floorStore = new MySqlEpochFloorStore();
  const accepted = makeRecord(familyId, 1, 1, { signerDeviceId: deviceId });
  await insertFamilyAndActiveDevice(familyId, deviceId, accepted.signerKeyId);
  assert.deepEqual(await store.appendAcceptedEpoch(accepted, null), { outcome: 'APPENDED' });
  const floorsBefore = await floorStore.readFloors(familyId);

  await getPool().query(
    `UPDATE devices SET status = 'REVOKED', revoked_at = NOW(3)
      WHERE device_id = ? AND family_id = ? AND status = 'ACTIVE'`,
    [deviceId, familyId],
  );

  assert.deepEqual(await store.appendAcceptedEpoch(accepted, expectedHeadFrom(accepted)), {
    outcome: 'REJECTED_STALE_AUTHORITY',
  });
  assert.equal(await countEpochRows(familyId), 1, 'revoked replay must not add an epoch-history row');
  assert.deepEqual(await floorStore.readFloors(familyId), floorsBefore, 'revoked replay must leave both floors unchanged');
  const latest = await store.readLatestEpoch(familyId);
  assert.equal(latest?.trustSetEpoch, accepted.trustSetEpoch);
  assert.equal(latest?.keyEpoch, accepted.keyEpoch);
  assert.ok(latest?.signedEpochBytes.equals(accepted.signedEpochBytes));
});

test('LIFECYCLE INACTIVE DEVICE: a PAIRED device cannot append and leaves no history or floor rows', async () => {
  const familyId = uniqueFamilyId();
  const deviceId = randomUUID();
  const store = new MySqlTrustSetEpochStoreBase();
  const floorStore = new MySqlEpochFloorStore();
  const pairedCandidate = makeRecord(familyId, 1, 1, { signerDeviceId: deviceId });
  await insertFamilyAndActiveDevice(familyId, deviceId, pairedCandidate.signerKeyId);
  await getPool().query(
    `UPDATE devices SET status = 'PAIRED'
      WHERE device_id = ? AND family_id = ? AND status = 'ACTIVE'`,
    [deviceId, familyId],
  );
  assert.deepEqual(await store.appendAcceptedEpoch(pairedCandidate, null), {
    outcome: 'REJECTED_STALE_AUTHORITY',
  });
  assert.equal(await countEpochRows(familyId), 0, 'non-active device rejection must not create history');
  assert.equal(await floorStore.readFloors(familyId), null, 'non-active device rejection must roll back provisional floors');
  assert.equal(await store.readLatestEpoch(familyId), null);
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
  assert.deepEqual(await appendAgainstCurrent(store, makeRecord(familyId, 1, 1)), { outcome: 'APPENDED' });
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
  for (const label of ['CONCURRENT_SAME_VALIDATED_HEAD', 'CONCURRENT_HIGHER_LOWER', 'SAME_VALUE_RETRY']) {
    assert.ok(Object.prototype.hasOwnProperty.call(CONCURRENCY_OUTCOMES, label), `${label} must have been recorded`);
  }
  console.log(`[familytrustset-epoch-persistence-concurrency-outcomes] ${JSON.stringify(CONCURRENCY_OUTCOMES)}`);
});

test.after(async () => {
  await closePool();
});
