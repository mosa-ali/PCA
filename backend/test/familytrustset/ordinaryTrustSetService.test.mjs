import assert from 'node:assert/strict';
import test from 'node:test';
import { generateKeyPairSync, sign } from 'node:crypto';
import { canonicalizeP256Signature } from '../../dist/deviceauth/P256DeviceSignatureVerifier.js';
import { canonicalizeTrustSetEpoch } from '../../dist/familytrustset/canonicalize.js';
import { TrustSetEpochAcceptanceService } from '../../dist/familytrustset/TrustSetEpochAcceptance.js';
import { OrdinaryTrustSetService } from '../../dist/familytrustset/OrdinaryTrustSetService.js';
import { P256TrustSetSignatureVerifier } from '../../dist/familytrustset/P256TrustSetSignatureVerifier.js';
import { StoreBackedTrustSetRoleResolver } from '../../dist/familytrustset/StoreBackedTrustSetRoleResolver.js';

const FAMILY = 'ordinary-family';
const OWNER = 'ordinary-owner';
const scope = { familyId: FAMILY, deviceId: OWNER, dskKeyId: 'owner-dsk' };
function fixture() {
  const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = keys.publicKey.export({ format: 'jwk' });
  const publicKey = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]).toString('base64url');
  const ownerEntry = { deviceId: OWNER, role: 'OWNER', status: 'ACTIVE', dskKeyId: 'owner-dsk', dskPublicKey: publicKey,
    dekKeyId: 'owner-dek', dekPublicKey: 'distinct-dek' };
  const childEntry = { deviceId: 'child-device', role: 'CHILD', status: 'ACTIVE', dskKeyId: 'child-dsk', dskPublicKey: 'child-dsk-public',
    dekKeyId: 'child-dek', dekPublicKey: 'child-dek-public' };
  const rows = new Map();
  let floor = null;
  let appends = 0;
  const latest = () => [...rows.values()].sort((a, b) => b.trustSetEpoch - a.trustSetEpoch)[0] ?? null;
  const store = {
    readLatestEpoch: async () => latest(),
    readEpoch: async (familyId, epoch) => rows.get(`${familyId}/${epoch}`) ?? null,
    listEpochs: async () => [...rows.values()],
    appendAcceptedEpoch: async (record, expected) => {
      appends += 1;
      const existing = rows.get(`${record.familyId}/${record.trustSetEpoch}`);
      if (existing) return { outcome: existing.signedEpochBytes.equals(record.signedEpochBytes) && existing.signature === record.signature ? 'IDEMPOTENT_MATCH' : 'CONFLICT' };
      const head = latest();
      if ((expected === null) !== (head === null) || expected &&
          (head.trustSetEpoch !== expected.trustSetEpoch || !head.signedEpochBytes.equals(expected.signedEpochBytes) || head.signature !== expected.signature)) {
        return { outcome: 'REJECTED_STALE_AUTHORITY' };
      }
      rows.set(`${record.familyId}/${record.trustSetEpoch}`, record);
      floor = { minimumAcceptedTrustSetEpoch: record.trustSetEpoch, minimumAcceptedKeyEpoch: record.keyEpoch };
      return { outcome: 'APPENDED' };
    },
  };
  const deviceStatuses = new Map([[OWNER, 'ACTIVE'], [childEntry.deviceId, 'ACTIVE']]);
  const keyStatuses = new Map([[OWNER, 'ACTIVE'], [childEntry.deviceId, 'ACTIVE']]);
  const additionalKeys = new Map();
  const deviceRepository = {
    isDeviceSessionActive: async (familyId, deviceId) => familyId === FAMILY && deviceStatuses.get(deviceId) === 'ACTIVE',
    findKeysByDeviceForFamily: async (familyId, deviceId) => {
      if (familyId !== FAMILY) return [];
      const entry = [ownerEntry, childEntry].find((candidate) => candidate.deviceId === deviceId);
      if (!entry) return [];
      return [{ deviceId, keyId: entry.dskKeyId, keyPurpose: 'DSK', publicKey: entry.dskPublicKey,
        status: keyStatuses.get(deviceId) }, ...(additionalKeys.get(deviceId) ?? [])];
    },
  };
  const verifier = new P256TrustSetSignatureVerifier();
  const acceptance = new TrustSetEpochAcceptanceService({ epochStore: store,
    floorStore: { readFloors: async () => floor },
    keyEpochStore: { readCanonicalKeyEpoch: async () => latest() && { trustSetEpoch: latest().trustSetEpoch, keyEpoch: latest().keyEpoch } },
    genesisAnchorSource: { readGenesisAnchor: async () => ({ genesisDeviceId: OWNER, genesisDskKeyId: 'owner-dsk', genesisDskPublicKey: publicKey }) },
    verifier });
  const roleResolver = new StoreBackedTrustSetRoleResolver({ epochStore: store, deviceRepository, verifier });
  const service = new OrdinaryTrustSetService(acceptance, roleResolver);
  function request(epochNumber, overrides = {}) {
    const fields = { familyId: FAMILY, trustSetEpoch: epochNumber, keyEpoch: 1,
      entries: [structuredClone(ownerEntry), structuredClone(childEntry)],
      issuedAt: new Date('2026-10-09T00:00:00.000Z'), supersedesEpoch: epochNumber === 1 ? null : epochNumber - 1, ...overrides };
    const bytes = canonicalizeTrustSetEpoch(fields);
    const signature = canonicalizeP256Signature(sign('sha256', Buffer.from(bytes), { key: keys.privateKey, dsaEncoding: 'ieee-p1363' }));
    return { canonicalEpochBase64: Buffer.from(bytes).toString('base64'), signatureBase64: signature.toString('base64') };
  }
  async function bootstrap() {
    const first = request(1);
    assert.deepEqual(await acceptance.acceptCandidate({ familyId: FAMILY,
      signedCanonicalBytes: Buffer.from(first.canonicalEpochBase64, 'base64').toString(),
      signature: Buffer.from(first.signatureBase64, 'base64').toString('base64url'), receivedAt: new Date() }), { outcome: 'ACCEPTED' });
    return first;
  }
  return { service, acceptance, request, bootstrap, store, rows, ownerEntry, childEntry, deviceStatuses, keyStatuses, additionalKeys,
    createService: () => new OrdinaryTrustSetService(acceptance, roleResolver),
    get appends() { return appends; }, setFloor(value) { floor = value; } };
}
const rejectsCode = (code) => (error) => error.code === code;

test('ordinary epoch accepts once and exact restart/lost-response retry is immutable', async () => {
  const f = fixture(); await f.bootstrap();
  const request = f.request(2);
  const result = await f.service.submit(scope, request);
  assert.equal(result.outcome, 'ACCEPTED');
  assert.deepEqual(result.acceptedEpoch, result.acceptedHead);
  assert.equal(result.acceptedEpoch.canonicalEpochBase64, request.canonicalEpochBase64);
  assert.equal(result.acceptedEpoch.signatureBase64, request.signatureBase64);
  const restarted = f.createService();
  assert.equal((await restarted.submit(scope, structuredClone(request))).outcome, 'IDEMPOTENT_MATCH');
  assert.equal(f.appends, 2);
  assert.equal((await restarted.status(scope, request)).outcome, 'ACCEPTED');
});

test('historical exact retry keeps advanced head and never lowers floors or appends', async () => {
  const f = fixture(); await f.bootstrap(); const second = f.request(2);
  await f.service.submit(scope, second); await f.service.submit(scope, f.request(3));
  const result = await f.service.submit(scope, second);
  assert.equal(result.outcome, 'IDEMPOTENT_MATCH');
  assert.equal(result.acceptedEpoch.trustSetEpoch, 2); assert.equal(result.acceptedHead.trustSetEpoch, 3);
  assert.equal((await f.service.status(scope, second)).acceptedHead.trustSetEpoch, 3);
  assert.equal(f.appends, 3);
});

test('conflicting replay including same bytes with a new signature cannot become success', async () => {
  const f = fixture(); await f.bootstrap(); await f.service.submit(scope, f.request(2));
  const conflict = f.request(2, { issuedAt: new Date('2026-10-09T01:00:00.000Z') });
  await assert.rejects(f.service.submit(scope, conflict), rejectsCode('CONFLICT'));
  assert.equal((await f.service.status(scope, conflict)).outcome, 'CONFLICT');
  assert.equal((await f.service.status(scope, conflict)).acceptedEpoch, null);
  await assert.rejects(f.service.submit(scope, f.request(2)), rejectsCode('CONFLICT'));
  assert.equal(f.appends, 2);
});

test('ordinary endpoint cannot bootstrap epoch one or invent root for a virgin family', async () => {
  const f = fixture();
  await assert.rejects(f.service.submit(scope, f.request(1)), rejectsCode('GENESIS_NOT_ALLOWED'));
  await assert.rejects(f.service.submit(scope, f.request(2)), rejectsCode('NO_TRUST_SET'));
  assert.equal(f.appends, 0);
});

test('indexed signed history is bounded, family scoped and requires current active membership', async () => {
  const f = fixture(); const first = await f.bootstrap();
  await f.service.submit(scope, f.request(2));
  const child = { familyId: FAMILY, deviceId: 'child-device', dskKeyId: 'child-dsk' };
  const historical = await f.service.epoch(child, 1);
  assert.equal(historical.canonicalEpochBase64, first.canonicalEpochBase64);
  assert.equal(historical.signatureBase64, first.signatureBase64);
  assert.equal(historical.trustSetEpoch, 1);
  await assert.rejects(f.service.epoch(child, 3), rejectsCode('EPOCH_NOT_FOUND'));
  for (const invalid of [0, -1, 1.5, NaN, 2_147_483_648]) {
    await assert.rejects(f.service.epoch(child, invalid), rejectsCode('INVALID_REQUEST'));
  }
  await assert.rejects(f.service.epoch({ ...scope, deviceId: 'foreign-device' }, 1), rejectsCode('DEVICE_NOT_ACTIVE'));
  await assert.rejects(f.service.epoch({ ...scope, familyId: 'another-family' }, 1));
  assert.equal(f.appends, 2);
});

test('indexed history does not expose a record when membership is revoked during lookup', async () => {
  const f = fixture(); const second = f.request(2);
  await f.bootstrap(); await f.service.submit(scope, second);
  const child = { familyId: FAMILY, deviceId: 'child-device', dskKeyId: 'child-dsk' };

  const readAcceptedEpoch = f.acceptance.readAcceptedEpoch.bind(f.acceptance);
  let signalLookupStarted;
  let releaseLookup;
  const lookupStarted = new Promise((resolve) => { signalLookupStarted = resolve; });
  const lookupGate = new Promise((resolve) => { releaseLookup = resolve; });
  let held = false;
  f.acceptance.readAcceptedEpoch = async (familyId, epoch) => {
    if (epoch === 1 && !held) {
      held = true;
      signalLookupStarted();
      await lookupGate;
    }
    return readAcceptedEpoch(familyId, epoch);
  };

  const read = f.service.epoch(child, 1);
  try {
    await lookupStarted;
    const entries = (await import('../../dist/familytrustset/decode.js'))
      .decodeCanonicalTrustSetEpochBytes(Buffer.from(second.canonicalEpochBase64, 'base64')).entries;
    entries[1].status = 'REVOKED';
    await f.service.submit(scope, f.request(3, { entries }));
  } finally {
    releaseLookup();
  }

  // The first membership check passed, but the accepted head now revokes this
  // device. The second check must reject before the previously read record is
  // returned to the caller.
  await assert.rejects(read, rejectsCode('DEVICE_NOT_ACTIVE'));
});

test('head is available to active child but submit and exact status require current owner', async () => {
  const f = fixture(); await f.bootstrap(); const child = { familyId: FAMILY, deviceId: 'child-device', dskKeyId: 'child-dsk' };
  assert.equal((await f.service.head(child)).trustSetEpoch, 1);
  await assert.rejects(f.service.submit(child, f.request(2)), rejectsCode('OWNER_REQUIRED'));
  await assert.rejects(f.service.status(child, f.request(2)), rejectsCode('OWNER_REQUIRED'));
  await assert.rejects(f.service.head({ ...scope, deviceId: 'foreign-device' }), rejectsCode('DEVICE_NOT_ACTIVE'));
});

test('an active device session must use the DSK authorized by the current accepted epoch', async () => {
  const f = fixture(); await f.bootstrap();
  const oldChildScope = { familyId: FAMILY, deviceId: 'child-device', dskKeyId: 'child-dsk' };
  assert.equal((await f.service.head(oldChildScope)).trustSetEpoch, 1);

  // The key directory may retain the prior DSK as ACTIVE during overlap,
  // but the newly accepted epoch chooses the exact DSK allowed for this
  // device's Trust Set session scope.
  const previousDsk = { deviceId: f.childEntry.deviceId, keyId: f.childEntry.dskKeyId, keyPurpose: 'DSK',
    publicKey: f.childEntry.dskPublicKey, status: 'ACTIVE' };
  f.childEntry.dskKeyId = 'child-dsk-rotated';
  f.childEntry.dskPublicKey = 'child-dsk-public-rotated';
  f.additionalKeys.set('child-device', [previousDsk]);
  await f.service.submit(scope, f.request(2));

  await assert.rejects(f.service.head(oldChildScope), rejectsCode('DEVICE_NOT_ACTIVE'));
  assert.equal((await f.service.head({ ...oldChildScope, dskKeyId: 'child-dsk-rotated' })).trustSetEpoch, 2);
});

test('revoked membership cannot fetch head, submit, or reconcile an old receipt', async () => {
  const f = fixture(); await f.bootstrap(); const second = f.request(2); await f.service.submit(scope, second);
  const entries = (await import('../../dist/familytrustset/decode.js')).decodeCanonicalTrustSetEpochBytes(Buffer.from(second.canonicalEpochBase64, 'base64')).entries;
  entries[1].status = 'REVOKED'; await f.service.submit(scope, f.request(3, { entries }));
  await assert.rejects(f.service.head({ familyId: FAMILY, deviceId: 'child-device', dskKeyId: 'child-dsk' }), rejectsCode('DEVICE_NOT_ACTIVE'));
});

test('family mismatch rejected without appending and no caller authority/timestamps allowed', async () => {
  const f = fixture(); await f.bootstrap();
  await assert.rejects(f.service.submit(scope, f.request(2, { familyId: 'foreign-family' })), rejectsCode('FAMILY_MISMATCH'));
  await assert.rejects(f.service.submit(scope, { ...f.request(2), receivedAt: new Date().toISOString() }), rejectsCode('INVALID_REQUEST'));
  assert.equal(f.appends, 1);
});

test('status absence is distinct from corrupt state or durable read failure', async () => {
  const f = fixture(); await f.bootstrap();
  assert.equal((await f.service.status(scope, f.request(2))).outcome, 'NOT_ACCEPTED');
  f.store.readEpoch = async () => { throw new Error('storage unavailable'); };
  await assert.rejects(f.service.status(scope, f.request(2)), /storage unavailable/);
  f.setFloor({ minimumAcceptedTrustSetEpoch: 2, minimumAcceptedKeyEpoch: 1 });
  await assert.rejects(f.service.head(scope), /inconsistent durable state/);
});

test('accepted metadata, byte corruption, and signature corruption fail closed', async () => {
  for (const corrupt of [(r) => { r.familyId = 'foreign'; }, (r) => { r.signerDeviceId = 'foreign'; },
    (r) => { r.signedEpochBytes = Buffer.from([0xff]); }, (r) => { r.signature = 'invalid'; }]) {
    const f = fixture(); await f.bootstrap(); corrupt(f.rows.get(`${FAMILY}/1`));
    await assert.rejects(f.service.head(scope), /inconsistent durable state/);
    assert.equal(f.appends, 1);
  }
});

test('accepted-head signer is revalidated against the independent directory DSK on every read and replay path', async () => {
  const f = fixture(); await f.bootstrap();
  const row = f.rows.get(`${FAMILY}/1`);
  const decoded = (await import('../../dist/familytrustset/decode.js'))
    .decodeCanonicalTrustSetEpochBytes(row.signedEpochBytes);
  const untrustedSigner = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = untrustedSigner.publicKey.export({ format: 'jwk' });
  const unregisteredPublicKey = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, 'base64url'),
    Buffer.from(jwk.y, 'base64url')]).toString('base64url');
  const changedEpoch = { ...decoded, entries: decoded.entries.map((entry) => entry.deviceId === OWNER
    ? { ...entry, dskKeyId: 'unregistered-dsk', dskPublicKey: unregisteredPublicKey } : entry) };
  const changedBytes = canonicalizeTrustSetEpoch(changedEpoch);
  const forgedSignature = canonicalizeP256Signature(sign('sha256', Buffer.from(changedBytes), {
    key: untrustedSigner.privateKey, dsaEncoding: 'ieee-p1363',
  })).toString('base64url');
  // The accepted-row checker can validate these bytes/signature against the
  // payload's claimed DSK. Only the independent device key directory reveals
  // that this key was never registered for the owner.
  row.signedEpochBytes = Buffer.from(changedBytes, 'utf8');
  row.signature = forgedSignature;
  row.signerKeyId = 'unregistered-dsk';
  assert.equal((await f.acceptance.readAcceptedHead(FAMILY)).signature, forgedSignature);

  for (const operation of [
    () => f.service.head(scope),
    () => f.service.epoch(scope, 1),
    () => f.service.status(scope, f.request(2)),
    () => f.service.submit(scope, f.request(2)),
  ]) {
    await assert.rejects(operation(), rejectsCode('NO_TRUST_SET'));
  }
  assert.equal(f.appends, 1, 'corrupt persisted authority cannot create an append');
});

test('accepted-head role resolution rejects a revoked current DSK even when the signed row still says ACTIVE', async () => {
  const f = fixture(); await f.bootstrap();
  f.keyStatuses.set(OWNER, 'REVOKED');
  await assert.rejects(f.service.head(scope), rejectsCode('NO_TRUST_SET'));

  f.keyStatuses.set(OWNER, 'ACTIVE');
  f.keyStatuses.set('child-device', 'REVOKED');
  await assert.rejects(f.service.head({ familyId: FAMILY, deviceId: 'child-device', dskKeyId: 'child-dsk' }), rejectsCode('DEVICE_NOT_ACTIVE'));
  assert.equal(f.appends, 1);
});

test('accepted-head resolver dependency is mandatory and mixed-head projections fail closed', async () => {
  const f = fixture(); await f.bootstrap();
  assert.throws(() => new OrdinaryTrustSetService(f.acceptance), /requires a trusted accepted-head role resolver/);
  const movedHeadResolver = { resolveActor: async (familyId, deviceId) => ({
    familyId, deviceId, role: 'OWNER', trustSetEpoch: 2, keyEpoch: 1,
  }) };
  const mixed = new OrdinaryTrustSetService(f.acceptance, movedHeadResolver);
  await assert.rejects(mixed.head(scope), rejectsCode('CONFLICT'));
});

test('resolver infrastructure failure is propagated and never treated as accepted authority', async () => {
  const f = fixture(); await f.bootstrap();
  const unavailable = new OrdinaryTrustSetService(f.acceptance, {
    resolveActor: async () => { throw new Error('device directory unavailable'); },
  });
  await assert.rejects(unavailable.head(scope), /device directory unavailable/);
});

test('malformed, noncanonical base64, invalid UTF8, high-S and huge bodies rejected before storage', async () => {
  const f = fixture(); const valid = f.request(2);
  for (const bad of [null, [], {}, { ...valid, canonicalEpochBase64: valid.canonicalEpochBase64 + '\n' },
    { ...valid, signatureBase64: valid.signatureBase64.replace(/=/g, '') },
    { ...valid, canonicalEpochBase64: Buffer.from([0xff]).toString('base64') },
    { ...valid, signatureBase64: Buffer.alloc(64, 255).toString('base64') },
    { ...valid, canonicalEpochBase64: 'A'.repeat(400000) }]) {
    await assert.rejects(f.service.submit(scope, bad), rejectsCode('INVALID_REQUEST'));
  }
  assert.equal(f.appends, 0);
});

test('concurrent different epoch candidates cannot both overwrite the validated head', async () => {
  const f = fixture(); await f.bootstrap();
  const results = await Promise.allSettled([f.service.submit(scope, f.request(2)), f.service.submit(scope, f.request(3, { supersedesEpoch: 1 }))]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(results.find((r) => r.status === 'rejected').reason.code, 'REJECTED');
  assert.equal(f.rows.size, 2);
});

test('stale epoch and key epoch cannot change accepted floors', async () => {
  const f = fixture(); await f.bootstrap(); await f.service.submit(scope, f.request(3, { supersedesEpoch: 1, keyEpoch: 2 }));
  await assert.rejects(f.service.submit(scope, f.request(2)), (e) => e.reason === 'STALE_TRUST_SET_EPOCH');
  await assert.rejects(f.service.submit(scope, f.request(4, { supersedesEpoch: 3, keyEpoch: 1 })), (e) => e.reason === 'STALE_KEY_EPOCH');
  assert.equal(f.appends, 2);
});

test('authenticated scope and exact request are snapshotted before asynchronous reads', async () => {
  const f = fixture(); await f.bootstrap();
  const mutableScope = { ...scope }; const request = f.request(2);
  const promised = f.service.submit(mutableScope, request);
  mutableScope.familyId = 'foreign'; mutableScope.deviceId = 'foreign';
  request.canonicalEpochBase64 = 'invalid'; request.signatureBase64 = 'invalid';
  assert.equal((await promised).outcome, 'ACCEPTED');
  await assert.rejects(f.service.status(null, f.request(3)), rejectsCode('INVALID_REQUEST'));
});
