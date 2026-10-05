import assert from 'node:assert/strict';
import test from 'node:test';
import { MySqlOwnerParentDeviceResolver } from '../../dist/alerts/MySqlOwnerParentDeviceResolver.js';
import { MAX_FAMILY_EPOCH } from '../../dist/familyepoch/bounds.js';

function activeHead(overrides = {}) {
  return {
    familyId: 'fam-1',
    headAttestationId: 'att-1',
    headRevision: 1,
    requiredTrustSetEpoch: 1,
    requiredKeyEpoch: 1,
    status: 'ACTIVE',
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

function attestation(overrides = {}) {
  return {
    familyId: 'fam-1',
    ownerDeviceId: 'dev-owner',
    trustSetEpoch: 1,
    keyEpoch: 1,
    ...overrides,
  };
}

test('owner recipient resolver preserves the maximum supported stored key epoch', async () => {
  const resolver = new MySqlOwnerParentDeviceResolver({
    async findHead() { return activeHead({ requiredTrustSetEpoch: MAX_FAMILY_EPOCH, requiredKeyEpoch: MAX_FAMILY_EPOCH }); },
    async findAttestationById() { return attestation({ trustSetEpoch: MAX_FAMILY_EPOCH, keyEpoch: MAX_FAMILY_EPOCH }); },
  });

  assert.deepEqual(await resolver.resolveParentDevices('fam-1'), [
    { deviceId: 'dev-owner', keyEpoch: MAX_FAMILY_EPOCH },
  ]);
});

test('owner recipient resolver fails closed on oversized stored attestation epochs', async () => {
  const resolver = new MySqlOwnerParentDeviceResolver({
    async findHead() { return activeHead(); },
    async findAttestationById() { return attestation({ keyEpoch: MAX_FAMILY_EPOCH + 1 }); },
  });

  assert.deepEqual(await resolver.resolveParentDevices('fam-1'), []);
});

test('owner recipient resolver fails closed on oversized stored head floors without reading an attestation', async () => {
  let attestationReads = 0;
  const resolver = new MySqlOwnerParentDeviceResolver({
    async findHead() { return activeHead({ requiredTrustSetEpoch: MAX_FAMILY_EPOCH + 1 }); },
    async findAttestationById() { attestationReads += 1; return attestation(); },
  });

  assert.deepEqual(await resolver.resolveParentDevices('fam-1'), []);
  assert.equal(attestationReads, 0);
});
