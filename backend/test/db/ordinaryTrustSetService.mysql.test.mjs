// This campaign may write synthetic fixtures only inside a verifier-owned random disposable DB.
import '../../scripts/require-owned-disposable-db.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { generateKeyPairSync, randomUUID, randomBytes, sign } from 'node:crypto';
import { getPool, closePool } from '../../dist/db/pool.js';
import { canonicalizeP256Signature } from '../../dist/deviceauth/P256DeviceSignatureVerifier.js';
import { canonicalizeTrustSetEpoch } from '../../dist/familytrustset/canonicalize.js';
import { MySqlTrustSetEpochStore } from '../../dist/familytrustset/MySqlTrustSetEpochStore.js';
import { MySqlKeyEpochStore } from '../../dist/familytrustset/MySqlKeyEpochStore.js';
import { MySqlEpochFloorStore } from '../../dist/familytrustset/MySqlEpochFloorStore.js';
import { MySqlGenesisAnchorSource } from '../../dist/familytrustset/GenesisAnchorSource.js';
import { P256TrustSetSignatureVerifier } from '../../dist/familytrustset/P256TrustSetSignatureVerifier.js';
import { TrustSetEpochAcceptanceService } from '../../dist/familytrustset/TrustSetEpochAcceptance.js';
import { OrdinaryTrustSetService } from '../../dist/familytrustset/OrdinaryTrustSetService.js';

function createDevice(role) {
  const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = keys.publicKey.export({ format: 'jwk' });
  return { privateKey: keys.privateKey, entry: {
    deviceId: randomUUID(), role, status: 'ACTIVE', dskKeyId: randomUUID(),
    dskPublicKey: Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]).toString('base64url'),
    dekKeyId: randomUUID(), dekPublicKey: randomBytes(32).toString('base64url'),
  } };
}
function compose() {
  const store = new MySqlTrustSetEpochStore();
  const acceptance = new TrustSetEpochAcceptanceService({ epochStore: store,
    keyEpochStore: new MySqlKeyEpochStore(), floorStore: new MySqlEpochFloorStore(),
    genesisAnchorSource: new MySqlGenesisAnchorSource(), verifier: new P256TrustSetSignatureVerifier() });
  return { store, acceptance, service: new OrdinaryTrustSetService(acceptance) };
}
async function fixture() {
  const familyId = `ordinary-db-${randomUUID()}`;
  const owner = createDevice('OWNER'), child = createDevice('CHILD');
  const scope = { familyId, deviceId: owner.entry.deviceId };
  const receivedAt = new Date('2026-10-09T00:00:00.000Z');
  const composed = compose();
  const request = (trustSetEpoch, overrides = {}) => {
    const canonical = canonicalizeTrustSetEpoch({ familyId, trustSetEpoch, keyEpoch: 1,
      entries: [owner.entry, child.entry], issuedAt: receivedAt,
      supersedesEpoch: trustSetEpoch === 1 ? null : trustSetEpoch - 1, ...overrides });
    const signature = canonicalizeP256Signature(sign('sha256', Buffer.from(canonical), { key: owner.privateKey, dsaEncoding: 'ieee-p1363' }));
    return { canonicalEpochBase64: Buffer.from(canonical).toString('base64'), signatureBase64: signature.toString('base64') };
  };
  await getPool().query(`INSERT INTO family_authority_genesis_anchors
    (family_id, genesis_device_id, genesis_dsk_key_id, genesis_dsk_public_key, protocol_version, created_at, signature)
    VALUES (?, ?, ?, ?, ?, ?, ?)`, [familyId, owner.entry.deviceId, owner.entry.dskKeyId,
    owner.entry.dskPublicKey, 1, receivedAt, 'disposable-anchor-fixture']);
  const first = request(1);
  assert.deepEqual(await composed.acceptance.acceptCandidate({ familyId,
    signedCanonicalBytes: Buffer.from(first.canonicalEpochBase64, 'base64').toString(),
    signature: Buffer.from(first.signatureBase64, 'base64').toString('base64url'), receivedAt }), { outcome: 'ACCEPTED' });
  return { ...composed, familyId, scope, owner, child, request };
}
async function snapshot(familyId) {
  return { epochs: (await new MySqlTrustSetEpochStore().listEpochs(familyId)).map(row => ({
    epoch: row.trustSetEpoch, keyEpoch: row.keyEpoch, bytes: row.signedEpochBytes.toString('hex'), signature: row.signature,
  })), floors: await new MySqlEpochFloorStore().readFloors(familyId) };
}

test('MySQL facade retains exact acceptance across process recreation and advanced-head lost-response retry', async () => {
  const f = await fixture(); const second = f.request(2);
  const accepted = await f.service.submit(f.scope, second);
  assert.equal(accepted.outcome, 'ACCEPTED');
  assert.equal(accepted.acceptedEpoch.canonicalEpochBase64, second.canonicalEpochBase64);
  assert.equal(accepted.acceptedEpoch.signatureBase64, second.signatureBase64);
  await f.service.submit(f.scope, f.request(3, { keyEpoch: 2 }));
  const before = await snapshot(f.familyId), restarted = compose();
  const status = await restarted.service.status(f.scope, second);
  assert.equal(status.outcome, 'ACCEPTED'); assert.equal(status.acceptedEpoch.trustSetEpoch, 2);
  assert.equal(status.acceptedHead.trustSetEpoch, 3); assert.equal(status.acceptedHead.keyEpoch, 2);
  assert.equal((await restarted.service.submit(f.scope, second)).outcome, 'IDEMPOTENT_MATCH');
  assert.deepEqual(await snapshot(f.familyId), before, 'historical receipts never append or lower floors');
  const indexed = await restarted.store.readEpoch(f.familyId, 2);
  assert.equal(indexed.signedEpochBytes.toString('base64'), second.canonicalEpochBase64);
  assert.equal(await restarted.store.readEpoch(`foreign-${randomUUID()}`, 2), null);
  assert.equal(await restarted.store.readEpoch(f.familyId, 4), null);
  await assert.rejects(restarted.store.readEpoch(f.familyId, 0), error => error.code === 'INVALID_INPUT');
});

test('MySQL facade conflicts, wrong scope and stale rotation preserve exact durable rows and floors', async () => {
  const f = await fixture(); await f.service.submit(f.scope, f.request(2, { keyEpoch: 2 }));
  const before = await snapshot(f.familyId);
  const conflicting = f.request(2, { issuedAt: new Date('2026-10-09T01:00:00.000Z'), keyEpoch: 2 });
  await assert.rejects(f.service.submit(f.scope, conflicting), error => error.code === 'CONFLICT');
  assert.equal((await f.service.status(f.scope, conflicting)).outcome, 'CONFLICT');
  await assert.rejects(f.service.submit(f.scope, f.request(3, { familyId: `foreign-${randomUUID()}` })), error => error.code === 'FAMILY_MISMATCH');
  await assert.rejects(f.service.submit({ ...f.scope, deviceId: randomUUID() }, f.request(3)), error => error.code === 'DEVICE_NOT_ACTIVE');
  await assert.rejects(f.service.submit(f.scope, f.request(3)), error => error.reason === 'STALE_KEY_EPOCH');
  assert.deepEqual(await snapshot(f.familyId), before);
});

test('MySQL accepted membership controls head reads and revocation denies catch-up without inventing ACTIVE', async () => {
  const f = await fixture(), childScope = { familyId: f.familyId, deviceId: f.child.entry.deviceId };
  assert.equal((await f.service.head(childScope)).trustSetEpoch, 1);
  await assert.rejects(f.service.status(childScope, f.request(2)), error => error.code === 'OWNER_REQUIRED');
  await assert.rejects(f.service.submit(childScope, f.request(2)), error => error.code === 'OWNER_REQUIRED');
  await f.service.submit(f.scope, f.request(2, { entries: [f.owner.entry, { ...f.child.entry, status: 'REVOKED' }] }));
  await assert.rejects(compose().service.head(childScope), error => error.code === 'DEVICE_NOT_ACTIVE');
  assert.equal((await f.store.readLatestEpoch(f.familyId)).trustSetEpoch, 2);
});

test('MySQL indexed history denies a child revoked while its historical epoch read is in flight', async () => {
  const f = await fixture();
  const childScope = { familyId: f.familyId, deviceId: f.child.entry.deviceId };
  const readAcceptedEpoch = f.acceptance.readAcceptedEpoch.bind(f.acceptance);
  let signalLookupStarted;
  let releaseLookup;
  const lookupStarted = new Promise(resolve => { signalLookupStarted = resolve; });
  const lookupGate = new Promise(resolve => { releaseLookup = resolve; });
  let held = false;
  f.acceptance.readAcceptedEpoch = async (familyId, trustSetEpoch) => {
    if (familyId === f.familyId && trustSetEpoch === 1 && !held) {
      held = true;
      signalLookupStarted();
      await lookupGate;
    }
    return readAcceptedEpoch(familyId, trustSetEpoch);
  };

  const historicalRead = f.service.epoch(childScope, 1);
  await lookupStarted;
  try {
    const revokedChildEpoch = f.request(2, {
      entries: [f.owner.entry, { ...f.child.entry, status: 'REVOKED' }],
    });
    const accepted = await f.service.submit(f.scope, revokedChildEpoch);
    assert.equal(accepted.acceptedHead.trustSetEpoch, 2);
    assert.equal((await f.store.readEpoch(f.familyId, 2)).trustSetEpoch, 2);
  } finally {
    releaseLookup();
  }

  await assert.rejects(
    historicalRead,
    error => error.code === 'DEVICE_NOT_ACTIVE',
    'the historical signed bytes must not be returned after the second membership check sees revocation',
  );
});

test('MySQL competing same-number signed submissions have one winner, exact retry idempotency and immutable loser conflict', async () => {
  const f = await fixture(); const first = f.request(2);
  const second = f.request(2, { issuedAt: new Date('2026-10-09T00:00:01.000Z') });
  const results = await Promise.allSettled([compose().service.submit(f.scope, first), compose().service.submit(f.scope, second)]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.find(result => result.status === 'rejected').reason.code, 'CONFLICT');
  const winner = results[0].status === 'fulfilled' ? first : second;
  const stored = await f.store.readEpoch(f.familyId, 2);
  assert.equal(stored.signedEpochBytes.toString('base64'), winner.canonicalEpochBase64);
  assert.equal((await f.store.listEpochs(f.familyId)).length, 2);
  const replays = await Promise.all([compose().service.submit(f.scope, winner), compose().service.submit(f.scope, winner)]);
  assert.ok(replays.every(result => result.outcome === 'IDEMPOTENT_MATCH'));
  assert.deepEqual(await new MySqlEpochFloorStore().readFloors(f.familyId), {
    minimumAcceptedTrustSetEpoch: 2, minimumAcceptedKeyEpoch: 1 });
});

test.after(async () => { await closePool(); });
