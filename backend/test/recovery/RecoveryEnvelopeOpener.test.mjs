import assert from 'node:assert/strict';
import test from 'node:test';
import { openStoredRecoveryEnvelope } from '../../dist/recovery/RecoveryEnvelopeOpener.js';
import { MAX_ENVELOPE_BYTES } from '../../dist/recovery/policy.js';
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

test('derived RWK is zeroized after successful, null, and throwing cipher opens while RS stays caller-owned', async () => {
  const requestSecret = Buffer.from('caller-owned-recovery-secret');
  const originalSecret = Buffer.from(requestSecret);
  const repository = fakeRepository({
    familyId: 'family-1', ciphertext: Buffer.from('opaque-envelope'),
    version: 1, createdAt: new Date(), updatedAt: new Date(),
  });

  for (const outcome of ['OPENED', 'NULL', 'THROW']) {
    const rwk = Buffer.from('ephemeral-derived-rwk');
    const kdf = { async derive(secret) {
      assert.strictEqual(secret, requestSecret);
      return rwk;
    } };
    const cipher = { async open(receivedRwk) {
      assert.strictEqual(receivedRwk, rwk);
      if (outcome === 'THROW') throw new Error('cipher failure');
      if (outcome === 'NULL') return null;
      return {
        familyId: 'family-1', recoveryEnvelopeId: 'envelope-1', recoveryTransactionId: 'txn-1',
        boundTrustSetEpoch: 1, boundKeyEpoch: 1,
      };
    } };
    const request = {
      familyId: 'family-1', recoverySecret: requestSecret, kdfSalt: SALT,
      kdfSuite: SUITE, associatedData: ASSOCIATED_DATA,
    };

    if (outcome === 'THROW') {
      await assert.rejects(() => openStoredRecoveryEnvelope(request, repository, kdf, cipher), /cipher failure/);
    } else {
      const opened = await openStoredRecoveryEnvelope(request, repository, kdf, cipher);
      assert.equal(opened?.familyId ?? null, outcome === 'OPENED' ? 'family-1' : null);
    }
    assert.deepEqual(rwk, Buffer.alloc(rwk.length));
    assert.deepEqual(requestSecret, originalSecret);
  }
});

test('derived RWK aliases of caller buffers are rejected before cipher use without zeroizing RS', async () => {
  for (const aliasKind of ['DIRECT', 'OVERLAPPING_VIEW']) {
    const backing = Buffer.from('recovery-secret-backing-buffer');
    const requestSecret = aliasKind === 'DIRECT' ? backing : backing.subarray(0, 18);
    const rwk = aliasKind === 'DIRECT' ? requestSecret : backing.subarray(12, 28);
    const originalSecret = Buffer.from(requestSecret);
    let cipherCalls = 0;
    const kdf = { async derive() { return rwk; } };
    const cipher = { async open() { cipherCalls += 1; return null; } };
    const repository = fakeRepository({
      familyId: 'family-1', ciphertext: Buffer.from('opaque-envelope'),
      version: 1, createdAt: new Date(), updatedAt: new Date(),
    });

    const opened = await openStoredRecoveryEnvelope({
      familyId: 'family-1', recoverySecret: requestSecret, kdfSalt: SALT,
      kdfSuite: SUITE, associatedData: ASSOCIATED_DATA,
    }, repository, kdf, cipher);

    assert.equal(opened, null, aliasKind);
    assert.equal(cipherCalls, 0, aliasKind);
    assert.deepEqual(requestSecret, originalSecret, aliasKind);
  }
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

test('a repository record returned for another family is rejected before KDF or cipher use', async () => {
  let kdfCalls = 0;
  let cipherCalls = 0;
  const repository = {
    async getEnvelope() {
      return {
        familyId: 'family-other',
        ciphertext: Buffer.from('foreign-family-ciphertext'),
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    },
  };
  const kdf = {
    async derive() {
      kdfCalls += 1;
      return Buffer.from('derived-rwk');
    },
  };
  const cipher = {
    async open() {
      cipherCalls += 1;
      return null;
    },
  };

  const opened = await openStoredRecoveryEnvelope(
    { familyId: 'family-1', recoverySecret: RS, kdfSalt: SALT, kdfSuite: SUITE, associatedData: ASSOCIATED_DATA },
    repository,
    kdf,
    cipher,
  );

  assert.equal(opened, null);
  assert.equal(kdfCalls, 0);
  assert.equal(cipherCalls, 0);
});

test('malformed or oversized stored ciphertext is rejected before KDF or cipher use', async () => {
  const invalidCiphertexts = [Buffer.alloc(0), Buffer.alloc(MAX_ENVELOPE_BYTES + 1), 'not-a-buffer'];

  for (const ciphertext of invalidCiphertexts) {
    let kdfCalls = 0;
    let cipherCalls = 0;
    const repository = {
      async getEnvelope() {
        return {
          familyId: 'family-1', ciphertext, version: 1,
          createdAt: new Date(), updatedAt: new Date(),
        };
      },
    };
    const kdf = { async derive() { kdfCalls += 1; return Buffer.from('derived-rwk'); } };
    const cipher = { async open() { cipherCalls += 1; return null; } };

    const opened = await openStoredRecoveryEnvelope(
      { familyId: 'family-1', recoverySecret: RS, kdfSalt: SALT, kdfSuite: SUITE, associatedData: ASSOCIATED_DATA },
      repository,
      kdf,
      cipher,
    );

    assert.equal(opened, null);
    assert.equal(kdfCalls, 0, `KDF must not process stored ciphertext of shape ${typeof ciphertext}`);
    assert.equal(cipherCalls, 0);
  }
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
