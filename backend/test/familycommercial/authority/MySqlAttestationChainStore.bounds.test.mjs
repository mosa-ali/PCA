import assert from 'node:assert/strict';
import test from 'node:test';
import { MySqlFamilyAuthorityAttestationChainStore } from '../../../dist/familycommercial/authority/MySqlAttestationChainStore.js';
import { MAX_FAMILY_EPOCH } from '../../../dist/familyepoch/bounds.js';

test('attestation store rejects out-of-range writes before opening a database transaction', async () => {
  const store = new MySqlFamilyAuthorityAttestationChainStore();
  const base = {
    familyId: 'fam-1',
    purpose: 'PCA_FAMILY_COMMERCIAL_OWNER_AUTHORITY_V1',
    attestationRevision: 1,
    ownerDeviceId: 'dev-owner',
    ownerDskKeyId: 'key-1',
    ownerDskPublicKey: 'owner-public-key',
    trustSetEpoch: 1,
    keyEpoch: 1,
    issuedAt: new Date('2026-01-01T00:00:00Z'),
    expiresAt: new Date('2026-01-02T00:00:00Z'),
    previousAttestationId: null,
    signerDeviceId: 'dev-owner',
    signerDskKeyId: 'key-1',
    signerDskPublicKey: 'owner-public-key',
    signature: 'signature',
  };

  await assert.rejects(
    store.appendIfCurrentRevision({ ...base, trustSetEpoch: MAX_FAMILY_EPOCH + 1 }, 'att-1', 0),
    TypeError,
  );
  await assert.rejects(
    store.appendIfCurrentRevision({ ...base, keyEpoch: Number.MAX_SAFE_INTEGER + 1 }, 'att-2', 0),
    TypeError,
  );
});
