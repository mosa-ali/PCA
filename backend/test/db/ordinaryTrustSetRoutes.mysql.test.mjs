// This campaign may write synthetic fixtures only inside a verifier-owned random disposable DB.
import '../../scripts/require-owned-disposable-db.mjs';
import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import Fastify from 'fastify';
import { generateKeyPairSync, randomBytes, randomUUID, sign } from 'node:crypto';
import { getPool, closePool } from '../../dist/db/pool.js';
import { createRateLimiter } from '../../dist/http/rateLimit.js';
import { registerOrdinaryTrustSetRoutes } from '../../dist/http/routes/ordinaryTrustSetRoutes.js';
import { canonicalizeP256Signature } from '../../dist/deviceauth/P256DeviceSignatureVerifier.js';
import { P256DeviceSignatureVerifier } from '../../dist/deviceauth/P256DeviceSignatureVerifier.js';
import { DeviceAuthService } from '../../dist/deviceauth/DeviceAuthService.js';
import { MySqlDeviceChallengeRepository } from '../../dist/deviceauth/MySqlDeviceChallengeRepository.js';
import { canonicalizeTrustSetEpoch } from '../../dist/familytrustset/canonicalize.js';
import { MySqlDeviceRepository } from '../../dist/device/MySqlDeviceRepository.js';
import { MySqlEpochFloorStore } from '../../dist/familytrustset/MySqlEpochFloorStore.js';
import { MySqlGenesisAnchorSource } from '../../dist/familytrustset/GenesisAnchorSource.js';
import { MySqlKeyEpochStore } from '../../dist/familytrustset/MySqlKeyEpochStore.js';
import { MySqlTrustSetEpochStore } from '../../dist/familytrustset/MySqlTrustSetEpochStore.js';
import { OrdinaryTrustSetService } from '../../dist/familytrustset/OrdinaryTrustSetService.js';
import { P256TrustSetSignatureVerifier } from '../../dist/familytrustset/P256TrustSetSignatureVerifier.js';
import { StoreBackedTrustSetRoleResolver } from '../../dist/familytrustset/StoreBackedTrustSetRoleResolver.js';
import { TrustSetEpochAcceptanceService } from '../../dist/familytrustset/TrustSetEpochAcceptance.js';
import { DeviceSessionService, InMemoryDeviceSessionRepository } from '../../dist/runtime-sync/index.js';

function createDevice(role) {
  const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = keys.publicKey.export({ format: 'jwk' });
  return {
    privateKey: keys.privateKey,
    entry: {
      deviceId: randomUUID(),
      role,
      status: 'ACTIVE',
      dskKeyId: randomUUID(),
      dskPublicKey: Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]).toString('base64url'),
      dekKeyId: randomUUID(),
      dekPublicKey: randomBytes(32).toString('base64url'),
    },
  };
}

function compose() {
  const store = new MySqlTrustSetEpochStore();
  const verifier = new P256TrustSetSignatureVerifier();
  const roleResolver = new StoreBackedTrustSetRoleResolver({
    epochStore: store,
    deviceRepository: new MySqlDeviceRepository(),
    verifier,
  });
  const acceptance = new TrustSetEpochAcceptanceService({
    epochStore: store,
    keyEpochStore: new MySqlKeyEpochStore(),
    floorStore: new MySqlEpochFloorStore(),
    genesisAnchorSource: new MySqlGenesisAnchorSource(),
    verifier,
  });
  return {
    store,
    service: new OrdinaryTrustSetService(acceptance, roleResolver),
    acceptance,
  };
}

async function createFamilyFixture(composed) {
  const familyId = randomUUID();
  const owner = createDevice('OWNER');
  const child = createDevice('CHILD');
  // This ACTIVE directory device is intentionally absent from the accepted Trust Set.
  const outsider = createDevice('CHILD');
  const receivedAt = new Date('2026-10-09T00:00:00.000Z');
  const request = (trustSetEpoch, overrides = {}) => {
    const canonical = canonicalizeTrustSetEpoch({
      familyId,
      trustSetEpoch,
      keyEpoch: 1,
      entries: [owner.entry, child.entry],
      issuedAt: receivedAt,
      supersedesEpoch: trustSetEpoch === 1 ? null : trustSetEpoch - 1,
      ...overrides,
    });
    const signature = canonicalizeP256Signature(sign('sha256', Buffer.from(canonical), {
      key: owner.privateKey,
      dsaEncoding: 'ieee-p1363',
    }));
    return {
      canonicalEpochBase64: Buffer.from(canonical).toString('base64'),
      signatureBase64: signature.toString('base64'),
    };
  };

  await getPool().query(
    `INSERT INTO families (family_id, family_reference_hash, created_at, status)
     VALUES (?, ?, ?, 'ACTIVE')`,
    [familyId, randomBytes(32), receivedAt],
  );
  for (const device of [owner, child, outsider]) {
    await getPool().query(
      `INSERT INTO devices (device_id, family_id, platform, status, created_at)
       VALUES (?, ?, 'ANDROID', 'ACTIVE', ?)`,
      [device.entry.deviceId, familyId, receivedAt],
    );
    await getPool().query(
      `INSERT INTO device_public_keys (device_id, key_id, key_purpose, public_key, status, created_at, revoked_at)
       VALUES (?, ?, 'DSK', ?, 'ACTIVE', ?, NULL)`,
      [device.entry.deviceId, device.entry.dskKeyId, device.entry.dskPublicKey, receivedAt],
    );
  }
  await getPool().query(
    `INSERT INTO family_authority_genesis_anchors
      (family_id, genesis_device_id, genesis_dsk_key_id, genesis_dsk_public_key, protocol_version, created_at, signature)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [familyId, owner.entry.deviceId, owner.entry.dskKeyId, owner.entry.dskPublicKey,
      1, receivedAt, 'disposable-anchor-fixture'],
  );

  const genesis = request(1);
  const acceptance = await composed.acceptance.acceptCandidate({
    familyId,
    signedCanonicalBytes: Buffer.from(genesis.canonicalEpochBase64, 'base64').toString(),
    signature: Buffer.from(genesis.signatureBase64, 'base64').toString('base64url'),
    receivedAt,
  });
  assert.deepEqual(acceptance, { outcome: 'ACCEPTED' });

  return { familyId, owner, child, outsider, request, genesis };
}

function routeFixture(composed, deviceSessionService) {
  const app = Fastify({ logger: false });
  registerOrdinaryTrustSetRoutes(app, {
    deviceSessionService,
    ordinaryTrustSetService: composed.service,
    rateLimiter: createRateLimiter(),
  });
  return app;
}

async function issueVerifiedSession(deviceSessionService, familyId, device) {
  const challenge = await deviceSessionService.issueChallengeSafely(device.entry.deviceId);
  const signature = canonicalizeP256Signature(sign('sha256', Buffer.from(challenge.nonce, 'utf8'), {
    key: device.privateKey,
    dsaEncoding: 'ieee-p1363',
  }));
  const issued = await deviceSessionService.completeChallenge(device.entry.deviceId, challenge.challengeId, signature.toString('base64url'));
  const identity = await deviceSessionService.validateSession(issued.rawToken);
  assert.deepEqual(identity, {
    familyId,
    deviceId: device.entry.deviceId,
    dskKeyId: device.entry.dskKeyId,
    purpose: 'ACTIVE',
    activationTargetGeneration: null,
    bootstrapChallengeId: null,
  });
  return issued.rawToken;
}

const base = (familyId) => `/api/device/families/${familyId}/trust-set/epochs`;
const bearer = (token) => ({ authorization: `Bearer ${token}` });

async function durableFamilyState(composed, familyId) {
  const epochs = await composed.store.listEpochs(familyId);
  return {
    epochs: epochs.map(({ signedEpochBytes, ...record }) => ({
      ...record,
      signedEpochBytes: signedEpochBytes.toString('hex'),
    })),
    floors: await new MySqlEpochFloorStore().readFloors(familyId),
  };
}

test('MySQL HTTP ordinary Trust Set routes bind verified device scope to durable acceptance and isolate families/members', async (t) => {
  const composed = compose();
  const familyA = await createFamilyFixture(composed);
  const familyB = await createFamilyFixture(composed);
  const deviceRepository = new MySqlDeviceRepository();
  const deviceAuthService = new DeviceAuthService(
    new MySqlDeviceChallengeRepository(),
    deviceRepository,
    new P256DeviceSignatureVerifier(),
  );
  const deviceSessionService = new DeviceSessionService(deviceAuthService, new InMemoryDeviceSessionRepository());
  const sessions = {
    ownerA: await issueVerifiedSession(deviceSessionService, familyA.familyId, familyA.owner),
    childA: await issueVerifiedSession(deviceSessionService, familyA.familyId, familyA.child),
    outsiderA: await issueVerifiedSession(deviceSessionService, familyA.familyId, familyA.outsider),
    ownerB: await issueVerifiedSession(deviceSessionService, familyB.familyId, familyB.owner),
  };
  const app = routeFixture(composed, deviceSessionService);
  t.after(() => app.close());

  const headA = await app.inject({ method: 'GET', url: `${base(familyA.familyId)}/head`, headers: bearer(sessions.ownerA) });
  assert.equal(headA.statusCode, 200);
  assert.equal(headA.json().acceptedHead.canonicalEpochBase64, familyA.genesis.canonicalEpochBase64);
  assert.equal(headA.json().acceptedHead.trustSetEpoch, 1);

  const headB = await app.inject({ method: 'GET', url: `${base(familyB.familyId)}/head`, headers: bearer(sessions.ownerB) });
  assert.equal(headB.statusCode, 200);
  assert.equal(headB.json().acceptedHead.canonicalEpochBase64, familyB.genesis.canonicalEpochBase64);
  assert.notEqual(headB.json().acceptedHead.canonicalEpochBase64, headA.json().acceptedHead.canonicalEpochBase64);

  // A valid session cannot substitute another family's route parameter.
  const crossFamily = await app.inject({ method: 'GET', url: `${base(familyB.familyId)}/head`, headers: bearer(sessions.ownerA) });
  assert.equal(crossFamily.statusCode, 403);
  assert.deepEqual(crossFamily.json(), { error: 'forbidden' });

  // A directory-active device omitted from the accepted Trust Set cannot read the head.
  const outsiderRead = await app.inject({ method: 'GET', url: `${base(familyA.familyId)}/head`, headers: bearer(sessions.outsiderA) });
  assert.equal(outsiderRead.statusCode, 403);
  assert.deepEqual(outsiderRead.json(), { error: 'forbidden' });

  // A current member may read the shared accepted head, but only its OWNER can submit/reconcile.
  const childHead = await app.inject({ method: 'GET', url: `${base(familyA.familyId)}/head`, headers: bearer(sessions.childA) });
  assert.equal(childHead.statusCode, 200);
  assert.equal(childHead.json().acceptedHead.canonicalEpochBase64, familyA.genesis.canonicalEpochBase64);
  const next = familyA.request(2);
  const childSubmit = await app.inject({ method: 'POST', url: base(familyA.familyId), headers: bearer(sessions.childA), payload: next });
  assert.equal(childSubmit.statusCode, 403);
  assert.deepEqual(childSubmit.json(), { error: 'forbidden' });

  const submit = await app.inject({ method: 'POST', url: base(familyA.familyId), headers: bearer(sessions.ownerA), payload: next });
  assert.equal(submit.statusCode, 200);
  const expectedAccepted = {
    ...next,
    signerDeviceId: familyA.owner.entry.deviceId,
    signerKeyId: familyA.owner.entry.dskKeyId,
    trustSetEpoch: 2,
    keyEpoch: 1,
  };
  assert.deepEqual(submit.json(), { outcome: 'ACCEPTED', acceptedEpoch: expectedAccepted, acceptedHead: expectedAccepted });

  const exactStatus = await app.inject({ method: 'POST', url: `${base(familyA.familyId)}/status`, headers: bearer(sessions.ownerA), payload: next });
  assert.equal(exactStatus.statusCode, 200);
  assert.deepEqual(exactStatus.json(), { outcome: 'ACCEPTED', acceptedEpoch: expectedAccepted, acceptedHead: expectedAccepted });

  const exactReplay = await app.inject({ method: 'POST', url: base(familyA.familyId), headers: bearer(sessions.ownerA), payload: next });
  assert.equal(exactReplay.statusCode, 200);
  assert.deepEqual(exactReplay.json(), { outcome: 'IDEMPOTENT_MATCH', acceptedEpoch: expectedAccepted, acceptedHead: expectedAccepted });

  // This candidate is canonically encoded and signed by the current owner,
  // but attempts to branch epoch 3 from the stale epoch 1 predecessor.
  const beforeStalePredecessor = await durableFamilyState(composed, familyA.familyId);
  const stalePredecessor = familyA.request(3, { supersedesEpoch: 1 });
  const staleSubmit = await app.inject({
    method: 'POST',
    url: base(familyA.familyId),
    headers: bearer(sessions.ownerA),
    payload: stalePredecessor,
  });
  assert.equal(staleSubmit.statusCode, 409);
  assert.deepEqual(staleSubmit.json(), { error: 'trust_set_rejected' });
  const afterStalePredecessor = await durableFamilyState(composed, familyA.familyId);
  assert.deepEqual(afterStalePredecessor, beforeStalePredecessor);
  assert.equal(afterStalePredecessor.epochs.length, 2);
  assert.deepEqual(afterStalePredecessor.floors, {
    minimumAcceptedTrustSetEpoch: 2,
    minimumAcceptedKeyEpoch: 1,
  });
  const headAfterStale = await app.inject({ method: 'GET', url: `${base(familyA.familyId)}/head`, headers: bearer(sessions.ownerA) });
  assert.equal(headAfterStale.statusCode, 200);
  assert.deepEqual(headAfterStale.json(), { acceptedHead: expectedAccepted });
  const absentBranch = await app.inject({ method: 'GET', url: `${base(familyA.familyId)}/records/3`, headers: bearer(sessions.ownerA) });
  assert.equal(absentBranch.statusCode, 404);
  assert.deepEqual(absentBranch.json(), { error: 'trust_set_record_unavailable' });

  const conflict = familyA.request(2, { issuedAt: new Date('2026-10-09T01:00:00.000Z') });
  const conflictStatus = await app.inject({ method: 'POST', url: `${base(familyA.familyId)}/status`, headers: bearer(sessions.ownerA), payload: conflict });
  assert.equal(conflictStatus.statusCode, 200);
  assert.deepEqual(conflictStatus.json(), { outcome: 'CONFLICT', acceptedEpoch: null, acceptedHead: expectedAccepted });
  const conflictSubmit = await app.inject({ method: 'POST', url: base(familyA.familyId), headers: bearer(sessions.ownerA), payload: conflict });
  assert.equal(conflictSubmit.statusCode, 409);
  assert.deepEqual(conflictSubmit.json(), { error: 'trust_set_conflict' });

  const history = await app.inject({ method: 'GET', url: `${base(familyA.familyId)}/records/2`, headers: bearer(sessions.ownerA) });
  assert.equal(history.statusCode, 200);
  assert.deepEqual(history.json(), { acceptedEpoch: expectedAccepted });
  const outsiderHistory = await app.inject({ method: 'GET', url: `${base(familyA.familyId)}/records/2`, headers: bearer(sessions.outsiderA) });
  assert.equal(outsiderHistory.statusCode, 403);
  assert.deepEqual(outsiderHistory.json(), { error: 'forbidden' });
});

after(async () => { await closePool(); });
