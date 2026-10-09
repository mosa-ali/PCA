// WAVE 5B -- the server-side Trust Set epoch ACCEPTANCE flow
// (dist/familytrustset/TrustSetEpochAcceptance.js) against the REAL durable
// stack: MySqlTrustSetEpochStore / MySqlKeyEpochStore / MySqlEpochFloorStore
// (migration 0060), the REAL MySqlGenesisAnchorSource over
// `family_authority_genesis_anchors` (migration 0011), and the REAL
// P256TrustSetSignatureVerifier over node:crypto-generated P-256 keys.
//
// WHAT THIS PROVES, AND WHY EACH CASE IS HERE. Wave 5A proved the durable
// epoch tables enforce idempotency, conflicts and anti-rollback floors AT
// THE STORAGE LAYER. Wave 5B adds the acceptance judgement in front of them
// -- strict decode, family binding, byte identity, durable-state signer
// resolution, signature verification, monotonic floors -- and the property
// that now matters is no longer only "the store refuses a downgrade" but
// "a rejected candidate can never reach the store at all, while every
// accepted candidate is mirrored in the database byte-for-byte". The cases
// below pin exactly that: anchored genesis is persisted once; the chain
// advances one accepted successor at a time; key epoch may advance or stay
// equal but can never rotate back; every sampled rejection class (bad
// signature, wrong family, stale trust-set, unknown predecessor,
// unauthorized signer) leaves row count, stored rows and BOTH floors
// exactly as they were; a byte-identical retry is IDEMPOTENT; a
// different-bytes reuse of an accepted number is CONFLICT and the original
// bytes survive; acceptance after constructing brand-new store/service
// instances is driven purely by durable state; two families never share
// floors or key-epoch views; and two genuinely concurrent different-byte
// ts=2 contenders resolve to exactly one ACCEPTED (the store's APPENDED)
// plus one CONFLICT, with exactly one durable row.
//
// EXECUTED BY THE DISPOSABLE-DB LANES. Registration is applied by the
// coordinator: this file must be appended to `test:db:inner` in
// backend/package.json AFTER familyTrustSetEpochPersistence, so the
// migration-0060 tables exist and the migration-safety suite's
// DROP/recreate has finished. Requires PCA_DATABASE_URL like every file in
// this directory. One unique family id per case, so runs can never collide
// with each other or with the 5A suites; the database is disposable per
// lane, so no rows are cleaned up.
//
// The P-256 key/signing approach mirrors backend/test/familytrustset/
// trustSetEpochAcceptance.test.mjs (no shared signing helper exists under
// backend/test): SEC1-uncompressed public point, low-S IEEE-P1363
// signature re-canonicalized via the deviceauth helper, unpadded base64url.
import assert from 'node:assert/strict';
import { generateKeyPairSync, randomBytes, randomUUID, sign as cryptoSign } from 'node:crypto';
import test from 'node:test';
import { getPool, closePool } from '../../dist/db/pool.js';
import { canonicalizeP256Signature } from '../../dist/deviceauth/P256DeviceSignatureVerifier.js';
import { canonicalizeTrustSetEpoch } from '../../dist/familytrustset/canonicalize.js';
import { MySqlTrustSetEpochStore } from '../../dist/familytrustset/MySqlTrustSetEpochStore.js';
import { MySqlKeyEpochStore } from '../../dist/familytrustset/MySqlKeyEpochStore.js';
import { MySqlEpochFloorStore } from '../../dist/familytrustset/MySqlEpochFloorStore.js';
import { MySqlGenesisAnchorSource } from '../../dist/familytrustset/GenesisAnchorSource.js';
import { P256TrustSetSignatureVerifier } from '../../dist/familytrustset/P256TrustSetSignatureVerifier.js';
import { TrustSetEpochAcceptanceService } from '../../dist/familytrustset/TrustSetEpochAcceptance.js';

if (!process.env.PCA_DATABASE_URL) throw new Error('PCA_DATABASE_URL is required for backend/test/db tests.');

/** Every case gets its own family id, so cases can never collide with each other or across runs. */
function uniqueFamilyId() {
  return randomUUID();
}

/**
 * A `new Date()` truncated to whole seconds, so DATETIME(3) round-trips and
 * exact-ISO decode gates are deterministic fixtures (the acceptance record's
 * instants carry caller-supplied dates; millisecond noise would only blur
 * the byte-equality assertions).
 */
function stamp() {
  const value = new Date();
  value.setUTCMilliseconds(0);
  return value;
}

/** SEC1 uncompressed point (0x04 || x || y), unpadded base64url -- exactly what the strict verifier accepts. */
function publicPointFromJwk(jwk) {
  const decode = (value) => Buffer.from(value, 'base64url');
  return Buffer.concat([Buffer.from([0x04]), decode(jwk.x), decode(jwk.y)]).toString('base64url');
}

let deviceOrdinal = 0;

/**
 * One synthetic device with a real P-256 DSK pair. deviceId/dskKeyId are
 * UUIDs because the genesis-anchor columns they are seeded into are
 * CHAR(36); the DEK material is random bytes, distinct from the DSK public
 * point as every trust-set entry requires.
 */
function makeDevice(label) {
  deviceOrdinal += 1;
  const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  return {
    deviceId: randomUUID(),
    dskKeyId: randomUUID(),
    dskPublicKey: publicPointFromJwk(pair.publicKey.export({ format: 'jwk' })),
    dskPrivateKey: pair.privateKey,
    dekKeyId: `${label}-dek-${deviceOrdinal}`,
    dekPublicKey: randomBytes(32).toString('base64url'),
  };
}

function entryFor(device, overrides = {}) {
  return {
    deviceId: device.deviceId,
    role: 'OWNER',
    dskKeyId: device.dskKeyId,
    dskPublicKey: device.dskPublicKey,
    dekKeyId: device.dekKeyId,
    dekPublicKey: device.dekPublicKey,
    status: 'ACTIVE',
    ...overrides,
  };
}

function epochFields(familyId, overrides = {}) {
  return {
    familyId,
    trustSetEpoch: 1,
    keyEpoch: 1,
    entries: [],
    issuedAt: stamp(),
    supersedesEpoch: null,
    ...overrides,
  };
}

/**
 * The canonical chain shape used by these cases: one ACTIVE OWNER (the same
 * device across epochs, as the acceptance flow's signer authorization
 * requires) with supersedesEpoch naming the previous epoch (null at ts=1,
 * where a preceding epoch cannot exist).
 */
function ownerEpochFields(familyId, trustSetEpoch, keyEpoch, owner, overrides = {}) {
  return epochFields(familyId, {
    trustSetEpoch,
    keyEpoch,
    supersedesEpoch: trustSetEpoch > 1 ? trustSetEpoch - 1 : null,
    entries: [entryFor(owner)],
    ...overrides,
  });
}

/** Low-S IEEE-P1363, unpadded base64url -- the exact signature form the strict P-256 verifier accepts. */
function signEpochBytes(privateKey, canonicalBytes) {
  const signature = cryptoSign('sha256', Buffer.from(canonicalBytes, 'utf8'), {
    key: privateKey,
    dsaEncoding: 'ieee-p1363',
  });
  return canonicalizeP256Signature(signature).toString('base64url');
}

function signedCandidate(fields, signerPrivateKey) {
  const bytes = canonicalizeTrustSetEpoch(fields);
  return { bytes, signature: signEpochBytes(signerPrivateKey, bytes) };
}

function inputFor(familyId, candidate, overrides = {}) {
  return {
    familyId,
    signedCanonicalBytes: candidate.bytes,
    signature: candidate.signature,
    receivedAt: stamp(),
    ...overrides,
  };
}

/** Production-shaped composition: all five deps are the REAL MySQL/crypto implementations, no fakes. */
function newService() {
  return new TrustSetEpochAcceptanceService({
    epochStore: new MySqlTrustSetEpochStore(),
    keyEpochStore: new MySqlKeyEpochStore(),
    floorStore: new MySqlEpochFloorStore(),
    genesisAnchorSource: new MySqlGenesisAnchorSource(),
    verifier: new P256TrustSetSignatureVerifier(),
  });
}

/**
 * Seeds the family, ACTIVE signer device, and durable genesis anchor
 * (migration 0011 columns) needed by the acceptance flow. Raw SQL on
 * purpose: createIfAbsent is the anchor's only production writer, while
 * this fixture creates the authoritative lifecycle rows the epoch store
 * now locks and revalidates before ordinary acceptance.
 */
async function seedAnchor(familyId, device) {
  const now = stamp();
  await getPool().query(
    `INSERT INTO families (family_id, family_reference_hash, created_at, status)
     VALUES (?, ?, ?, 'ACTIVE')`,
    [familyId, randomBytes(32), now],
  );
  await getPool().query(
    `INSERT INTO devices (device_id, family_id, platform, status, created_at)
     VALUES (?, ?, 'ANDROID', 'ACTIVE', ?)`,
    [device.deviceId, familyId, now],
  );
  await getPool().query(
    `INSERT INTO device_public_keys (device_id, key_id, key_purpose, public_key, status, created_at, revoked_at)
     VALUES (?, ?, 'DSK', ?, 'ACTIVE', ?, NULL)`,
    [device.deviceId, device.dskKeyId, device.dskPublicKey, now],
  );

  await getPool().query(
    `INSERT INTO family_authority_genesis_anchors
       (family_id, genesis_device_id, genesis_dsk_key_id, genesis_dsk_public_key, protocol_version, created_at, signature)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [familyId, device.deviceId, device.dskKeyId, device.dskPublicKey, 1, now, `genesis-anchor-sig-${randomUUID()}`],
  );
}

/** Adds a distinct active DSK on an existing device to prove signer checks bind the exact key id. */
async function addOtherActiveDsk(deviceId, label) {
  const other = makeDevice(label);
  await getPool().query(
    `INSERT INTO device_public_keys (device_id, key_id, key_purpose, public_key, status, created_at, revoked_at)
     VALUES (?, ?, 'DSK', ?, 'ACTIVE', ?, NULL)`,
    [deviceId, other.dskKeyId, other.dskPublicKey, stamp()],
  );
  return other;
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

function readFloors(familyId) {
  return new MySqlEpochFloorStore().readFloors(familyId);
}

function readKeyEpoch(familyId) {
  return new MySqlKeyEpochStore().readCanonicalKeyEpoch(familyId);
}

/** Full durable acceptance state for one family: row count, both floors, and every stored row's exact public fields. */
async function snapshotAcceptedState(familyId) {
  const epochs = await new MySqlTrustSetEpochStore().listEpochs(familyId);
  return {
    rowCount: await countEpochRows(familyId),
    floors: await readFloors(familyId),
    epochs: epochs.map((record) => ({
      trustSetEpoch: record.trustSetEpoch,
      keyEpoch: record.keyEpoch,
      supersedesEpoch: record.supersedesEpoch,
      signature: record.signature,
      signerKeyId: record.signerKeyId,
      signerDeviceId: record.signerDeviceId,
      signedEpochBytesHex: record.signedEpochBytes.toString('hex'),
      issuedAtMs: record.issuedAt.getTime(),
      receivedAtMs: record.receivedAt.getTime(),
    })),
  };
}

/** Signs, submits and requires ACCEPTED; returns the exact candidate so callers can resubmit it identically. */
async function acceptOk(service, familyId, fields, signerPrivateKey) {
  const candidate = signedCandidate(fields, signerPrivateKey);
  assert.deepEqual(await service.acceptCandidate(inputFor(familyId, candidate)), { outcome: 'ACCEPTED' });
  return candidate;
}

/**
 * CONCURRENCY OUTCOME RECORDER -- deliberately tiny, mirroring the 5A
 * persistence suite. It fires every contender through one `Promise.all`
 * (genuinely concurrent acceptance calls against the same live database;
 * the service holds no in-process state, so nothing serializes contenders
 * client-side) and returns the RAW outcome objects, in contender order,
 * unmodified and unwrapped, while recording them under `label` in
 * CONCURRENCY_OUTCOMES so the coordinator lane can report them without
 * re-deriving them. Do not reformat the outcomes here.
 */
export const CONCURRENCY_OUTCOMES = {};

export async function recordConcurrentOutcomes(label, contenders) {
  const outcomes = await Promise.all(contenders.map((contender) => contender()));
  CONCURRENCY_OUTCOMES[label] = outcomes;
  return outcomes;
}

// ---------------------------------------------------------------------
// 1. GENESIS_PERSISTS_ONCE
// ---------------------------------------------------------------------

test('GENESIS_PERSISTS_ONCE: an anchored genesis is ACCEPTED once with byte-equal signed bytes; floors reach (1,1)', async () => {
  const service = newService();
  const familyId = uniqueFamilyId();
  const owner = makeDevice('owner');
  await seedAnchor(familyId, owner);

  const fields = ownerEpochFields(familyId, 1, 1, owner);
  const candidate = await acceptOk(service, familyId, fields, owner.dskPrivateKey);

  assert.equal(await countEpochRows(familyId), 1, 'genesis must append exactly one row');
  const [rows] = await getPool().query(
    `SELECT trust_set_epoch, key_epoch, supersedes_epoch, signed_epoch_bytes, signature,
            signer_key_id, signer_device_id, issued_at
     FROM family_trust_set_epochs WHERE family_id = ?`,
    [familyId],
  );
  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.equal(Number(row.trust_set_epoch), 1);
  assert.equal(Number(row.key_epoch), 1);
  assert.equal(row.supersedes_epoch, null);
  assert.ok(
    row.signed_epoch_bytes.equals(Buffer.from(candidate.bytes, 'utf8')),
    'persisted bytes must equal the canonicalize output byte-for-byte',
  );
  assert.equal(row.signature, candidate.signature);
  assert.equal(row.signer_key_id, owner.dskKeyId);
  assert.equal(row.signer_device_id, owner.deviceId);
  assert.equal(new Date(row.issued_at).getTime(), fields.issuedAt.getTime());

  assert.deepEqual(await readFloors(familyId), { minimumAcceptedTrustSetEpoch: 1, minimumAcceptedKeyEpoch: 1 });
});

// ---------------------------------------------------------------------
// 2. CHAIN_NEXT_EPOCH_EXACTLY_ONCE
// ---------------------------------------------------------------------

test('CHAIN_NEXT_EPOCH_EXACTLY_ONCE: the ts=2 key=2 successor signed by epoch 1 OWNER is ACCEPTED; two rows; floors (2,2)', async () => {
  const service = newService();
  const familyId = uniqueFamilyId();
  const owner = makeDevice('owner');
  await seedAnchor(familyId, owner);

  await acceptOk(service, familyId, ownerEpochFields(familyId, 1, 1, owner), owner.dskPrivateKey);
  // ts=2 key=2 signed by the OWNER entry of the accepted ts=1 epoch.
  const second = await acceptOk(service, familyId, ownerEpochFields(familyId, 2, 2, owner), owner.dskPrivateKey);

  assert.equal(await countEpochRows(familyId), 2, 'genesis plus exactly one accepted successor');
  assert.deepEqual(await readFloors(familyId), { minimumAcceptedTrustSetEpoch: 2, minimumAcceptedKeyEpoch: 2 });

  const latest = await new MySqlTrustSetEpochStore().readLatestEpoch(familyId);
  assert.equal(latest.trustSetEpoch, 2);
  assert.equal(latest.keyEpoch, 2);
  assert.ok(latest.signedEpochBytes.equals(Buffer.from(second.bytes, 'utf8')));
  const indexed = new MySqlTrustSetEpochStore();
  const exact = await indexed.readEpoch(familyId, 2);
  assert.ok(exact.signedEpochBytes.equals(Buffer.from(second.bytes, 'utf8')));
  assert.equal(exact.signature, latest.signature);
  assert.equal((await indexed.readEpoch(familyId, 1)).trustSetEpoch, 1);
  assert.equal(await indexed.readEpoch(familyId, 3), null);
  assert.equal(await indexed.readEpoch(uniqueFamilyId(), 2), null);
  await assert.rejects(indexed.readEpoch('', 2));
  await assert.rejects(indexed.readEpoch(familyId, 0));
  await assert.rejects(indexed.readEpoch(familyId, 2_147_483_648));
  assert.deepEqual(await readKeyEpoch(familyId), { trustSetEpoch: 2, keyEpoch: 2 });
});

// ---------------------------------------------------------------------
// 3. KEY ROTATION / METADATA-ONLY EPOCH
// ---------------------------------------------------------------------

test('KEY_ROTATION/METADATA_ONLY: key epoch may advance or stay equal, never rotate back; stale rotation leaves 4 rows and floors (4,3)', async () => {
  const service = newService();
  const familyId = uniqueFamilyId();
  const owner = makeDevice('owner');
  await seedAnchor(familyId, owner);

  await acceptOk(service, familyId, ownerEpochFields(familyId, 1, 1, owner), owner.dskPrivateKey);
  await acceptOk(service, familyId, ownerEpochFields(familyId, 2, 2, owner), owner.dskPrivateKey);
  // Key rotation: 2 -> 3.
  await acceptOk(service, familyId, ownerEpochFields(familyId, 3, 3, owner), owner.dskPrivateKey);
  // Metadata-only epoch: trust-set advances, key epoch STAYS EQUAL -- allowed.
  await acceptOk(service, familyId, ownerEpochFields(familyId, 4, 3, owner), owner.dskPrivateKey);

  const before = await snapshotAcceptedState(familyId);
  assert.equal(before.rowCount, 4);
  assert.deepEqual(before.floors, { minimumAcceptedTrustSetEpoch: 4, minimumAcceptedKeyEpoch: 3 });

  // A newer trust-set epoch carrying a rotated-BACK key epoch must be refused.
  const stale = await service.acceptCandidate(
    inputFor(familyId, signedCandidate(ownerEpochFields(familyId, 5, 2, owner), owner.dskPrivateKey)),
  );
  assert.deepEqual(stale, { outcome: 'REJECTED', reason: 'STALE_KEY_EPOCH' });

  assert.equal(await countEpochRows(familyId), 4, 'a stale key epoch must not add a row');
  assert.deepEqual(await snapshotAcceptedState(familyId), before, 'a stale key epoch must leave every stored row untouched');
  assert.deepEqual(await readFloors(familyId), { minimumAcceptedTrustSetEpoch: 4, minimumAcceptedKeyEpoch: 3 });
});

// ---------------------------------------------------------------------
// 4. REJECTIONS LEAVE THE DATABASE UNCHANGED
// ---------------------------------------------------------------------

test('REJECTIONS_LEAVE_DB_UNCHANGED: five sampled rejection classes each leave rows and BOTH floors exactly as they were', async () => {
  const service = newService();
  const familyId = uniqueFamilyId();
  const owner = makeDevice('owner');
  await seedAnchor(familyId, owner);

  // Self-established chain state: this family has fully accepted ts=1 and ts=2.
  await acceptOk(service, familyId, ownerEpochFields(familyId, 1, 1, owner), owner.dskPrivateKey);
  await acceptOk(service, familyId, ownerEpochFields(familyId, 2, 2, owner), owner.dskPrivateKey);

  const otherFamilyId = uniqueFamilyId();
  const wrongKey = makeDevice('wrong-key');
  const intruder = makeDevice('intruder');

  const cases = [
    {
      label: 'bad signature (wrong private key) -> SIGNATURE_INVALID',
      reason: 'SIGNATURE_INVALID',
      input: inputFor(familyId, signedCandidate(ownerEpochFields(familyId, 3, 3, owner), wrongKey.dskPrivateKey)),
    },
    {
      label: 'wrong family binding -> FAMILY_MISMATCH',
      reason: 'FAMILY_MISMATCH',
      input: inputFor(familyId, signedCandidate(ownerEpochFields(otherFamilyId, 3, 3, owner), owner.dskPrivateKey)),
    },
    {
      label: 'stale trust-set number (ts=1; ts=2 again would be the replay path) -> STALE_TRUST_SET_EPOCH',
      reason: 'STALE_TRUST_SET_EPOCH',
      input: inputFor(familyId, signedCandidate(ownerEpochFields(familyId, 1, 1, owner), owner.dskPrivateKey)),
    },
    {
      label: 'unknown predecessor (supersedes=99) -> UNKNOWN_PREDECESSOR',
      reason: 'UNKNOWN_PREDECESSOR',
      input: inputFor(
        familyId,
        signedCandidate(ownerEpochFields(familyId, 3, 3, owner, { supersedesEpoch: 99 }), owner.dskPrivateKey),
      ),
    },
    {
      label: 'signer not the previous epoch OWNER -> SIGNER_NOT_AUTHORIZED',
      reason: 'SIGNER_NOT_AUTHORIZED',
      input: inputFor(familyId, signedCandidate(ownerEpochFields(familyId, 3, 3, intruder), intruder.dskPrivateKey)),
    },
  ];

  for (const { label, reason, input } of cases) {
    const before = await snapshotAcceptedState(familyId);
    const result = await service.acceptCandidate(input);
    assert.deepEqual(result, { outcome: 'REJECTED', reason }, label);
    assert.equal(await countEpochRows(familyId), before.rowCount, `${label}: row count must not change`);
    assert.deepEqual(
      await readFloors(familyId),
      before.floors,
      `${label}: BOTH floor values must be exactly what they were before the call`,
    );
    assert.deepEqual(await snapshotAcceptedState(familyId), before, `${label}: no durable value may change`);
  }
});

// ---------------------------------------------------------------------
// 5. IDEMPOTENT RETRY
// ---------------------------------------------------------------------

test('IDEMPOTENT_RETRY: re-submitting the identical ts=2 candidate is IDEMPOTENT; still one ts=2 row; floors unchanged', async () => {
  const service = newService();
  const familyId = uniqueFamilyId();
  const owner = makeDevice('owner');
  await seedAnchor(familyId, owner);

  await acceptOk(service, familyId, ownerEpochFields(familyId, 1, 1, owner), owner.dskPrivateKey);
  const acceptedTs2 = await acceptOk(service, familyId, ownerEpochFields(familyId, 2, 2, owner), owner.dskPrivateKey);

  const before = await snapshotAcceptedState(familyId);

  // The identical candidate (same canonical bytes, same signature). The
  // fresh receivedAt is deliberate: it is NOT part of the store's duplicate
  // identity, so a genuine retry must still resolve as IDEMPOTENT.
  const retry = await service.acceptCandidate(inputFor(familyId, acceptedTs2));
  assert.deepEqual(retry, { outcome: 'IDEMPOTENT' });

  assert.equal(await countEpochRows(familyId, 2), 1, 'still exactly one ts=2 row');
  assert.equal(await countEpochRows(familyId), 2, 'no additional row of any kind');
  assert.deepEqual(await snapshotAcceptedState(familyId), before, 'an idempotent retry must not move any durable value');
});

test('REVOKED_DSK_REPLAY: a revoked exact signer key cannot replay an accepted epoch or advance the head', async () => {
  const service = newService();
  const familyId = uniqueFamilyId();
  const owner = makeDevice('revoked-replay-owner');
  await seedAnchor(familyId, owner);
  await addOtherActiveDsk(owner.deviceId, 'other-active-replay-dsk');

  await acceptOk(service, familyId, ownerEpochFields(familyId, 1, 1, owner), owner.dskPrivateKey);
  const acceptedTs2 = await acceptOk(service, familyId, ownerEpochFields(familyId, 2, 2, owner), owner.dskPrivateKey);
  const before = await snapshotAcceptedState(familyId);

  await getPool().query(
    `UPDATE device_public_keys
        SET status = 'REVOKED', revoked_at = ?
      WHERE device_id = ? AND key_id = ? AND key_purpose = 'DSK' AND status = 'ACTIVE'`,
    [stamp(), owner.deviceId, owner.dskKeyId],
  );

  assert.deepEqual(
    await service.acceptCandidate(inputFor(familyId, acceptedTs2)),
    { outcome: 'REJECTED', reason: 'STALE_AUTHORITY' },
    'a revoked signer cannot obtain an idempotent response for its old accepted epoch',
  );
  assert.deepEqual(
    await service.acceptCandidate(
      inputFor(familyId, signedCandidate(ownerEpochFields(familyId, 3, 3, owner), owner.dskPrivateKey)),
    ),
    { outcome: 'REJECTED', reason: 'STALE_AUTHORITY' },
    'a revoked signer cannot append a new successor either',
  );
  assert.deepEqual(await snapshotAcceptedState(familyId), before, 'revoked signer attempts must not alter rows or floors');
});

test('REVOKE_APPEND_RACE: an append waiting on the exact DSK row observes committed revocation and rolls back', async () => {
  const service = newService();
  const familyId = uniqueFamilyId();
  const owner = makeDevice('revocation-race-owner');
  await seedAnchor(familyId, owner);
  await addOtherActiveDsk(owner.deviceId, 'other-active-race-dsk');

  await acceptOk(service, familyId, ownerEpochFields(familyId, 1, 1, owner), owner.dskPrivateKey);
  await acceptOk(service, familyId, ownerEpochFields(familyId, 2, 2, owner), owner.dskPrivateKey);
  const before = await snapshotAcceptedState(familyId);
  const candidate = signedCandidate(ownerEpochFields(familyId, 3, 3, owner), owner.dskPrivateKey);

  const revocation = await getPool().getConnection();
  let inTransaction = false;
  try {
    await revocation.beginTransaction();
    inTransaction = true;
    const [update] = await revocation.query(
      `UPDATE device_public_keys
          SET status = 'REVOKED', revoked_at = ?
        WHERE device_id = ? AND key_id = ? AND key_purpose = 'DSK' AND status = 'ACTIVE'`,
      [stamp(), owner.deviceId, owner.dskKeyId],
    );
    assert.equal(update.affectedRows, 1, 'the revocation transaction must hold the exact active DSK row');

    let appendSettled = false;
    const append = service.acceptCandidate(inputFor(familyId, candidate)).then(
      (result) => {
        appendSettled = true;
        return { result };
      },
      (error) => {
        appendSettled = true;
        return { error };
      },
    );

    // The append can lock the family floor and ACTIVE device, but it must wait
    // at the exact DSK row until this revocation commits. An implementation
    // that checks only device status would incorrectly finish while the key
    // update is still uncommitted.
    await new Promise((resolve) => setTimeout(resolve, 250));
    assert.equal(appendSettled, false, 'append must be serialized behind the in-flight exact-key revocation');

    await revocation.commit();
    inTransaction = false;
    const appendResult = await append;
    assert.equal(appendResult.error, undefined, 'revoked-key outcome should be a handled rejection, not a storage error');
    assert.deepEqual(appendResult.result, { outcome: 'REJECTED', reason: 'STALE_AUTHORITY' });
    assert.deepEqual(await snapshotAcceptedState(familyId), before, 'racing revoked-key append must roll back row and floors');
  } finally {
    if (inTransaction) await revocation.rollback();
    revocation.release();
  }
});

// ---------------------------------------------------------------------
// 6. CONFLICT SURFACED, NEVER ABSORBED
// ---------------------------------------------------------------------

test('CONFLICT_SURFACED: a different-bytes ts=2 candidate raises CONFLICT; the ORIGINAL row bytes survive byte-for-byte', async () => {
  const service = newService();
  const familyId = uniqueFamilyId();
  const owner = makeDevice('owner');
  const viewer = makeDevice('viewer');
  await seedAnchor(familyId, owner);

  await acceptOk(service, familyId, ownerEpochFields(familyId, 1, 1, owner), owner.dskPrivateKey);
  const acceptedTs2 = await acceptOk(service, familyId, ownerEpochFields(familyId, 2, 2, owner), owner.dskPrivateKey);

  const before = await snapshotAcceptedState(familyId);

  // Same signer, same trust-set epoch number, DIFFERENT content: an extra
  // ACTIVE VIEWER entry makes the signed bytes differ while the candidate
  // remains structurally valid, correctly authorized and correctly signed.
  const conflicting = signedCandidate(
    ownerEpochFields(familyId, 2, 2, owner, {
      entries: [entryFor(owner), entryFor(viewer, { role: 'VIEWER' })],
    }),
    owner.dskPrivateKey,
  );

  const result = await service.acceptCandidate(inputFor(familyId, conflicting));
  assert.deepEqual(result, { outcome: 'CONFLICT' });

  assert.deepEqual(await snapshotAcceptedState(familyId), before, 'a conflict must leave every durable value untouched');
  const stored = await new MySqlTrustSetEpochStore().readLatestEpoch(familyId);
  assert.ok(
    stored.signedEpochBytes.equals(Buffer.from(acceptedTs2.bytes, 'utf8')),
    'the ORIGINAL accepted bytes must remain the ones stored',
  );
  assert.equal(stored.signature, acceptedTs2.signature);
  assert.equal(await countEpochRows(familyId, 2), 1);
});

// ---------------------------------------------------------------------
// 7. RESTART / READBACK (durable-state-driven acceptance)
// ---------------------------------------------------------------------

test('RESTART_READBACK: brand-new store/service instances accept ts=3 purely from durable state', async () => {
  const familyId = uniqueFamilyId();
  const owner = makeDevice('owner');
  await seedAnchor(familyId, owner);

  const firstProcess = newService();
  await acceptOk(firstProcess, familyId, ownerEpochFields(familyId, 1, 1, owner), owner.dskPrivateKey);
  await acceptOk(firstProcess, familyId, ownerEpochFields(familyId, 2, 2, owner), owner.dskPrivateKey);

  // "Process B": fresh stores, fresh anchor source, fresh service -- zero
  // shared in-process state. Only the database carries acceptance forward.
  const secondProcess = newService();
  const acceptedTs3 = await acceptOk(secondProcess, familyId, ownerEpochFields(familyId, 3, 3, owner), owner.dskPrivateKey);

  assert.equal(await countEpochRows(familyId), 3);
  assert.deepEqual(await readFloors(familyId), { minimumAcceptedTrustSetEpoch: 3, minimumAcceptedKeyEpoch: 3 });
  const latest = await new MySqlTrustSetEpochStore().readLatestEpoch(familyId);
  assert.equal(latest.trustSetEpoch, 3);
  assert.ok(latest.signedEpochBytes.equals(Buffer.from(acceptedTs3.bytes, 'utf8')));
  assert.equal(latest.signerDeviceId, owner.deviceId);
});

// ---------------------------------------------------------------------
// 8. CROSS-FAMILY ISOLATION
// ---------------------------------------------------------------------

test('CROSS_FAMILY_ISOLATION: identical epoch numbers advance independently; floors and key-epoch reads stay per-family', async () => {
  const service = newService();
  const familyA = uniqueFamilyId();
  const familyB = uniqueFamilyId();
  const ownerA = makeDevice('owner-a');
  const ownerB = makeDevice('owner-b');
  await seedAnchor(familyA, ownerA);
  await seedAnchor(familyB, ownerB);

  // Both families self-establish genesis at the SAME epoch numbers.
  await acceptOk(service, familyA, ownerEpochFields(familyA, 1, 1, ownerA), ownerA.dskPrivateKey);
  await acceptOk(service, familyB, ownerEpochFields(familyB, 1, 1, ownerB), ownerB.dskPrivateKey);

  // Family A advances to ts=2; family B must not move.
  await acceptOk(service, familyA, ownerEpochFields(familyA, 2, 2, ownerA), ownerA.dskPrivateKey);

  assert.deepEqual(await readFloors(familyA), { minimumAcceptedTrustSetEpoch: 2, minimumAcceptedKeyEpoch: 2 });
  assert.deepEqual(await readFloors(familyB), { minimumAcceptedTrustSetEpoch: 1, minimumAcceptedKeyEpoch: 1 });
  assert.deepEqual(await readKeyEpoch(familyA), { trustSetEpoch: 2, keyEpoch: 2 });
  assert.deepEqual(await readKeyEpoch(familyB), { trustSetEpoch: 1, keyEpoch: 1 });

  // Family B still accepts the very same epoch numbers its own history
  // allows, and each family's latest readback stays its own row.
  await acceptOk(service, familyB, ownerEpochFields(familyB, 2, 2, ownerB), ownerB.dskPrivateKey);

  assert.equal(await countEpochRows(familyA), 2);
  assert.equal(await countEpochRows(familyB), 2);
  assert.equal((await new MySqlTrustSetEpochStore().readLatestEpoch(familyA)).familyId, familyA);
  assert.equal((await new MySqlTrustSetEpochStore().readLatestEpoch(familyB)).familyId, familyB);
});

// ---------------------------------------------------------------------
// 9. CONCURRENCY ON THE SAME TRUST-SET EPOCH
// ---------------------------------------------------------------------

test('CONCURRENCY_SAME_TS: two different valid ts=2 candidates race; exactly one ACCEPTED + one CONFLICT and one durable row', async () => {
  const service = newService();
  const familyId = uniqueFamilyId();
  const owner = makeDevice('owner');
  const viewer = makeDevice('viewer');
  await seedAnchor(familyId, owner);
  await acceptOk(service, familyId, ownerEpochFields(familyId, 1, 1, owner), owner.dskPrivateKey);

  // Two DIFFERENT ts=2 candidates, both fully valid: same authorized signer,
  // both correctly signed -- only their content (and therefore bytes) differ.
  const candidateA = signedCandidate(ownerEpochFields(familyId, 2, 2, owner), owner.dskPrivateKey);
  const candidateB = signedCandidate(
    ownerEpochFields(familyId, 2, 2, owner, { entries: [entryFor(owner), entryFor(viewer, { role: 'VIEWER' })] }),
    owner.dskPrivateKey,
  );
  assert.notEqual(candidateA.bytes, candidateB.bytes, 'the two contenders must be genuinely different submissions');

  const outcomes = await recordConcurrentOutcomes('CONCURRENT_SAME_TS_DIFFERENT_BYTES', [
    () => service.acceptCandidate(inputFor(familyId, candidateA)),
    () => service.acceptCandidate(inputFor(familyId, candidateB)),
  ]);

  // The store's APPENDED surfaces here as ACCEPTED; its CONFLICT is passed
  // through unchanged. Exactly one of each, in either order.
  const accepted = outcomes.filter((outcome) => outcome.outcome === 'ACCEPTED');
  const conflicted = outcomes.filter((outcome) => outcome.outcome === 'CONFLICT');
  assert.equal(
    accepted.length,
    1,
    `exactly one contender must win (ACCEPTED == the store's APPENDED): ${JSON.stringify(outcomes)}`,
  );
  assert.equal(
    conflicted.length,
    1,
    `the loser must surface CONFLICT, never a silent absorption: ${JSON.stringify(outcomes)}`,
  );

  assert.equal(await countEpochRows(familyId, 2), 1, 'exactly one ts=2 row may exist');
  assert.equal(await countEpochRows(familyId), 2, 'no partial state: genesis plus exactly one ts=2 row');
  assert.deepEqual(await readFloors(familyId), { minimumAcceptedTrustSetEpoch: 2, minimumAcceptedKeyEpoch: 2 });

  const winner = outcomes[0].outcome === 'ACCEPTED' ? candidateA : candidateB;
  const latest = await new MySqlTrustSetEpochStore().readLatestEpoch(familyId);
  assert.equal(latest.trustSetEpoch, 2);
  assert.ok(
    latest.signedEpochBytes.equals(Buffer.from(winner.bytes, 'utf8')),
    "the durable bytes must be exactly the ACCEPTED contender's",
  );
});

// ---------------------------------------------------------------------
// MACHINE-READABLE CONCURRENCY OUTCOMES (for the coordinator lane)
// ---------------------------------------------------------------------

test('CONCURRENCY OUTCOMES (machine-readable): raw outcomes are captured for the coordinator lane', () => {
  assert.ok(Object.prototype.hasOwnProperty.call(CONCURRENCY_OUTCOMES, 'CONCURRENT_SAME_TS_DIFFERENT_BYTES'));
  console.log(`[familytrustset-epoch-acceptance-concurrency-outcomes] ${JSON.stringify(CONCURRENCY_OUTCOMES)}`);
});

test.after(async () => {
  await closePool();
});
