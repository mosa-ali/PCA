import assert from 'node:assert/strict';
import test from 'node:test';
import { openStoredRecoveryEnvelope } from '../../dist/recovery/RecoveryEnvelopeOpener.js';
import {
  createTestOnlyRecoveryKdf,
  createTestOnlyRecoveryEnvelopeCipher,
  sealTestOnlyRecoveryEnvelope,
} from '../support/testOnlyRecoveryCrypto.mjs';

const SUITE = { suiteId: 'test-suite-v1' };
const SALT = Buffer.from('salt-bytes');
const RS = Buffer.from('the-real-recovery-secret');
const ASSOCIATED_DATA = Buffer.from(JSON.stringify({ familyId: 'family-1', recoveryEnvelopeId: 'envelope-1', boundTrustSetEpoch: 1, boundKeyEpoch: 1 }));

function fakeRepository(record) {
  return {
    async getEnvelope(familyId) {
      return record && record.familyId === familyId ? record : null;
    },
    async storeEnvelope() {
      throw new Error('not used in this test');
    },
    async deleteEnvelope() {
      throw new Error('not used in this test');
    },
  };
}

async function buildStoredCiphertext(kdf) {
  const rwk = await kdf.derive(RS, SALT, SUITE);
  const opened = { familyId: 'family-1', recoveryEnvelopeId: 'envelope-1', recoveryTransactionId: 'txn-1', boundTrustSetEpoch: 1, boundKeyEpoch: 1 };
  return sealTestOnlyRecoveryEnvelope(rwk, opened, ASSOCIATED_DATA);
}

test('a genuine RS successfully opens the stored envelope end to end', async () => {
  const kdf = createTestOnlyRecoveryKdf();
  const cipher = createTestOnlyRecoveryEnvelopeCipher();
  const ciphertext = await buildStoredCiphertext(kdf);
  const repository = fakeRepository({ familyId: 'family-1', ciphertext, version: 1, createdAt: new Date(), updatedAt: new Date() });

  const opened = await openStoredRecoveryEnvelope(
    { familyId: 'family-1', recoverySecret: RS, kdfSalt: SALT, kdfSuite: SUITE, associatedData: ASSOCIATED_DATA },
    repository,
    kdf,
    cipher,
  );

  assert.ok(opened);
  assert.equal(opened.familyId, 'family-1');
  assert.equal(opened.recoveryTransactionId, 'txn-1');
});

test('RS lost / no stored envelope for the family -- returns null, never fabricates one (a valid RECOVERY_REQUIRED/unrecoverable outcome upstream)', async () => {
  const kdf = createTestOnlyRecoveryKdf();
  const cipher = createTestOnlyRecoveryEnvelopeCipher();
  const repository = fakeRepository(null);

  const opened = await openStoredRecoveryEnvelope(
    { familyId: 'family-1', recoverySecret: RS, kdfSalt: SALT, kdfSuite: SUITE, associatedData: ASSOCIATED_DATA },
    repository,
    kdf,
    cipher,
  );

  assert.equal(opened, null);
});

test('a wrong Recovery Secret derives the wrong RWK and fails to open the envelope -- no support/master-key substitute can succeed here either', async () => {
  const kdf = createTestOnlyRecoveryKdf();
  const cipher = createTestOnlyRecoveryEnvelopeCipher();
  const ciphertext = await buildStoredCiphertext(kdf);
  const repository = fakeRepository({ familyId: 'family-1', ciphertext, version: 1, createdAt: new Date(), updatedAt: new Date() });

  const wrongRs = Buffer.from('a-completely-different-secret');
  const opened = await openStoredRecoveryEnvelope(
    { familyId: 'family-1', recoverySecret: wrongRs, kdfSalt: SALT, kdfSuite: SUITE, associatedData: ASSOCIATED_DATA },
    repository,
    kdf,
    cipher,
  );

  assert.equal(opened, null);
});

test('mismatched associated data (tampered/wrong binding) fails to open even with the correct RS', async () => {
  const kdf = createTestOnlyRecoveryKdf();
  const cipher = createTestOnlyRecoveryEnvelopeCipher();
  const ciphertext = await buildStoredCiphertext(kdf);
  const repository = fakeRepository({ familyId: 'family-1', ciphertext, version: 1, createdAt: new Date(), updatedAt: new Date() });

  const wrongAssociatedData = Buffer.from(JSON.stringify({ familyId: 'family-1', recoveryEnvelopeId: 'DIFFERENT-envelope', boundTrustSetEpoch: 1, boundKeyEpoch: 1 }));
  const opened = await openStoredRecoveryEnvelope(
    { familyId: 'family-1', recoverySecret: RS, kdfSalt: SALT, kdfSuite: SUITE, associatedData: wrongAssociatedData },
    repository,
    kdf,
    cipher,
  );

  assert.equal(opened, null);
});

test('a cipher that authenticates but returns a mismatched familyId is not trusted -- the request familyId always wins', async () => {
  const kdf = createTestOnlyRecoveryKdf();
  const spoofingCipher = { async open() { return { familyId: 'family-ATTACKER', recoveryEnvelopeId: 'e', recoveryTransactionId: 't', boundTrustSetEpoch: 1, boundKeyEpoch: 1 }; } };
  const repository = fakeRepository({ familyId: 'family-1', ciphertext: Buffer.from('irrelevant'), version: 1, createdAt: new Date(), updatedAt: new Date() });

  const opened = await openStoredRecoveryEnvelope(
    { familyId: 'family-1', recoverySecret: RS, kdfSalt: SALT, kdfSuite: SUITE, associatedData: ASSOCIATED_DATA },
    repository,
    kdf,
    spoofingCipher,
  );

  assert.equal(opened, null);
});

test('openStoredRecoveryEnvelope has no support/master/bypass parameter anywhere in its signature', () => {
  assert.equal(openStoredRecoveryEnvelope.length, 4); // (request, repository, kdf, cipher) -- exactly these four
});
