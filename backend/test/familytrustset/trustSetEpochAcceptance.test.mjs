// Focused unit tests for the server-side Trust Set epoch acceptance flow
// (dist/familytrustset/TrustSetEpochAcceptance.js) and its read-only
// resolver (dist/familytrustset/StoreBackedTrustSetRoleResolver.js).
//
// Scope and style:
//   - The four durable READ deps are in-memory fakes driven by one shared
//     state object, so the tests can (a) observe every read and append,
//     (b) script store outcomes for the idempotent/conflict replay paths,
//     and (c) prove that every rejection leaves the store untouched.
//   - The signature verifier is the REAL P256TrustSetSignatureVerifier
//     (imported from dist) over node:crypto-generated P-256 keys. There is
//     no reusable P-256 signing helper under backend/test/deviceauth (its
//     helper is a non-cryptographic test-only hash scheme), so this file
//     follows the strict-base64url / low-S signing approach already used
//     in backend/test/security/pcaDec020R1.test.mjs.
//   - No database contact of any kind.
import assert from 'node:assert/strict';
import { generateKeyPairSync, randomBytes, sign as cryptoSign } from 'node:crypto';
import test from 'node:test';
import { canonicalizeP256Signature } from '../../dist/deviceauth/P256DeviceSignatureVerifier.js';
import { StoreBackedTrustSetRoleResolver } from '../../dist/familytrustset/StoreBackedTrustSetRoleResolver.js';
import { TrustSetEpochAcceptanceService } from '../../dist/familytrustset/TrustSetEpochAcceptance.js';
import { MAX_FAMILY_EPOCH } from '../../dist/familyepoch/bounds.js';
import { P256TrustSetSignatureVerifier } from '../../dist/familytrustset/P256TrustSetSignatureVerifier.js';
import { canonicalizeTrustSetEpoch } from '../../dist/familytrustset/canonicalize.js';
import { decodeCanonicalTrustSetEpochBytes } from '../../dist/familytrustset/decode.js';

const FAMILY_ID = 'family-5b-acceptance';
const RECEIVED_AT = new Date('2026-09-29T10:15:30.250Z');
const ISSUED_AT = new Date('2026-09-29T10:15:30.000Z');
const ISSUED_AT_2 = new Date('2026-09-29T10:16:00.000Z');

function publicPointFromJwk(jwk) {
  const decode = (value) => Buffer.from(value, 'base64url');
  return Buffer.concat([Buffer.from([0x04]), decode(jwk.x), decode(jwk.y)]).toString('base64url');
}

function keyMaterial() {
  const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  return { pair, publicKey: publicPointFromJwk(pair.publicKey.export({ format: 'jwk' })) };
}

/** Low-S IEEE-P1363, unpadded base64url -- exactly what the strict P-256 verifier accepts. */
function signEpochBytes(privateKey, canonicalBytes) {
  const signature = cryptoSign('sha256', Buffer.from(canonicalBytes, 'utf8'), {
    key: privateKey,
    dsaEncoding: 'ieee-p1363',
  });
  return canonicalizeP256Signature(signature).toString('base64url');
}

let deviceOrdinal = 0;

function makeDevice(label) {
  deviceOrdinal += 1;
  const km = keyMaterial();
  return {
    deviceId: `${label}-device-${deviceOrdinal}`,
    dskKeyId: `${label}-dsk-${deviceOrdinal}`,
    dskPublicKey: km.publicKey,
    dskPrivateKey: km.pair.privateKey,
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

function epochFields(overrides = {}) {
  return {
    familyId: FAMILY_ID,
    trustSetEpoch: 1,
    keyEpoch: 1,
    entries: [],
    issuedAt: ISSUED_AT,
    supersedesEpoch: null,
    ...overrides,
  };
}

function signedCandidate(fields, signerPrivateKey) {
  const bytes = canonicalizeTrustSetEpoch(fields);
  return { bytes, signature: signEpochBytes(signerPrivateKey, bytes) };
}

function anchorFor(device) {
  return {
    genesisDeviceId: device.deviceId,
    genesisDskKeyId: device.dskKeyId,
    genesisDskPublicKey: device.dskPublicKey,
  };
}

function inputFor(candidate, overrides = {}) {
  return {
    familyId: FAMILY_ID,
    signedCanonicalBytes: candidate.bytes,
    signature: candidate.signature,
    receivedAt: RECEIVED_AT,
    ...overrides,
  };
}

function replaceCanonicalNumberField(bytes, fieldIndex, nextValue) {
  const source = Buffer.from(bytes, 'utf8');
  const fields = [
    FAMILY_ID,
    '1',
    '1',
    '1',
    'owner-device',
    'OWNER',
    'owner-dsk-key',
    'owner-dsk-public',
    'owner-dek-key',
    'owner-dek-public',
    'ACTIVE',
    ISSUED_AT.toISOString(),
    'null',
  ];
  // This helper is used only to replace one of the first three numeric fields
  // in a normal owner candidate while preserving the exact netstring format.
  const prefixes = [];
  let offset = 0;
  for (let index = 0; index < fieldIndex; index += 1) {
    const field = fields[index];
    const encodedLength = `${Buffer.byteLength(field, 'utf8')}:`;
    prefixes.push(`${encodedLength}${field}`);
    offset += Buffer.byteLength(`${encodedLength}${field}`, 'utf8');
  }
  const oldField = fields[fieldIndex];
  const oldEncoded = `${Buffer.byteLength(oldField, 'utf8')}:${oldField}`;
  const encodedNext = `${Buffer.byteLength(String(nextValue), 'utf8')}:${String(nextValue)}`;
  assert.equal(source.slice(0, offset).toString(), prefixes.join(''));
  assert.equal(source.slice(offset, offset + Buffer.byteLength(oldEncoded, 'utf8')).toString(), oldEncoded);
  return Buffer.concat([
    Buffer.from(prefixes.join(''), 'utf8'),
    Buffer.from(encodedNext, 'utf8'),
    source.slice(offset + Buffer.byteLength(oldEncoded, 'utf8')),
  ]).toString('utf8');
}

function advanceFloors(state, record) {
  const current = state.floorsByFamily.get(record.familyId) ?? {
    minimumAcceptedTrustSetEpoch: 1,
    minimumAcceptedKeyEpoch: 1,
  };
  state.floorsByFamily.set(record.familyId, {
    minimumAcceptedTrustSetEpoch: Math.max(current.minimumAcceptedTrustSetEpoch, record.trustSetEpoch),
    minimumAcceptedKeyEpoch: Math.max(current.minimumAcceptedKeyEpoch, record.keyEpoch),
  });
}

/** Seeds an already-ACCEPTED epoch record directly into the fake durable state. */
function seedAcceptedEpoch(state, fields, signerDevice) {
  const bytes = canonicalizeTrustSetEpoch(fields);
  const record = {
    familyId: fields.familyId,
    trustSetEpoch: fields.trustSetEpoch,
    keyEpoch: fields.keyEpoch,
    supersedesEpoch: fields.supersedesEpoch,
    signedEpochBytes: Buffer.from(bytes, 'utf8'),
    signature: signEpochBytes(signerDevice.dskPrivateKey, bytes),
    signerKeyId: signerDevice.dskKeyId,
    signerDeviceId: signerDevice.deviceId,
    issuedAt: fields.issuedAt,
    receivedAt: RECEIVED_AT,
  };
  state.epochs.push(record);
  advanceFloors(state, record);
  return record;
}

function createHarness({ anchors = [], appendOutcome = null, readErrors = {} } = {}) {
  const state = {
    epochs: [],
    floorsByFamily: new Map(),
    appendCalls: [],
    appendOutcome,
    readErrors: {
      epochStore: null,
      listEpochs: null,
      keyEpochStore: null,
      floorStore: null,
      genesisAnchorSource: null,
      ...readErrors,
    },
    anchors: new Map(anchors),
    verifyCalls: [],
    reads: { latest: 0, listEpochs: 0, canonical: 0, floors: 0, anchor: 0 },
  };
  const realVerifier = new P256TrustSetSignatureVerifier();
  const deps = {
    epochStore: {
      async appendAcceptedEpoch(record, expectedHead) {
        state.appendCalls.push(record);
        if (state.appendOutcome !== null) return state.appendOutcome;

        const duplicate = state.epochs.find((accepted) =>
          accepted.familyId === record.familyId && accepted.trustSetEpoch === record.trustSetEpoch,
        );
        if (duplicate) {
          return duplicate.signedEpochBytes.equals(record.signedEpochBytes) &&
            duplicate.signature === record.signature && duplicate.keyEpoch === record.keyEpoch
            ? { outcome: 'IDEMPOTENT_MATCH' }
            : { outcome: 'CONFLICT' };
        }

        const familyEpochs = state.epochs.filter((accepted) => accepted.familyId === record.familyId);
        const currentHead = familyEpochs.length > 0 ? familyEpochs[familyEpochs.length - 1] : null;
        const expectedHeadMatches = expectedHead === null
          ? currentHead === null
          : currentHead !== null &&
            currentHead.trustSetEpoch === expectedHead.trustSetEpoch &&
            currentHead.keyEpoch === expectedHead.keyEpoch &&
            currentHead.signedEpochBytes.equals(expectedHead.signedEpochBytes) &&
            currentHead.signature === expectedHead.signature;
        if (!expectedHeadMatches) return { outcome: 'REJECTED_STALE_AUTHORITY' };

        state.epochs.push(record);
        advanceFloors(state, record);
        return { outcome: 'APPENDED' };
      },
      async readLatestEpoch(familyId) {
        state.reads.latest += 1;
        if (state.readErrors.epochStore) throw state.readErrors.epochStore;
        const mine = state.epochs.filter((record) => record.familyId === familyId);
        return mine.length > 0 ? mine[mine.length - 1] : null;
      },
      async listEpochs(familyId) {
        state.reads.listEpochs += 1;
        if (state.readErrors.listEpochs) throw state.readErrors.listEpochs;
        return state.epochs.filter((record) => record.familyId === familyId);
      },
    },
    keyEpochStore: {
      async readCanonicalKeyEpoch(familyId) {
        state.reads.canonical += 1;
        if (state.readErrors.keyEpochStore) throw state.readErrors.keyEpochStore;
        const mine = state.epochs.filter((record) => record.familyId === familyId);
        if (mine.length === 0) return null;
        const latest = mine[mine.length - 1];
        return { trustSetEpoch: latest.trustSetEpoch, keyEpoch: latest.keyEpoch };
      },
    },
    floorStore: {
      async readFloors(familyId) {
        state.reads.floors += 1;
        if (state.readErrors.floorStore) throw state.readErrors.floorStore;
        const floors = state.floorsByFamily.get(familyId);
        return floors ? { ...floors } : null;
      },
    },
    genesisAnchorSource: {
      async readGenesisAnchor(familyId) {
        state.reads.anchor += 1;
        if (state.readErrors.genesisAnchorSource) throw state.readErrors.genesisAnchorSource;
        return state.anchors.get(familyId) ?? null;
      },
    },
    verifier: {
      async verify(publicKey, canonicalBytes, signature) {
        state.verifyCalls.push({ publicKey, canonicalBytes, signature });
        return realVerifier.verify(publicKey, canonicalBytes, signature);
      },
    },
  };
  return { state, deps, service: new TrustSetEpochAcceptanceService(deps) };
}

function createStoreBackedResolver(harness, devices = [], { inactiveDevices = [], revokedDskIds = [] } = {}) {
  const deviceById = new Map(devices.map((device) => [device.deviceId, device]));
  const inactive = new Set(inactiveDevices);
  const revoked = new Set(revokedDskIds);
  const deviceRepository = {
    async isDeviceSessionActive(familyId, deviceId) {
      if (familyId !== FAMILY_ID) return false;
      const device = deviceById.get(deviceId);
      return Boolean(device && !inactive.has(deviceId));
    },
    async findKeysByDeviceForFamily(familyId, deviceId) {
      if (familyId !== FAMILY_ID) return [];
      const device = deviceById.get(deviceId);
      if (!device) return [];
      return [{
        deviceId,
        keyId: device.dskKeyId,
        keyPurpose: 'DSK',
        publicKey: device.dskPublicKey,
        status: revoked.has(device.dskKeyId) ? 'REVOKED' : 'ACTIVE',
      }];
    },
  };
  return new StoreBackedTrustSetRoleResolver({
    epochStore: harness.deps.epochStore,
    deviceRepository,
    verifier: new P256TrustSetSignatureVerifier(),
  });
}

function assertRejectedClean(result, reason, state) {
  assert.deepEqual(result, { outcome: 'REJECTED', reason });
  assert.equal(state.appendCalls.length, 0, 'a rejection must never call appendAcceptedEpoch');
}

// --- Genesis ------------------------------------------------------------

test('VALID_GENESIS: an epoch 1 self-certified by the anchored owner is ACCEPTED and appended exactly once', async () => {
  const owner = makeDevice('owner');
  const harness = createHarness({ anchors: [[FAMILY_ID, anchorFor(owner)]] });
  const candidate = signedCandidate(epochFields({ entries: [entryFor(owner)] }), owner.dskPrivateKey);

  const result = await harness.service.acceptCandidate(inputFor(candidate));

  assert.deepEqual(result, { outcome: 'ACCEPTED' });
  assert.equal(harness.state.appendCalls.length, 1);
  assert.deepEqual(harness.state.appendCalls[0], {
    familyId: FAMILY_ID,
    trustSetEpoch: 1,
    keyEpoch: 1,
    supersedesEpoch: null,
    signedEpochBytes: Buffer.from(candidate.bytes, 'utf8'),
    signature: candidate.signature,
    signerKeyId: owner.dskKeyId,
    signerDeviceId: owner.deviceId,
    issuedAt: ISSUED_AT,
    receivedAt: RECEIVED_AT,
  });
  assert.equal(harness.state.reads.anchor, 1, 'the genesis anchor was read exactly once');
  assert.equal(harness.state.verifyCalls.length, 1);
  assert.equal(harness.state.verifyCalls[0].publicKey, owner.dskPublicKey, 'verified against the ANCHOR key');
  assert.equal(harness.state.verifyCalls[0].canonicalBytes, candidate.bytes);
});

test('NON_GENESIS_FIRST_EPOCH: an epoch 2 against an empty accepted history is rejected without consulting the anchor', async () => {
  const owner = makeDevice('owner');
  const harness = createHarness({ anchors: [[FAMILY_ID, anchorFor(owner)]] });
  const candidate = signedCandidate(
    epochFields({ trustSetEpoch: 2, entries: [entryFor(owner)] }),
    owner.dskPrivateKey,
  );

  const result = await harness.service.acceptCandidate(inputFor(candidate));

  assertRejectedClean(result, 'NON_GENESIS_FIRST_EPOCH', harness.state);
  assert.equal(harness.state.reads.latest, 1, 'durable state was consulted before the genesis-path check');
  assert.equal(harness.state.reads.anchor, 0, 'the trust-set epoch check precedes the anchor read');
  assert.equal(harness.state.verifyCalls.length, 0);
});

test('GENESIS_WRONG_FAMILY: a payload whose familyId differs from the requested family is FAMILY_MISMATCH (before any read)', async () => {
  const owner = makeDevice('owner');
  const harness = createHarness({ anchors: [[FAMILY_ID, anchorFor(owner)]] });
  const candidate = signedCandidate(
    epochFields({ familyId: 'family-somewhere-else', entries: [entryFor(owner)] }),
    owner.dskPrivateKey,
  );

  const result = await harness.service.acceptCandidate(inputFor(candidate));

  assertRejectedClean(result, 'FAMILY_MISMATCH', harness.state);
  assert.equal(harness.state.reads.latest, 0, 'family binding runs before any durable read');
  assert.equal(harness.state.reads.anchor, 0);
});

test('GENESIS_STALE_KEY_EPOCH: a genesis candidate with keyEpoch 0 is STALE_KEY_EPOCH (minimum pinned at 1)', async () => {
  const owner = makeDevice('owner');
  const harness = createHarness({ anchors: [[FAMILY_ID, anchorFor(owner)]] });
  const candidate = signedCandidate(
    epochFields({ keyEpoch: 0, entries: [entryFor(owner)] }),
    owner.dskPrivateKey,
  );

  const result = await harness.service.acceptCandidate(inputFor(candidate));

  assertRejectedClean(result, 'STALE_KEY_EPOCH', harness.state);
  assert.equal(harness.state.reads.latest, 0, 'the epoch-number floor check precedes any durable read');
  assert.equal(harness.state.verifyCalls.length, 0);
});

test('GENESIS_MALFORMED_PAYLOAD: bytes that fail strict decode are MALFORMED_CANDIDATE', async () => {
  const owner = makeDevice('owner');
  const candidate = signedCandidate(epochFields({ entries: [entryFor(owner)] }), owner.dskPrivateKey);

  const garbage = createHarness({ anchors: [[FAMILY_ID, anchorFor(owner)]] });
  const garbageResult = await garbage.service.acceptCandidate(
    inputFor(candidate, { signedCanonicalBytes: 'this-is-not-a-canonical-epoch' }),
  );
  assertRejectedClean(garbageResult, 'MALFORMED_CANDIDATE', garbage.state);
  assert.equal(garbage.state.reads.latest, 0, 'decode failure precedes any durable read');

  const truncated = createHarness({ anchors: [[FAMILY_ID, anchorFor(owner)]] });
  const truncatedResult = await truncated.service.acceptCandidate(
    inputFor(candidate, { signedCanonicalBytes: candidate.bytes.slice(0, 12) }),
  );
  assertRejectedClean(truncatedResult, 'MALFORMED_CANDIDATE', truncated.state);
});

test('OUT_OF_RANGE_CANDIDATE: values above INT32_MAX are rejected before durable reads or signature verification', async () => {
  const owner = makeDevice('owner');
  const harness = createHarness({ anchors: [[FAMILY_ID, anchorFor(owner)]] });
  const candidate = signedCandidate(epochFields({ entries: [entryFor(owner)] }), owner.dskPrivateKey);

  for (const [fieldIndex, value] of [[1, MAX_FAMILY_EPOCH + 1], [2, MAX_FAMILY_EPOCH + 1], [1, Number.MAX_SAFE_INTEGER + 1]]) {
    const result = await harness.service.acceptCandidate(inputFor(candidate, {
      signedCanonicalBytes: replaceCanonicalNumberField(candidate.bytes, fieldIndex, value),
    }));
    assertRejectedClean(result, 'MALFORMED_CANDIDATE', harness.state);
  }

  assert.equal(harness.state.reads.latest, 0);
  assert.equal(harness.state.reads.canonical, 0);
  assert.equal(harness.state.reads.floors, 0);
  assert.equal(harness.state.reads.anchor, 0);
  assert.equal(harness.state.verifyCalls.length, 0);
  assert.equal(harness.state.appendCalls.length, 0);
});

test('CORRUPT_ZERO_DURABLE_EPOCH: persisted zero Trust Set/key epochs fail closed before candidate verification', async () => {
  const owner = makeDevice('owner');
  const harness = createHarness();
  const stored = seedAcceptedEpoch(harness.state, epochFields({ entries: [entryFor(owner)] }), owner);
  stored.trustSetEpoch = 0;
  stored.keyEpoch = 0;
  harness.state.floorsByFamily.set(FAMILY_ID, {
    minimumAcceptedTrustSetEpoch: 0,
    minimumAcceptedKeyEpoch: 0,
  });
  const candidate = signedCandidate(
    epochFields({ trustSetEpoch: 2, keyEpoch: 2, supersedesEpoch: 1, entries: [entryFor(owner)] }),
    owner.dskPrivateKey,
  );

  await assert.rejects(harness.service.acceptCandidate(inputFor(candidate)), /inconsistent/i);
  assert.equal(harness.state.verifyCalls.length, 0);
  assert.equal(harness.state.appendCalls.length, 0);
});

test('INVALID_GENESIS_SIGNER: a candidate whose ACTIVE OWNER is not the anchored genesis device is rejected before signature verification', async () => {
  const anchorOwner = makeDevice('anchor-owner');
  const impostor = makeDevice('impostor');
  const harness = createHarness({ anchors: [[FAMILY_ID, anchorFor(anchorOwner)]] });
  const candidate = signedCandidate(epochFields({ entries: [entryFor(impostor)] }), impostor.dskPrivateKey);

  const result = await harness.service.acceptCandidate(inputFor(candidate));

  assertRejectedClean(result, 'INVALID_GENESIS_SIGNER', harness.state);
  assert.equal(harness.state.verifyCalls.length, 0);
});

test('GENESIS_UNKNOWN_ANCHOR: no durable anchor for the family means the genesis path cannot be trusted', async () => {
  const owner = makeDevice('owner');
  const harness = createHarness({});
  const candidate = signedCandidate(epochFields({ entries: [entryFor(owner)] }), owner.dskPrivateKey);

  const result = await harness.service.acceptCandidate(inputFor(candidate));

  assertRejectedClean(result, 'GENESIS_UNKNOWN_ANCHOR', harness.state);
  assert.equal(harness.state.reads.anchor, 1);
  assert.equal(harness.state.verifyCalls.length, 0);
});

test('MALFORMED_CANDIDATE_STRUCTURAL_RULES: engine-invalid epochs are rejected before any signature check', async () => {
  const ownerA = makeDevice('owner');
  const ownerB = makeDevice('owner');
  const helper = makeDevice('helper');

  const twoActiveOwners = createHarness({ anchors: [[FAMILY_ID, anchorFor(ownerA)]] });
  const twoActiveOwnersCandidate = signedCandidate(
    epochFields({ entries: [entryFor(ownerA), entryFor(ownerB)] }),
    ownerA.dskPrivateKey,
  );
  assertRejectedClean(
    await twoActiveOwners.service.acceptCandidate(inputFor(twoActiveOwnersCandidate)),
    'MALFORMED_CANDIDATE',
    twoActiveOwners.state,
  );
  assert.equal(twoActiveOwners.state.verifyCalls.length, 0);

  const dskEqualsDek = createHarness({ anchors: [[FAMILY_ID, anchorFor(ownerA)]] });
  const dskEqualsDekCandidate = signedCandidate(
    epochFields({
      entries: [entryFor(ownerA, { dekKeyId: ownerA.dskKeyId, dekPublicKey: ownerA.dskPublicKey })],
    }),
    ownerA.dskPrivateKey,
  );
  assertRejectedClean(
    await dskEqualsDek.service.acceptCandidate(inputFor(dskEqualsDekCandidate)),
    'MALFORMED_CANDIDATE',
    dskEqualsDek.state,
  );
  assert.equal(dskEqualsDek.state.verifyCalls.length, 0);

  const duplicateIdentity = createHarness({ anchors: [[FAMILY_ID, anchorFor(ownerA)]] });
  const duplicateIdentityCandidate = signedCandidate(
    epochFields({
      entries: [entryFor(ownerA), entryFor(helper, { role: 'CHILD', deviceId: ownerA.deviceId })],
    }),
    ownerA.dskPrivateKey,
  );
  assertRejectedClean(
    await duplicateIdentity.service.acceptCandidate(inputFor(duplicateIdentityCandidate)),
    'MALFORMED_CANDIDATE',
    duplicateIdentity.state,
  );
  assert.equal(duplicateIdentity.state.verifyCalls.length, 0);
});

// --- Chain --------------------------------------------------------------

test('VALID_NEXT_EPOCH: the next epoch signed by the previous epoch\'s ACTIVE OWNER is ACCEPTED (with consistent side metadata)', async () => {
  const owner = makeDevice('owner');
  const harness = createHarness({});
  seedAcceptedEpoch(harness.state, epochFields({ entries: [entryFor(owner)] }), owner);
  const candidate = signedCandidate(
    epochFields({ trustSetEpoch: 2, supersedesEpoch: 1, issuedAt: ISSUED_AT_2, entries: [entryFor(owner)] }),
    owner.dskPrivateKey,
  );

  const result = await harness.service.acceptCandidate(
    inputFor(candidate, {
      claimedSideMetadata: {
        signerDeviceId: owner.deviceId,
        signerKeyId: owner.dskKeyId,
        supersedesEpoch: 1,
        issuedAt: ISSUED_AT_2,
      },
    }),
  );

  assert.deepEqual(result, { outcome: 'ACCEPTED' });
  assert.equal(harness.state.appendCalls.length, 1);
  assert.equal(harness.state.appendCalls[0].supersedesEpoch, 1);
  assert.equal(harness.state.appendCalls[0].signerDeviceId, owner.deviceId);
  assert.equal(harness.state.appendCalls[0].signerKeyId, owner.dskKeyId);
  assert.deepEqual(harness.state.appendCalls[0].signedEpochBytes, Buffer.from(candidate.bytes, 'utf8'));
});

test('CONCURRENT_VALIDATIONS: candidates validated against the same accepted head cannot both append after that head moves', async () => {
  const owner = makeDevice('owner');
  const harness = createHarness();
  seedAcceptedEpoch(harness.state, epochFields({ trustSetEpoch: 1, keyEpoch: 1, entries: [entryFor(owner)] }), owner);

  const epoch2 = signedCandidate(
    epochFields({ trustSetEpoch: 2, keyEpoch: 1, entries: [entryFor(owner)] }),
    owner.dskPrivateKey,
  );
  const epoch3 = signedCandidate(
    epochFields({ trustSetEpoch: 3, keyEpoch: 1, entries: [entryFor(owner)] }),
    owner.dskPrivateKey,
  );

  const originalVerifier = harness.deps.verifier;
  let verified = 0;
  let releaseBoth;
  const bothVerified = new Promise((resolve) => { releaseBoth = resolve; });
  harness.deps.verifier = {
    async verify(publicKey, canonicalBytes, signature) {
      const valid = await originalVerifier.verify(publicKey, canonicalBytes, signature);
      verified += 1;
      if (verified === 2) releaseBoth();
      await bothVerified;
      return valid;
    },
  };

  const results = await Promise.all([
    harness.service.acceptCandidate(inputFor(epoch2)),
    harness.service.acceptCandidate(inputFor(epoch3)),
  ]);

  assert.equal(results.filter((result) => result.outcome === 'ACCEPTED').length, 1);
  assert.equal(results.filter((result) => result.outcome === 'REJECTED' && result.reason === 'STALE_AUTHORITY').length, 1);
  assert.equal(harness.state.appendCalls.length, 2, 'both verified candidates reach the compare-and-append gate');
  assert.equal(harness.state.epochs.length, 2, 'the stale contender leaves no accepted epoch row');
  const winner = harness.state.epochs[1];
  assert.ok(winner.trustSetEpoch === 2 || winner.trustSetEpoch === 3);
  assert.deepEqual(harness.state.floorsByFamily.get(FAMILY_ID), {
    minimumAcceptedTrustSetEpoch: winner.trustSetEpoch,
    minimumAcceptedKeyEpoch: winner.keyEpoch,
  });
});

test('VALID_KEY_ROTATION: a higher keyEpoch signed by the previous ACTIVE OWNER is ACCEPTED', async () => {
  const owner = makeDevice('owner');
  const harness = createHarness({});
  seedAcceptedEpoch(harness.state, epochFields({ keyEpoch: 1, entries: [entryFor(owner)] }), owner);
  const rotated = entryFor(owner, {
    dekKeyId: `${owner.dekKeyId}-rotated`,
    dekPublicKey: randomBytes(32).toString('base64url'),
  });
  const candidate = signedCandidate(
    epochFields({ trustSetEpoch: 2, keyEpoch: 2, supersedesEpoch: 1, entries: [rotated] }),
    owner.dskPrivateKey,
  );

  const result = await harness.service.acceptCandidate(inputFor(candidate));

  assert.deepEqual(result, { outcome: 'ACCEPTED' });
  assert.equal(harness.state.appendCalls[0].keyEpoch, 2);
});

test('VALID_METADATA_ONLY_EPOCH: an equal keyEpoch with a higher trustSetEpoch is ACCEPTED (no FDEK rotation required)', async () => {
  const owner = makeDevice('owner');
  const harness = createHarness({});
  seedAcceptedEpoch(harness.state, epochFields({ keyEpoch: 2, entries: [entryFor(owner)] }), owner);
  const candidate = signedCandidate(
    epochFields({ trustSetEpoch: 2, keyEpoch: 2, supersedesEpoch: 1, entries: [entryFor(owner)] }),
    owner.dskPrivateKey,
  );

  const result = await harness.service.acceptCandidate(inputFor(candidate));

  assert.deepEqual(result, { outcome: 'ACCEPTED' });
  assert.equal(harness.state.appendCalls[0].keyEpoch, 2);
});

test('BAD_SIGNATURE_REJECTED: a signature over different bytes fails verification with SIGNATURE_INVALID', async () => {
  const owner = makeDevice('owner');
  const harness = createHarness({});
  seedAcceptedEpoch(harness.state, epochFields({ entries: [entryFor(owner)] }), owner);
  const candidate = signedCandidate(
    epochFields({ trustSetEpoch: 2, supersedesEpoch: 1, entries: [entryFor(owner)] }),
    owner.dskPrivateKey,
  );
  const wrongMessageSignature = signEpochBytes(owner.dskPrivateKey, `${candidate.bytes}-tampered`);

  const result = await harness.service.acceptCandidate(
    inputFor(candidate, { signature: wrongMessageSignature }),
  );

  assertRejectedClean(result, 'SIGNATURE_INVALID', harness.state);
  assert.equal(harness.state.verifyCalls.length, 1, 'the signature WAS attempted');
});

test('WRONG_KEY_REJECTED: a well-formed signature produced by a different DSK fails verification', async () => {
  const owner = makeDevice('owner');
  const otherKey = makeDevice('other');
  const harness = createHarness({});
  seedAcceptedEpoch(harness.state, epochFields({ entries: [entryFor(owner)] }), owner);
  const candidate = signedCandidate(
    epochFields({ trustSetEpoch: 2, supersedesEpoch: 1, entries: [entryFor(owner)] }),
    otherKey.dskPrivateKey,
  );

  const result = await harness.service.acceptCandidate(inputFor(candidate));

  assertRejectedClean(result, 'SIGNATURE_INVALID', harness.state);
  assert.equal(harness.state.verifyCalls.length, 1);
  assert.equal(harness.state.verifyCalls[0].publicKey, owner.dskPublicKey);
});

test('WRONG_SIGNER_REJECTED: a candidate claiming a different ACTIVE OWNER than the authorized signer is SIGNER_NOT_AUTHORIZED', async () => {
  const owner = makeDevice('owner');
  const newcomer = makeDevice('newcomer');
  const harness = createHarness({});
  seedAcceptedEpoch(harness.state, epochFields({ entries: [entryFor(owner)] }), owner);
  const candidate = signedCandidate(
    epochFields({ trustSetEpoch: 2, supersedesEpoch: 1, entries: [entryFor(newcomer)] }),
    newcomer.dskPrivateKey,
  );

  const result = await harness.service.acceptCandidate(inputFor(candidate));

  assertRejectedClean(result, 'SIGNER_NOT_AUTHORIZED', harness.state);
  assert.equal(harness.state.verifyCalls.length, 0, 'authorization is checked before any cryptographic work');
});

test('REVOKED_SIGNER_REJECTED: a candidate whose previous-signer entry is no longer ACTIVE is SIGNER_NOT_AUTHORIZED', async () => {
  const owner = makeDevice('owner');
  const successor = makeDevice('successor');
  const harness = createHarness({});
  seedAcceptedEpoch(harness.state, epochFields({ entries: [entryFor(owner)] }), owner);

  // The previous signer is REVOKED in the candidate, so no ACTIVE OWNER
  // entry matches the authorized signer triple -- even a signature that is
  // cryptographically valid for the OLD signer key cannot authorize this.
  const revokedEntries = [entryFor(owner, { status: 'REVOKED' }), entryFor(successor)];

  const signedBySuccessor = signedCandidate(
    epochFields({ trustSetEpoch: 2, supersedesEpoch: 1, entries: revokedEntries }),
    successor.dskPrivateKey,
  );
  assertRejectedClean(
    await harness.service.acceptCandidate(inputFor(signedBySuccessor)),
    'SIGNER_NOT_AUTHORIZED',
    harness.state,
  );

  const signedByOldOwner = signedCandidate(
    epochFields({ trustSetEpoch: 2, supersedesEpoch: 1, entries: revokedEntries }),
    owner.dskPrivateKey,
  );
  assertRejectedClean(
    await harness.service.acceptCandidate(inputFor(signedByOldOwner)),
    'SIGNER_NOT_AUTHORIZED',
    harness.state,
  );

  assert.equal(harness.state.verifyCalls.length, 0);
});

test('STALE_TRUST_SET_REJECTED: a trustSetEpoch below the latest accepted epoch is rejected before signer resolution', async () => {
  const owner = makeDevice('owner');
  const harness = createHarness({});
  seedAcceptedEpoch(harness.state, epochFields({ entries: [entryFor(owner)] }), owner);
  seedAcceptedEpoch(
    harness.state,
    epochFields({ trustSetEpoch: 3, supersedesEpoch: 1, entries: [entryFor(owner)] }),
    owner,
  );
  const candidate = signedCandidate(
    epochFields({ trustSetEpoch: 2, supersedesEpoch: 1, entries: [entryFor(owner)] }),
    owner.dskPrivateKey,
  );

  const result = await harness.service.acceptCandidate(inputFor(candidate));

  assertRejectedClean(result, 'STALE_TRUST_SET_EPOCH', harness.state);
  assert.equal(harness.state.verifyCalls.length, 0);
});

test('STALE_KEY_EPOCH_REJECTED: a lower keyEpoch than the floor is rejected even with a higher trustSetEpoch', async () => {
  const owner = makeDevice('owner');
  const harness = createHarness({});
  seedAcceptedEpoch(harness.state, epochFields({ keyEpoch: 5, entries: [entryFor(owner)] }), owner);
  const candidate = signedCandidate(
    epochFields({ trustSetEpoch: 2, keyEpoch: 4, supersedesEpoch: 1, entries: [entryFor(owner)] }),
    owner.dskPrivateKey,
  );

  const result = await harness.service.acceptCandidate(inputFor(candidate));

  assertRejectedClean(result, 'STALE_KEY_EPOCH', harness.state);
  assert.equal(harness.state.verifyCalls.length, 1, 'signature is verified before the durable floors check');
});

test('WRONG_PREDECESSOR_REJECTED: a supersedesEpoch referencing a never-accepted epoch is UNKNOWN_PREDECESSOR', async () => {
  const owner = makeDevice('owner');
  const harness = createHarness({});
  seedAcceptedEpoch(harness.state, epochFields({ entries: [entryFor(owner)] }), owner);
  seedAcceptedEpoch(
    harness.state,
    epochFields({ trustSetEpoch: 3, supersedesEpoch: 1, entries: [entryFor(owner)] }),
    owner,
  );

  // 2 was never accepted (accepted history is 1 and 3).
  const gap = signedCandidate(
    epochFields({ trustSetEpoch: 4, supersedesEpoch: 2, entries: [entryFor(owner)] }),
    owner.dskPrivateKey,
  );
  assertRejectedClean(await harness.service.acceptCandidate(inputFor(gap)), 'UNKNOWN_PREDECESSOR', harness.state);

  // 9 is beyond the latest accepted epoch entirely.
  const ahead = signedCandidate(
    epochFields({ trustSetEpoch: 4, supersedesEpoch: 9, entries: [entryFor(owner)] }),
    owner.dskPrivateKey,
  );
  assertRejectedClean(await harness.service.acceptCandidate(inputFor(ahead)), 'UNKNOWN_PREDECESSOR', harness.state);
});

test('CANONICAL_PAYLOAD_MUTATION_REJECTED: non-canonical bytes are rejected by the byte-identity gate or the strict decoder, never persisted', async () => {
  const owner = makeDevice('owner');
  const candidate = signedCandidate(epochFields({ entries: [entryFor(owner)] }), owner.dskPrivateKey);

  // A non-canonical length prefix ('07:...' instead of '7:...'). Two
  // frozen layers guard this: TrustSetEpochAcceptance's step-3
  // byte-identity gate (CANONICAL_BYTES_MISMATCH) and decode.ts itself,
  // whose strict inverse rejects non-canonical prefixes outright
  // (MALFORMED_CANDIDATE). With the current strict decode the latter fires
  // first, so the step-3 gate is defense-in-depth -- but WHICHEVER layer
  // catches it, the mutation must be rejected with nothing persisted.
  const mutatedBytes = `0${candidate.bytes}`;
  const mutated = createHarness({ anchors: [[FAMILY_ID, anchorFor(owner)]] });
  const mutatedResult = await mutated.service.acceptCandidate(
    inputFor(candidate, { signedCanonicalBytes: mutatedBytes }),
  );
  assert.equal(mutatedResult.outcome, 'REJECTED');
  assert.ok(
    ['CANONICAL_BYTES_MISMATCH', 'MALFORMED_CANDIDATE'].includes(mutatedResult.reason),
    `non-canonical bytes must be rejected by a byte-identity gate, got ${mutatedResult.reason}`,
  );
  assert.equal(mutated.state.appendCalls.length, 0, 'a rejection must never call appendAcceptedEpoch');
  assert.equal(mutated.state.epochs.length, 0);

  // Sanity control: the unmutated bytes still accept in the same setup.
  const control = createHarness({ anchors: [[FAMILY_ID, anchorFor(owner)]] });
  assert.deepEqual(await control.service.acceptCandidate(inputFor(candidate)), { outcome: 'ACCEPTED' });
});

// --- Side metadata (Section 12) -----------------------------------------

function chainedCandidateWithMetadata(metadata) {
  const owner = makeDevice('owner');
  const harness = createHarness({});
  seedAcceptedEpoch(harness.state, epochFields({ entries: [entryFor(owner)] }), owner);
  const candidate = signedCandidate(
    epochFields({ trustSetEpoch: 2, keyEpoch: 1, supersedesEpoch: 1, issuedAt: ISSUED_AT_2, entries: [entryFor(owner)] }),
    owner.dskPrivateKey,
  );
  return { owner, harness, candidate, input: inputFor(candidate, { claimedSideMetadata: metadata }) };
}

test('SIDE_METADATA_CONTRADICTION_REJECTED: a conflicting signerDeviceId claim is rejected', async () => {
  const { harness, input } = chainedCandidateWithMetadata({ signerDeviceId: 'some-other-device' });
  const result = await harness.service.acceptCandidate(input);
  assertRejectedClean(result, 'SIDE_METADATA_CONFLICT', harness.state);
  assert.equal(harness.state.verifyCalls.length, 1, 'metadata is checked only after full verification');
});

test('SIDE_METADATA_CONTRADICTION_REJECTED: a conflicting signerKeyId claim is rejected', async () => {
  const { harness, input } = chainedCandidateWithMetadata({ signerKeyId: 'some-other-key' });
  const result = await harness.service.acceptCandidate(input);
  assertRejectedClean(result, 'SIDE_METADATA_CONFLICT', harness.state);
});

test('SIDE_METADATA_CONTRADICTION_REJECTED: a conflicting supersedesEpoch claim is rejected', async () => {
  const { harness, input } = chainedCandidateWithMetadata({ supersedesEpoch: 99 });
  const result = await harness.service.acceptCandidate(input);
  assertRejectedClean(result, 'SIDE_METADATA_CONFLICT', harness.state);

  const nullClaim = chainedCandidateWithMetadata({ supersedesEpoch: null });
  const nullResult = await nullClaim.harness.service.acceptCandidate(nullClaim.input);
  assertRejectedClean(nullResult, 'SIDE_METADATA_CONFLICT', nullClaim.harness.state);
});

test('SIDE_METADATA_CONTRADICTION_REJECTED: a conflicting issuedAt claim is rejected', async () => {
  const { harness, input } = chainedCandidateWithMetadata({ issuedAt: new Date(ISSUED_AT_2.getTime() + 1) });
  const result = await harness.service.acceptCandidate(input);
  assertRejectedClean(result, 'SIDE_METADATA_CONFLICT', harness.state);
});

// --- Replay / conflict / rejection hygiene ------------------------------

test('REPLAY_IDEMPOTENT: a byte-identical re-append resolves as IDEMPOTENT via the store outcome', async () => {
  const owner = makeDevice('owner');
  const harness = createHarness({ appendOutcome: { outcome: 'IDEMPOTENT_MATCH' } });
  const stored = seedAcceptedEpoch(harness.state, epochFields({ entries: [entryFor(owner)] }), owner);
  const replay = {
    bytes: stored.signedEpochBytes.toString('utf8'),
    signature: stored.signature,
  };

  const result = await harness.service.acceptCandidate(inputFor(replay));

  assert.deepEqual(result, { outcome: 'IDEMPOTENT' });
  assert.equal(harness.state.appendCalls.length, 1, 'a replay is fully verified and offered to the store');
  assert.equal(harness.state.epochs.length, 1, 'the store outcome is authoritative; state is unchanged on IDEMPOTENT_MATCH');
});

test('CONFLICT_SURFACED: a store CONFLICT outcome is surfaced as CONFLICT, never as success', async () => {
  const owner = makeDevice('owner');
  const harness = createHarness({ appendOutcome: { outcome: 'CONFLICT' } });
  const stored = seedAcceptedEpoch(harness.state, epochFields({ entries: [entryFor(owner)] }), owner);
  const replay = {
    bytes: stored.signedEpochBytes.toString('utf8'),
    signature: stored.signature,
  };

  const result = await harness.service.acceptCandidate(inputFor(replay));

  assert.deepEqual(result, { outcome: 'CONFLICT' });
  assert.equal(harness.state.appendCalls.length, 1);
});

test('STALE_AUTHORITY_SURFACED: a compare-and-append head mismatch is a distinct rejection', async () => {
  const owner = makeDevice('owner');
  const harness = createHarness();
  seedAcceptedEpoch(harness.state, epochFields({ entries: [entryFor(owner)] }), owner);
  harness.state.appendOutcome = { outcome: 'REJECTED_STALE_AUTHORITY' };
  const candidate = signedCandidate(
    epochFields({ trustSetEpoch: 2, supersedesEpoch: 1, entries: [entryFor(owner)] }),
    owner.dskPrivateKey,
  );

  const result = await harness.service.acceptCandidate(inputFor(candidate));

  assert.deepEqual(result, { outcome: 'REJECTED', reason: 'STALE_AUTHORITY' });
  assert.equal(harness.state.appendCalls.length, 1);
  assert.equal(harness.state.epochs.length, 1, 'the stale authority result leaves accepted state unchanged');
});

test('REJECTED_LEAVES_STORE_UNTOUCHED: no rejection path calls appendAcceptedEpoch, and seeded state is unchanged', async () => {
  const scenarios = [];

  {
    const owner = makeDevice('owner');
    const harness = createHarness({ anchors: [[FAMILY_ID, anchorFor(owner)]] });
    const candidate = signedCandidate(epochFields({ entries: [entryFor(owner)] }), owner.dskPrivateKey);
    scenarios.push([
      'malformed payload',
      'MALFORMED_CANDIDATE',
      harness,
      inputFor(candidate, { signedCanonicalBytes: 'not-canonical' }),
    ]);
  }
  {
    const owner = makeDevice('owner');
    const harness = createHarness({ anchors: [[FAMILY_ID, anchorFor(owner)]] });
    const candidate = signedCandidate(
      epochFields({ familyId: 'family-somewhere-else', entries: [entryFor(owner)] }),
      owner.dskPrivateKey,
    );
    scenarios.push(['family mismatch', 'FAMILY_MISMATCH', harness, inputFor(candidate)]);
  }
  {
    const owner = makeDevice('owner');
    const harness = createHarness({ anchors: [[FAMILY_ID, anchorFor(owner)]] });
    const candidate = signedCandidate(epochFields({ entries: [entryFor(owner)] }), owner.dskPrivateKey);
    scenarios.push(['canonical bytes mismatch', ['CANONICAL_BYTES_MISMATCH', 'MALFORMED_CANDIDATE'], harness, inputFor(candidate, { signedCanonicalBytes: `0${candidate.bytes}` })]);
  }
  {
    const owner = makeDevice('owner');
    const harness = createHarness({});
    const candidate = signedCandidate(
      epochFields({ trustSetEpoch: 2, entries: [entryFor(owner)] }),
      owner.dskPrivateKey,
    );
    scenarios.push(['non-genesis first epoch', 'NON_GENESIS_FIRST_EPOCH', harness, inputFor(candidate)]);
  }
  {
    const owner = makeDevice('owner');
    const harness = createHarness({});
    seedAcceptedEpoch(harness.state, epochFields({ entries: [entryFor(owner)] }), owner);
    const candidate = signedCandidate(
      epochFields({ trustSetEpoch: 2, supersedesEpoch: 1, entries: [entryFor(owner)] }),
      owner.dskPrivateKey,
    );
    scenarios.push(['signature invalid', 'SIGNATURE_INVALID', harness, inputFor(candidate, { signature: 'A'.repeat(86) })]);
  }
  {
    const owner = makeDevice('owner');
    const newcomer = makeDevice('newcomer');
    const harness = createHarness({});
    seedAcceptedEpoch(harness.state, epochFields({ entries: [entryFor(owner)] }), owner);
    const candidate = signedCandidate(
      epochFields({ trustSetEpoch: 2, supersedesEpoch: 1, entries: [entryFor(newcomer)] }),
      newcomer.dskPrivateKey,
    );
    scenarios.push(['signer not authorized', 'SIGNER_NOT_AUTHORIZED', harness, inputFor(candidate)]);
  }
  {
    const owner = makeDevice('owner');
    const harness = createHarness({});
    seedAcceptedEpoch(harness.state, epochFields({ entries: [entryFor(owner)] }), owner);
    seedAcceptedEpoch(
      harness.state,
      epochFields({ trustSetEpoch: 3, keyEpoch: 2, supersedesEpoch: 1, entries: [entryFor(owner)] }),
      owner,
    );
    const stale = signedCandidate(
      epochFields({ trustSetEpoch: 2, supersedesEpoch: 1, entries: [entryFor(owner)] }),
      owner.dskPrivateKey,
    );
    scenarios.push(['stale trust set', 'STALE_TRUST_SET_EPOCH', harness, inputFor(stale)]);

    const staleKey = signedCandidate(
      epochFields({ trustSetEpoch: 4, keyEpoch: 1, supersedesEpoch: 1, entries: [entryFor(owner)] }),
      owner.dskPrivateKey,
    );
    scenarios.push(['key below floor', 'STALE_KEY_EPOCH', harness, inputFor(staleKey)]);
  }
  {
    const owner = makeDevice('owner');
    const harness = createHarness({});
    seedAcceptedEpoch(harness.state, epochFields({ entries: [entryFor(owner)] }), owner);
    const candidate = signedCandidate(
      epochFields({ trustSetEpoch: 2, supersedesEpoch: 1, issuedAt: ISSUED_AT_2, entries: [entryFor(owner)] }),
      owner.dskPrivateKey,
    );
    scenarios.push([
      'side metadata conflict',
      'SIDE_METADATA_CONFLICT',
      harness,
      inputFor(candidate, { claimedSideMetadata: { signerDeviceId: 'some-other-device' } }),
    ]);
  }

  for (const [label, expected, harness, input] of scenarios) {
    const epochsBefore = harness.state.epochs.slice();
    const floorsBefore = new Map(harness.state.floorsByFamily);
    const result = await harness.service.acceptCandidate(input);
    const allowedReasons = Array.isArray(expected) ? expected : [expected];
    assert.equal(result.outcome, 'REJECTED', label);
    assert.ok(
      allowedReasons.includes(result.reason),
      `${label}: expected one of ${allowedReasons.join(', ')}, got ${result.reason}`,
    );
    assert.equal(harness.state.appendCalls.length, 0, `${label}: appendAcceptedEpoch must never be called`);
    assert.deepEqual(harness.state.epochs, epochsBefore, `${label}: accepted epochs must be unchanged`);
    assert.deepEqual(harness.state.floorsByFamily, floorsBefore, `${label}: floors must be unchanged`);
  }
});

test('READ_ERROR_PROPAGATES: a failing durable read throws out of acceptance (never resolves as genesis)', async () => {
  const owner = makeDevice('owner');
  const candidate = signedCandidate(epochFields({ entries: [entryFor(owner)] }), owner.dskPrivateKey);

  const failingLatest = createHarness({
    anchors: [[FAMILY_ID, anchorFor(owner)]],
    readErrors: { epochStore: new Error('boom-latest') },
  });
  await assert.rejects(failingLatest.service.acceptCandidate(inputFor(candidate)), /boom-latest/);
  assert.equal(failingLatest.state.appendCalls.length, 0);

  const failingCanonical = createHarness({
    anchors: [[FAMILY_ID, anchorFor(owner)]],
    readErrors: { keyEpochStore: new Error('boom-canonical') },
  });
  await assert.rejects(failingCanonical.service.acceptCandidate(inputFor(candidate)), /boom-canonical/);
  assert.equal(failingCanonical.state.appendCalls.length, 0);

  const failingFloors = createHarness({
    anchors: [[FAMILY_ID, anchorFor(owner)]],
    readErrors: { floorStore: new Error('boom-floors') },
  });
  await assert.rejects(failingFloors.service.acceptCandidate(inputFor(candidate)), /boom-floors/);
  assert.equal(failingFloors.state.appendCalls.length, 0);

  const failingList = createHarness({ readErrors: { listEpochs: new Error('boom-list') } });
  seedAcceptedEpoch(failingList.state, epochFields({ entries: [entryFor(owner)] }), owner);
  const chained = signedCandidate(
    epochFields({ trustSetEpoch: 2, supersedesEpoch: 1, entries: [entryFor(owner)] }),
    owner.dskPrivateKey,
  );
  await assert.rejects(failingList.service.acceptCandidate(inputFor(chained)), /boom-list/);
  assert.equal(failingList.state.appendCalls.length, 0);
});

// --- Store-backed resolver ----------------------------------------------

test('RESOLVER_EMPTY_STORE: resolving against a family with no accepted epoch is NO_TRUST_SET', async () => {
  const harness = createHarness({});
  const resolver = createStoreBackedResolver(harness);
  assert.equal(await resolver.resolveActor(FAMILY_ID, 'device-1'), 'NO_TRUST_SET');
});

test('RESOLVER_ACCEPTED_EPOCH: the latest accepted epoch maps entries exactly like FamilyTrustSetRoleResolver', async () => {
  const owner = makeDevice('owner');
  const admin = makeDevice('admin');
  const viewer = makeDevice('viewer');
  const offline = makeDevice('offline');
  const removed = makeDevice('removed');
  const harness = createHarness({});
  seedAcceptedEpoch(
    harness.state,
    epochFields({ entries: [entryFor(owner), entryFor(removed, { role: 'VIEWER' })] }),
    owner,
  );
  seedAcceptedEpoch(
    harness.state,
    epochFields({
      trustSetEpoch: 2,
      supersedesEpoch: 1,
      entries: [
        entryFor(owner),
        entryFor(admin, { role: 'ADMINISTRATOR' }),
        entryFor(viewer, { role: 'VIEWER' }),
        entryFor(offline, { role: 'CHILD', status: 'DEVICE_OFFLINE' }),
      ],
    }),
    owner,
  );
  const resolver = createStoreBackedResolver(harness, [owner, admin, viewer, offline, removed]);

  assert.deepEqual(await resolver.resolveActor(FAMILY_ID, owner.deviceId), {
    deviceId: owner.deviceId,
    role: 'OWNER',
    trustSetEpoch: 2,
    keyEpoch: 1,
  });
  assert.deepEqual(await resolver.resolveActor(FAMILY_ID, admin.deviceId), {
    deviceId: admin.deviceId,
    role: 'ADMINISTRATOR',
    trustSetEpoch: 2,
    keyEpoch: 1,
  });
  assert.deepEqual(await resolver.resolveActor(FAMILY_ID, viewer.deviceId), {
    deviceId: viewer.deviceId,
    role: 'VIEWER',
    trustSetEpoch: 2,
    keyEpoch: 1,
  });
  assert.equal(await resolver.resolveActor(FAMILY_ID, offline.deviceId), 'DEVICE_NOT_ACTIVE');
  assert.equal(
    await resolver.resolveActor(FAMILY_ID, removed.deviceId),
    'DEVICE_NOT_IN_TRUST_SET',
    'epoch 1 only: the latest epoch is the resolution source',
  );
  assert.equal(await resolver.resolveActor('some-other-family', owner.deviceId), 'NO_TRUST_SET');
});

test('RESOLVER_READ_ERROR: a store read failure resolves fail-closed as NO_TRUST_SET', async () => {
  const harness = createHarness({ readErrors: { epochStore: new Error('resolver-boom') } });
  const resolver = createStoreBackedResolver(harness);
  assert.equal(await resolver.resolveActor(FAMILY_ID, 'device-1'), 'NO_TRUST_SET');
});

test('RESOLVER_UNDECODABLE_BYTES: stored bytes that fail strict decode resolve fail-closed as NO_TRUST_SET', async () => {
  const harness = createHarness({});
  harness.state.epochs.push({
    familyId: FAMILY_ID,
    trustSetEpoch: 1,
    keyEpoch: 1,
    supersedesEpoch: null,
    signedEpochBytes: Buffer.from('definitely-not-a-canonical-epoch', 'utf8'),
    signature: 'not-a-signature',
    signerKeyId: 'k',
    signerDeviceId: 'd',
    issuedAt: ISSUED_AT,
    receivedAt: RECEIVED_AT,
  });
  const resolver = createStoreBackedResolver(harness);
  assert.equal(await resolver.resolveActor(FAMILY_ID, 'device-1'), 'NO_TRUST_SET');
});

test('RESOLVER_FOREIGN_PAYLOAD: stored bytes declaring a different family fail closed', async () => {
  const owner = makeDevice('owner');
  const harness = createHarness({});
  const foreignBytes = canonicalizeTrustSetEpoch(
    epochFields({ familyId: 'family-somewhere-else', entries: [entryFor(owner)] }),
  );
  harness.state.epochs.push({
    familyId: FAMILY_ID,
    trustSetEpoch: 1,
    keyEpoch: 1,
    supersedesEpoch: null,
    signedEpochBytes: Buffer.from(foreignBytes, 'utf8'),
    signature: signEpochBytes(owner.dskPrivateKey, foreignBytes),
    signerKeyId: owner.dskKeyId,
    signerDeviceId: owner.deviceId,
    issuedAt: ISSUED_AT,
    receivedAt: RECEIVED_AT,
  });
  const resolver = createStoreBackedResolver(harness, [owner]);
  assert.equal(await resolver.resolveActor(FAMILY_ID, owner.deviceId), 'NO_TRUST_SET');
});

test('RESOLVER_TAMPERED_BYTES: a changed but still canonical accepted payload fails signature validation', async () => {
  const owner = makeDevice('owner');
  const admin = makeDevice('admin');
  const harness = createHarness({});
  seedAcceptedEpoch(harness.state, epochFields({ entries: [entryFor(owner), entryFor(admin, { role: 'ADMINISTRATOR' })] }), owner);
  const stored = harness.state.epochs[0];
  const changed = decodeCanonicalTrustSetEpochBytes(stored.signedEpochBytes);
  changed.entries[1].role = 'VIEWER';
  stored.signedEpochBytes = Buffer.from(canonicalizeTrustSetEpoch(changed), 'utf8');

  const resolver = createStoreBackedResolver(harness, [owner, admin]);
  assert.equal(await resolver.resolveActor(FAMILY_ID, admin.deviceId), 'NO_TRUST_SET');
});

test('RESOLVER_TAMPERED_SIGNATURE: a signature from a different DSK cannot authorize the stored epoch', async () => {
  const owner = makeDevice('owner');
  const attacker = makeDevice('attacker');
  const harness = createHarness({});
  const stored = seedAcceptedEpoch(harness.state, epochFields({ entries: [entryFor(owner)] }), owner);
  stored.signature = signEpochBytes(attacker.dskPrivateKey, stored.signedEpochBytes.toString('utf8'));

  const resolver = createStoreBackedResolver(harness, [owner, attacker]);
  assert.equal(await resolver.resolveActor(FAMILY_ID, owner.deviceId), 'NO_TRUST_SET');
});

test('RESOLVER_SIGNER_KEY_ID_MISMATCH: persisted signer key id must match the signed active owner and current DSK', async () => {
  const owner = makeDevice('owner');
  const harness = createHarness({});
  const stored = seedAcceptedEpoch(harness.state, epochFields({ entries: [entryFor(owner)] }), owner);
  stored.signerKeyId = 'different-key-id';

  const resolver = createStoreBackedResolver(harness, [owner]);
  assert.equal(await resolver.resolveActor(FAMILY_ID, owner.deviceId), 'NO_TRUST_SET');
});

test('RESOLVER_SIGNER_DEVICE_ID_MISMATCH: persisted signer device id must match the signed active owner and current DSK', async () => {
  const owner = makeDevice('owner');
  const harness = createHarness({});
  const stored = seedAcceptedEpoch(harness.state, epochFields({ entries: [entryFor(owner)] }), owner);
  stored.signerDeviceId = 'different-device-id';

  const resolver = createStoreBackedResolver(harness, [owner]);
  assert.equal(await resolver.resolveActor(FAMILY_ID, owner.deviceId), 'NO_TRUST_SET');
});

test('RESOLVER_REVOKED_SIGNER_DSK: authority resolution fails when the accepted epoch signer DSK is no longer active', async () => {
  const owner = makeDevice('owner');
  const harness = createHarness({});
  seedAcceptedEpoch(harness.state, epochFields({ entries: [entryFor(owner)] }), owner);

  const resolver = createStoreBackedResolver(harness, [owner], { revokedDskIds: [owner.dskKeyId] });
  assert.equal(await resolver.resolveActor(FAMILY_ID, owner.deviceId), 'NO_TRUST_SET');
});

test('RESOLVER_REVOKED_MEMBER_DSK: an otherwise-active Trust Set member is rejected when its current DSK was revoked', async () => {
  const owner = makeDevice('owner');
  const admin = makeDevice('admin');
  const harness = createHarness({});
  seedAcceptedEpoch(harness.state, epochFields({ entries: [entryFor(owner), entryFor(admin, { role: 'ADMINISTRATOR' })] }), owner);

  const resolver = createStoreBackedResolver(harness, [owner, admin], { revokedDskIds: [admin.dskKeyId] });
  assert.equal(await resolver.resolveActor(FAMILY_ID, admin.deviceId), 'DEVICE_NOT_ACTIVE');
});

test('RESOLVER_INACTIVE_MEMBER_DEVICE: an ACTIVE Trust Set entry is denied after the device leaves ACTIVE lifecycle', async () => {
  const owner = makeDevice('owner');
  const admin = makeDevice('admin');
  const harness = createHarness({});
  seedAcceptedEpoch(harness.state, epochFields({ entries: [entryFor(owner), entryFor(admin, { role: 'ADMINISTRATOR' })] }), owner);

  const resolver = createStoreBackedResolver(harness, [owner, admin], { inactiveDevices: [admin.deviceId] });
  assert.equal(await resolver.resolveActor(FAMILY_ID, admin.deviceId), 'DEVICE_NOT_ACTIVE');
});

// --- Read-set consistency (closure-review hardening) ------------------------

test('READ_CONSISTENCY_RETRY: a transiently mixed read set (a stale latest against floors/canonical that already show the accepted epoch) is re-read, and the accept proceeds on the consistent view', async () => {
  const owner = makeDevice('owner');
  const harness = createHarness({ anchors: [[FAMILY_ID, anchorFor(owner)]] });
  const genesis = signedCandidate(epochFields({ entries: [entryFor(owner)] }), owner.dskPrivateKey);
  assert.deepEqual(await harness.service.acceptCandidate(inputFor(genesis)), { outcome: 'ACCEPTED' });

  // Script exactly ONE mixed read: the epoch store reports "never accepted"
  // while the canonical key-epoch view and the floors still show epoch 1 --
  // the interleaving a concurrent acceptance commit can genuinely produce.
  const originalLatest = harness.deps.epochStore.readLatestEpoch;
  let mixedServed = false;
  harness.deps.epochStore.readLatestEpoch = async (familyId) => {
    const real = await originalLatest(familyId);
    if (!mixedServed) {
      mixedServed = true;
      return null;
    }
    return real;
  };

  const next = signedCandidate(
    epochFields({ trustSetEpoch: 2, keyEpoch: 2, entries: [entryFor(owner)], supersedesEpoch: 1, issuedAt: ISSUED_AT_2 }),
    owner.dskPrivateKey,
  );
  const result = await harness.service.acceptCandidate(inputFor(next));
  assert.deepEqual(result, { outcome: 'ACCEPTED' }, 'the mixed first view must be re-read, never decided upon');
  assert.equal(mixedServed, true);
  assert.equal(harness.state.appendCalls.length, 2, 'exactly the genesis + the next epoch were appended');
  assert.equal(harness.state.reads.latest >= 3, true, 'at least two latest-reads happened (mixed read + consistent retry)');
});

test('READ_CONSISTENCY_STABLE_MISMATCH: a mismatch that persists across every bounded attempt throws, and nothing is appended', async () => {
  let canonicalReads = 0;
  let coreReads = 0;
  const service = new TrustSetEpochAcceptanceService({
    epochStore: {
      async appendAcceptedEpoch() {
        throw new Error('must never append on an inconsistent read set');
      },
      async readLatestEpoch() {
        coreReads += 1;
        return null; // ...the epoch store never reports the accepted epoch...
      },
      async listEpochs() {
        return [];
      },
    },
    keyEpochStore: {
      async readCanonicalKeyEpoch() {
        canonicalReads += 1;
        return { trustSetEpoch: 2, keyEpoch: 2 }; // ...while the canonical view says one exists.
      },
    },
    floorStore: {
      async readFloors() {
        return null;
      },
    },
    genesisAnchorSource: {
      async readGenesisAnchor() {
        return null;
      },
    },
    verifier: new P256TrustSetSignatureVerifier(),
  });

  const owner = makeDevice('owner');
  const candidate = signedCandidate(epochFields({ entries: [entryFor(owner)] }), owner.dskPrivateKey);
  await assert.rejects(
    () => service.acceptCandidate(inputFor(candidate)),
    /canonical key-epoch view reports an accepted epoch while the epoch store reports none/,
  );
  assert.equal(canonicalReads, 3, 'all three bounded attempts must observe the same stable mismatch before throwing');
  assert.equal(coreReads, 3, 'the retry loop is bounded at three read attempts');
});
