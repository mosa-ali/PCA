import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { FamilyAuditEventProducer } from '../../dist/familyrbac/FamilyAuditEventProducer.js';
import { FamilyAuditParentDeviceResolver } from '../../dist/familyrbac/FamilyAuditParentDeviceResolver.js';
import { canonicalizeOwnerAttestation, computeAttestationId } from '../../dist/familycommercial/authority/canonicalize.js';
import { ATTESTATION_CLOCK_SKEW_MS, MAX_ATTESTATION_TTL_MS } from '../../dist/familycommercial/authority/policy.js';

const FAMILY_ID = 'fam-audit-recipient';
const OWNER_DEVICE_ID = 'owner-device';
const OWNER_DSK_KEY_ID = 'owner-dsk-1';
const OWNER_DSK_PUBLIC_KEY = 'owner-dsk-public-key';
const NOW = new Date('2026-01-01T00:00:00.000Z');
const ACCEPTING_VERIFIER = { async verify() { return true; } };
const ACTIVE_KEY_RESOLVER = { async isActiveDsk() { return true; } };

function createResolver(chainStore, roleResolver, verifier = ACCEPTING_VERIFIER, keyResolver = ACTIVE_KEY_RESOLVER) {
  return new FamilyAuditParentDeviceResolver(chainStore, roleResolver, verifier, keyResolver, () => NOW);
}

function fixture(attestationOverrides = {}, floors = {}, headOverrides = {}) {
  const attestation = {
    familyId: FAMILY_ID,
    purpose: 'PCA_FAMILY_COMMERCIAL_OWNER_AUTHORITY_V1',
    attestationRevision: 1,
    ownerDeviceId: OWNER_DEVICE_ID,
    ownerDskKeyId: OWNER_DSK_KEY_ID,
    ownerDskPublicKey: OWNER_DSK_PUBLIC_KEY,
    // This is lineage metadata only. The accepted Trust Set below can have
    // advanced independently to keyEpoch 3.
    trustSetEpoch: 1,
    keyEpoch: 1,
    issuedAt: new Date(NOW.getTime() - 60_000),
    expiresAt: new Date(NOW.getTime() + 15 * 60_000),
    previousAttestationId: null,
    signerDeviceId: OWNER_DEVICE_ID,
    signerDskKeyId: OWNER_DSK_KEY_ID,
    signerDskPublicKey: OWNER_DSK_PUBLIC_KEY,
    signature: 'attestation-signature',
    ...attestationOverrides,
  };
  const head = {
    familyId: FAMILY_ID,
    headAttestationId: computeAttestationId(attestation),
    headRevision: attestation.attestationRevision,
    requiredTrustSetEpoch: floors.requiredTrustSetEpoch ?? 1,
    requiredKeyEpoch: floors.requiredKeyEpoch ?? 1,
    status: floors.status ?? 'ACTIVE',
    updatedAt: NOW,
    ...headOverrides,
  };
  const chainStore = {
    async findHead(familyId) {
      return familyId === FAMILY_ID ? head : null;
    },
    async findAttestationById(familyId, attestationId) {
      return familyId === FAMILY_ID && attestationId === head.headAttestationId ? attestation : null;
    },
  };
  return { attestation, chainStore, head };
}

function resolvedOwner(overrides = {}) {
  return {
    familyId: FAMILY_ID,
    deviceId: OWNER_DEVICE_ID,
    dskKeyId: OWNER_DSK_KEY_ID,
    role: 'OWNER',
    trustSetEpoch: 3,
    keyEpoch: 3,
    ...overrides,
  };
}

test('FamilyAudit skips an attestation below the attestation-chain freshness floors before role resolution', async () => {
  const { chainStore } = fixture({ keyEpoch: 1 }, { requiredKeyEpoch: 2 });
  let roleCalls = 0;
  const resolver = createResolver(chainStore, {
    async resolveActor() { roleCalls += 1; return resolvedOwner(); },
  });

  assert.deepEqual(await resolver.resolveParentDevices(FAMILY_ID), []);
  assert.equal(roleCalls, 0);
});

test('FamilyAudit skips an active OWNER whose accepted epochs remain below the attestation-chain freshness floors', async () => {
  const { chainStore } = fixture({}, { requiredTrustSetEpoch: 4, requiredKeyEpoch: 3 });
  const resolver = createResolver(chainStore, {
    async resolveActor() { return resolvedOwner(); },
  });

  assert.deepEqual(await resolver.resolveParentDevices(FAMILY_ID), []);
});

test('FamilyAudit skips a revoked owner head without consulting current membership', async () => {
  const { chainStore } = fixture({}, { status: 'REVOKED' });
  let roleCalls = 0;
  const resolver = createResolver(chainStore, {
    async resolveActor() { roleCalls += 1; return resolvedOwner({ trustSetEpoch: 1, keyEpoch: 1 }); },
  });

  assert.deepEqual(await resolver.resolveParentDevices(FAMILY_ID), []);
  assert.equal(roleCalls, 0);
});

test('FamilyAudit skips an expired owner attestation', async () => {
  const { chainStore } = fixture({ expiresAt: new Date('2025-01-01T00:00:00.000Z') });
  let roleCalls = 0;
  const resolver = createResolver(chainStore, {
    async resolveActor() { roleCalls += 1; return resolvedOwner({ trustSetEpoch: 1, keyEpoch: 1 }); },
  });

  assert.deepEqual(await resolver.resolveParentDevices(FAMILY_ID), []);
  assert.equal(roleCalls, 0);
});

test('FamilyAudit rejects a signed owner head issued beyond the allowed future clock skew', async () => {
  const { chainStore } = fixture({
    issuedAt: new Date(NOW.getTime() + ATTESTATION_CLOCK_SKEW_MS + 1),
    expiresAt: new Date(NOW.getTime() + ATTESTATION_CLOCK_SKEW_MS + 60_001),
  });
  let verifyCalls = 0;
  let roleCalls = 0;
  const resolver = createResolver(chainStore, {
    async resolveActor() { roleCalls += 1; return resolvedOwner({ trustSetEpoch: 1, keyEpoch: 1 }); },
  }, { async verify() { verifyCalls += 1; return true; } });

  assert.deepEqual(await resolver.resolveParentDevices(FAMILY_ID), []);
  assert.equal(verifyCalls, 0);
  assert.equal(roleCalls, 0);
});

test('FamilyAudit rejects an over-age signed owner head even while its expiry remains future-dated', async () => {
  const { chainStore } = fixture({
    issuedAt: new Date(NOW.getTime() - MAX_ATTESTATION_TTL_MS - 1),
    expiresAt: new Date(NOW.getTime() + 60_000),
  });
  let roleCalls = 0;
  const resolver = createResolver(chainStore, {
    async resolveActor() { roleCalls += 1; return resolvedOwner({ trustSetEpoch: 1, keyEpoch: 1 }); },
  });

  assert.deepEqual(await resolver.resolveParentDevices(FAMILY_ID), []);
  assert.equal(roleCalls, 0);
});

test('FamilyAudit accepts a valid owner attestation at the maximum allowed TTL', async () => {
  const { chainStore } = fixture({
    issuedAt: new Date(NOW),
    expiresAt: new Date(NOW.getTime() + MAX_ATTESTATION_TTL_MS),
  });
  const resolver = createResolver(chainStore, {
    async resolveActor() { return resolvedOwner({ trustSetEpoch: 1, keyEpoch: 1 }); },
  });

  assert.deepEqual(await resolver.resolveParentDevices(FAMILY_ID), [{ deviceId: OWNER_DEVICE_ID, keyEpoch: 1 }]);
});

test('FamilyAudit rejects a bad current-attestation signature before checking membership', async () => {
  const { chainStore } = fixture();
  let verifyCalls = 0;
  let keyCalls = 0;
  let roleCalls = 0;
  const resolver = createResolver(chainStore, {
    async resolveActor() { roleCalls += 1; return resolvedOwner(); },
  }, { async verify() { verifyCalls += 1; return false; } }, {
    async isActiveDsk() { keyCalls += 1; return true; },
  });

  assert.deepEqual(await resolver.resolveParentDevices(FAMILY_ID), []);
  assert.equal(verifyCalls, 1);
  assert.equal(keyCalls, 2);
  assert.equal(roleCalls, 0);
});

test('FamilyAudit rejects altered stored content when its content-addressed head ID no longer matches', async () => {
  const { chainStore, attestation } = fixture();
  attestation.ownerDskKeyId = 'altered-key-id';
  let verifyCalls = 0;
  let roleCalls = 0;
  const resolver = createResolver(chainStore, {
    async resolveActor() { roleCalls += 1; return resolvedOwner(); },
  }, { async verify() { verifyCalls += 1; return true; } }, ACTIVE_KEY_RESOLVER);

  assert.deepEqual(await resolver.resolveParentDevices(FAMILY_ID), []);
  assert.equal(verifyCalls, 0);
  assert.equal(roleCalls, 0);
});

test('FamilyAudit requires the attestation revision to equal the current chain head revision', async () => {
  const { chainStore } = fixture({}, {}, { headRevision: 2 });
  let verifyCalls = 0;
  let roleCalls = 0;
  const resolver = createResolver(chainStore, {
    async resolveActor() { roleCalls += 1; return resolvedOwner(); },
  }, { async verify() { verifyCalls += 1; return true; } }, ACTIVE_KEY_RESOLVER);

  assert.deepEqual(await resolver.resolveParentDevices(FAMILY_ID), []);
  assert.equal(verifyCalls, 0);
  assert.equal(roleCalls, 0);
});

test('FamilyAudit reports unavailable authority dependencies without resolving a recipient', async () => {
  const verifierFailure = fixture();
  const rejectedVerifier = createResolver(verifierFailure.chainStore, {
    async resolveActor() { return resolvedOwner(); },
  }, { async verify() { throw new Error('verifier unavailable'); } }, ACTIVE_KEY_RESOLVER);
  await assert.rejects(rejectedVerifier.resolveParentDevices(FAMILY_ID), {
    message: 'family_audit_parent_device_resolution_unavailable',
  });

  const chainFailure = fixture();
  chainFailure.chainStore.findHead = async () => { throw new Error('chain unavailable'); };
  const rejectedChain = createResolver(chainFailure.chainStore, {
    async resolveActor() { return resolvedOwner(); },
  }, ACCEPTING_VERIFIER, ACTIVE_KEY_RESOLVER);
  await assert.rejects(rejectedChain.resolveParentDevices(FAMILY_ID), {
    message: 'family_audit_parent_device_resolution_unavailable',
  });

  const keyFailure = fixture();
  const rejectedKey = createResolver(keyFailure.chainStore, {
    async resolveActor() { return resolvedOwner(); },
  }, ACCEPTING_VERIFIER, { async isActiveDsk() { throw new Error('device directory unavailable'); } });
  await assert.rejects(rejectedKey.resolveParentDevices(FAMILY_ID), {
    message: 'family_audit_parent_device_resolution_unavailable',
  });
});

test('FamilyAudit requires both the owner DSK and current attestation signer DSK to remain active', async () => {
  const { chainStore } = fixture();
  const checks = [];
  let verifyCalls = 0;
  let roleCalls = 0;
  const resolver = createResolver(chainStore, {
    async resolveActor() { roleCalls += 1; return resolvedOwner(); },
  }, { async verify() { verifyCalls += 1; return true; } }, {
    async isActiveDsk(input) { checks.push(input); return checks.length === 1; },
  });

  assert.deepEqual(await resolver.resolveParentDevices(FAMILY_ID), []);
  assert.equal(checks.length, 2);
  assert.equal(verifyCalls, 0);
  assert.equal(roleCalls, 0);
});

for (const [name, actor] of [
  ['non-OWNER role', resolvedOwner({ role: 'ADMINISTRATOR', trustSetEpoch: 4 })],
  ['mismatched family', resolvedOwner({ familyId: 'different-family' })],
  ['mismatched device', resolvedOwner({ deviceId: 'different-device', trustSetEpoch: 4 })],
  ['mismatched attested DSK', resolvedOwner({ dskKeyId: 'rotated-owner-dsk' })],
  ['missing family projection', resolvedOwner({ familyId: undefined })],
  ['missing DSK projection', resolvedOwner({ dskKeyId: undefined })],
  ['attested DSK no longer active', 'DEVICE_NOT_ACTIVE'],
]) {
  test(`FamilyAudit skips the attested recipient when current membership has ${name}`, async () => {
    const { chainStore } = fixture();
    const calls = [];
    const resolver = createResolver(chainStore, {
      async resolveActor(familyId, deviceId, dskKeyId) {
        calls.push({ familyId, deviceId, dskKeyId });
        return actor;
      },
    }, ACCEPTING_VERIFIER, ACTIVE_KEY_RESOLVER);

    assert.deepEqual(await resolver.resolveParentDevices(FAMILY_ID), []);
    assert.deepEqual(calls, [{ familyId: FAMILY_ID, deviceId: OWNER_DEVICE_ID, dskKeyId: OWNER_DSK_KEY_ID }]);
  });
}

function sampleRecord() {
  return {
    eventId: 'event-1',
    familyId: FAMILY_ID,
    actionType: 'ADD_VIEWER',
    actorDeviceId: 'actor-device',
    actorMemberId: null,
    targetScope: { kind: 'FAMILY', id: FAMILY_ID },
    authorizationRole: 'OWNER',
    trustSetEpoch: 1,
    policyRevision: null,
    occurredAtUtc: new Date(NOW),
    clientMonotonicSequence: null,
    resultStatus: 'SUCCESS',
    targetAcknowledgementCount: 0,
    reasonCategory: null,
    correlationId: null,
    actionId: null,
    freeTextNote: null,
  };
}

test('authority dependency outage reaches the producer diagnostic without leaking dependency text', async () => {
  const { chainStore } = fixture();
  chainStore.findHead = async () => { throw new Error('private database failure sentinel'); };
  const resolver = createResolver(
    chainStore,
    { async resolveActor() { return resolvedOwner({ trustSetEpoch: 1, keyEpoch: 1 }); } },
    ACCEPTING_VERIFIER,
    ACTIVE_KEY_RESOLVER,
  );
  const logs = [];
  const originalWarn = console.warn;
  console.warn = (message) => logs.push(String(message));
  try {
    const producer = new FamilyAuditEventProducer(
      { async record() { throw new Error('ledger must not be reached'); } },
      async () => { throw new Error('composer must not be reached'); },
      familyId => resolver.resolveParentDevices(familyId),
      () => 'audit-envelope-test',
      () => NOW,
    );

    assert.deepEqual(await producer.deliver(sampleRecord()), []);
    assert.equal(logs.length, 1);
    assert.equal(JSON.parse(logs[0]).event, 'family_audit_event_recipient_resolution_failed');
    assert.equal(logs[0].includes('private database failure sentinel'), false);
  } finally {
    console.warn = originalWarn;
  }
});

test('FamilyAudit delivery uses current accepted OWNER keyEpoch, not the attestation lineage snapshot', async () => {
  const { chainStore, attestation } = fixture();
  const roleCalls = [];
  const signatureCalls = [];
  const keyChecks = [];
  const roleResolver = {
    async resolveActor(familyId, deviceId, dskKeyId) {
      roleCalls.push({ familyId, deviceId, dskKeyId });
      return { familyId, deviceId, dskKeyId, role: 'OWNER', trustSetEpoch: 4, keyEpoch: 3 };
    },
  };
  const verifier = {
    async verify(publicKey, canonicalBytes, signature) {
      signatureCalls.push({ publicKey, canonicalBytes, signature });
      return true;
    },
  };
  const keyResolver = {
    async isActiveDsk(input) { keyChecks.push(input); return true; },
  };
  const resolver = createResolver(chainStore, roleResolver, verifier, keyResolver);
  const ledgerRows = [];
  const composed = [];
  const producer = new FamilyAuditEventProducer(
    { async record(row) { ledgerRows.push(row); return { outcome: 'RECORDED' }; } },
    async input => {
      composed.push(input);
      return { encryptedPayloadB64: 'opaque', nonceB64: 'nonce' };
    },
    familyId => resolver.resolveParentDevices(familyId),
    () => 'env-1',
    () => NOW,
  );

  const outcomes = await producer.deliver(sampleRecord());

  assert.deepEqual(roleCalls, [{ familyId: FAMILY_ID, deviceId: OWNER_DEVICE_ID, dskKeyId: OWNER_DSK_KEY_ID }]);
  assert.deepEqual(signatureCalls, [{
    publicKey: attestation.signerDskPublicKey,
    canonicalBytes: canonicalizeOwnerAttestation(attestation),
    signature: attestation.signature,
  }]);
  assert.deepEqual(keyChecks, [
    { familyId: FAMILY_ID, deviceId: OWNER_DEVICE_ID, keyId: OWNER_DSK_KEY_ID, publicKey: OWNER_DSK_PUBLIC_KEY },
    { familyId: FAMILY_ID, deviceId: OWNER_DEVICE_ID, keyId: OWNER_DSK_KEY_ID, publicKey: OWNER_DSK_PUBLIC_KEY },
  ]);
  assert.deepEqual(outcomes, [{ parentDeviceId: OWNER_DEVICE_ID, outcome: 'QUEUED' }]);
  assert.equal(composed.length, 1);
  assert.equal(composed[0].keyEpoch, 3);
  assert.equal(ledgerRows.length, 1);
  assert.equal(ledgerRows[0].keyEpoch, 3);
  assert.equal(ledgerRows[0].parentDeviceId, OWNER_DEVICE_ID);
});

for (const [name, resolution] of [
  ['inactive membership', 'DEVICE_NOT_ACTIVE'],
  ['missing membership', 'DEVICE_NOT_IN_TRUST_SET'],
]) {
  test(`FamilyAudit delivery skips an attested device with ${name}`, async () => {
    const { chainStore } = fixture();
    let roleResolutionCalls = 0;
    const resolver = createResolver(chainStore, {
      async resolveActor(familyId, deviceId, dskKeyId) {
        roleResolutionCalls += 1;
        assert.equal(familyId, FAMILY_ID);
        assert.equal(deviceId, OWNER_DEVICE_ID);
        assert.equal(dskKeyId, OWNER_DSK_KEY_ID);
        return resolution;
      },
    }, ACCEPTING_VERIFIER, ACTIVE_KEY_RESOLVER);
    const ledgerRows = [];
    let composeCalls = 0;
    const producer = new FamilyAuditEventProducer(
      { async record(row) { ledgerRows.push(row); return { outcome: 'RECORDED' }; } },
      async () => { composeCalls += 1; return { encryptedPayloadB64: 'opaque', nonceB64: 'nonce' }; },
      familyId => resolver.resolveParentDevices(familyId),
      () => 'audit-envelope-test',
      () => NOW,
    );

    assert.deepEqual(await producer.deliver(sampleRecord()), []);
    assert.equal(roleResolutionCalls, 1);
    assert.equal(composeCalls, 0);
    assert.equal(ledgerRows.length, 0);
  });
}

test('production FamilyAudit uses the current Trust Set resolver while Protection Alerts retain their resolver', () => {
  const mainPath = fileURLToPath(new URL('../../src/main.ts', import.meta.url));
  const main = readFileSync(mainPath, 'utf8');
  assert.match(main, /const protectionAlertParentDeviceResolver = new MySqlOwnerParentDeviceResolver\(familyAuthorityAttestationChainStore\);/);
  assert.match(main, /resolveParentDevices: \(familyId: string\) => protectionAlertParentDeviceResolver\.resolveParentDevices\(familyId\)/);
  assert.match(main, /const familyAuditParentDeviceResolver = new FamilyAuditParentDeviceResolver\(\s*familyAuthorityAttestationChainStore,\s*trustSetRoleResolver,\s*new RejectingDeviceSignatureVerifier\(\),\s*new DeviceRepositoryFamilyAuthorityKeyResolver\(deviceRepository\),\s*\);/);
  assert.match(main, /familyAuditEventLedger,\s*createRejectingOpaqueFamilyAuditEventComposer\(\),\s*\(familyId: string\) => familyAuditParentDeviceResolver\.resolveParentDevices\(familyId\)/);
});
