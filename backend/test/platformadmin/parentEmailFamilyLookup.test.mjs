import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyParentEmailFamilyLookup } from '../../dist/platformadmin/accounts/ParentEmailFamilyLookup.js';
import { ParentIdentityReadModel } from '../../dist/platformadmin/readmodels/ParentIdentityReadModel.js';
import { hashParentEmail } from '../../dist/parentaccount/emailHash.js';

const activeParent = { status: 'VERIFIED', disabledAt: null };
function expectFound(result, outcome, familyIds, reason) {
  assert.equal(result.outcome, outcome);
  if (reason) assert.equal(result.reason, reason);
  assert.deepEqual(result.familyIds, familyIds);
  assert.equal(result.account.status, 'VERIFIED');
  assert.deepEqual(result.families.map((family) => family.familyId), familyIds);
}
const activeFamily = (familyId, alreadyEntitled = false) => ({
  familyId,
  status: 'ACTIVE',
  deletedAt: null,
  alreadyEntitled,
});

test('Parent lookup email hashing trims surrounding whitespace and ignores case', () => {
  assert.deepEqual(
    hashParentEmail('  Mosamali2050@Gmail.com  '),
    hashParentEmail('mosamali2050@gmail.com'),
  );
});

test('classifies a missing normalized Parent account without returning family identifiers', () => {
  assert.deepEqual(classifyParentEmailFamilyLookup(null, []), { outcome: 'ACCOUNT_NOT_FOUND' });
});

test('disabled or suspended accounts take precedence over email verification', () => {
  const disabled = classifyParentEmailFamilyLookup({ status: 'PENDING_VERIFICATION', disabledAt: new Date() }, []);
  assert.equal(disabled.outcome, 'ACCOUNT_FOUND_BUT_NOT_ELIGIBLE');
  if (disabled.outcome !== 'ACCOUNT_NOT_FOUND') assert.equal(disabled.reason, 'ACCOUNT_SUSPENDED');

  const suspended = classifyParentEmailFamilyLookup(
    { status: 'PENDING_VERIFICATION', disabledAt: null },
    [{ ...activeFamily('family-suspended'), status: 'SUSPENDED' }],
  );
  assert.equal(suspended.outcome, 'ACCOUNT_FOUND_BUT_NOT_ELIGIBLE');
  if (suspended.outcome !== 'ACCOUNT_NOT_FOUND') {
    assert.equal(suspended.reason, 'ACCOUNT_SUSPENDED');
    assert.deepEqual(suspended.familyIds, ['family-suspended']);
  }
});

test('verification precedes family provisioning', () => {
  const result = classifyParentEmailFamilyLookup({ status: 'PENDING_VERIFICATION', disabledAt: null }, []);
  assert.equal(result.outcome, 'ACCOUNT_FOUND_BUT_NOT_ELIGIBLE');
  if (result.outcome !== 'ACCOUNT_NOT_FOUND') assert.equal(result.reason, 'EMAIL_NOT_VERIFIED');
});

test('a verified account without a usable linked family is not provisioned', () => {
  expectFound(classifyParentEmailFamilyLookup(activeParent, []), 'ACCOUNT_FOUND_BUT_NOT_ELIGIBLE', [], 'FAMILY_NOT_PROVISIONED');
  expectFound(classifyParentEmailFamilyLookup(activeParent, [{ ...activeFamily('family-deleted'), deletedAt: new Date() }]), 'ACCOUNT_FOUND_BUT_NOT_ELIGIBLE', ['family-deleted'], 'FAMILY_NOT_PROVISIONED');
});

test('an already entitled family remains available to read-only family searches', () => {
  expectFound(classifyParentEmailFamilyLookup(activeParent, [activeFamily('family-entitled', true)]), 'ACCOUNT_FOUND_BUT_NOT_ELIGIBLE', ['family-entitled'], 'ALREADY_ENTITLED');
});

test('an eligible linked family is found and all directly linked IDs are retained', () => {
  expectFound(classifyParentEmailFamilyLookup(activeParent, [activeFamily('family-entitled', true), activeFamily('family-eligible')]), 'ELIGIBLE_FAMILY_FOUND', ['family-entitled', 'family-eligible']);
});

test('duplicate family links are deduplicated and unrelated memberships are not part of classification', () => {
  expectFound(classifyParentEmailFamilyLookup(activeParent, [activeFamily('family-1'), activeFamily('family-1')]), 'ELIGIBLE_FAMILY_FOUND', ['family-1']);
});

test('account summary retains only operational Parent facts and does not contain email or secret fields', () => {
  const createdAt = new Date('2026-01-01T00:00:00.000Z');
  const result = classifyParentEmailFamilyLookup({
    ...activeParent,
    createdAt,
    verifiedAt: createdAt,
    accountType: 'PARENT_GUARDIAN',
    estimatedChildCount: 2,
    freeAccessMode: 'TIME_LIMITED',
    defaultParentMemberLimit: 4,
    defaultManagedDeviceLimit: 5,
  }, []);
  assert.equal(result.outcome, 'ACCOUNT_FOUND_BUT_NOT_ELIGIBLE');
  if (result.outcome !== 'ACCOUNT_NOT_FOUND') {
    assert.equal(result.account.createdAt, createdAt);
    assert.equal(result.account.verifiedAt, createdAt);
    assert.equal(result.account.accountType, 'PARENT_GUARDIAN');
    assert.equal(result.account.estimatedChildCount, 2);
    assert.equal('email' in result.account, false);
    assert.equal('passwordHash' in result.account, false);
  }
});

test('Parent email lookup whitelists account and family data even when persistence rows carry sensitive extras', () => {
  const marker = 'must-not-escape-this-test-boundary';
  const result = classifyParentEmailFamilyLookup({
    ...activeParent,
    accountId: marker,
    emailHash: marker,
    protectedDisplayEmailCiphertext: marker,
    passwordHash: marker,
    mfaSecretCiphertext: marker,
    recoveryCodeHash: marker,
  }, [{
    ...activeFamily('family-safe'),
    accountId: marker,
    emailHash: marker,
    protectedDisplayEmailCiphertext: marker,
    passwordHash: marker,
    mfaSecretCiphertext: marker,
  }]);

  assert.equal(result.outcome, 'ELIGIBLE_FAMILY_FOUND');
  assert.equal(JSON.stringify(result).includes(marker), false);
  if (result.outcome !== 'ACCOUNT_NOT_FOUND') {
    assert.deepEqual(Object.keys(result.account).sort(), [
      'accountType',
      'createdAt',
      'defaultManagedDeviceLimit',
      'defaultParentMemberLimit',
      'disabledAt',
      'estimatedChildCount',
      'freeAccessExpiresAt',
      'freeAccessMode',
      'freeAccessStartedAt',
      'status',
      'verifiedAt',
    ]);
    assert.deepEqual(Object.keys(result.families[0]).sort(), ['deletedAt', 'familyId', 'status']);
  }
});

test('Parent identity read model keeps legacy null identity fields and queries one family ID', async () => {
  const legacy = {
    accountId: 'legacy-account-1',
    firstName: null,
    lastName: null,
    protectedDisplayEmail: null,
    phoneNumber: null,
    phoneVerifiedAt: null,
    verifiedAt: null,
    disabledAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    status: 'VERIFIED',
    emailHash: 'hash-must-stay-private',
    passwordHash: 'credential-must-stay-private',
    mfaSecretCiphertext: 'mfa-must-stay-private',
  };
  let queriedFamilyId = null;
  const model = new ParentIdentityReadModel({
    async findByFamilyId(familyId) {
      queriedFamilyId = familyId;
      return legacy;
    },
    async repairProtectedDisplayEmail() {
      assert.fail('legacy null identity must not request ciphertext repair');
    },
  }, (_accountId, encrypted) => {
    assert.equal(encrypted, null);
    return null;
  });

  const dto = await model.getByFamilyId('legacy-family-1');
  assert.equal(queriedFamilyId, 'legacy-family-1');
  assert.deepEqual(dto, {
    firstName: null,
    lastName: null,
    email: null,
    phoneNumber: null,
  });
  assert.equal(JSON.stringify(dto).includes('must-stay-private'), false);
});

test('Parent identity DTO uses a whitelist and does not expose account or membership metadata', async () => {
  const record = {
    accountId: 'account-multi-family',
    firstName: 'سارة',
    lastName: 'الحسني',
    protectedDisplayEmail: { ciphertext: Buffer.from('sealed'), nonce: Buffer.alloc(12), authTag: Buffer.alloc(16) },
    phoneNumber: '+967123456789',
    phoneVerifiedAt: new Date('2026-01-02T00:00:00.000Z'),
    verifiedAt: new Date('2026-01-03T00:00:00.000Z'),
    disabledAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    status: 'VERIFIED',
    familyMemberships: [
      { familyId: 'family-a', role: 'ADMINISTRATOR', familyStatus: 'ACTIVE', familyDeletedAt: null },
      { familyId: 'family-b', role: 'VIEWER', familyStatus: 'SUSPENDED', familyDeletedAt: null },
      { familyId: 'family-a', role: 'ADMINISTRATOR', familyStatus: 'ACTIVE', familyDeletedAt: null },
    ],
    emailHash: 'hash-must-not-escape',
    passwordHash: 'password-must-not-escape',
    recoveryCodeHash: 'recovery-must-not-escape',
    protectedDisplayEmailCiphertext: 'ciphertext-must-not-escape',
    encryptionKey: 'key-must-not-escape',
  };
  const model = new ParentIdentityReadModel({
    async findByFamilyId(familyId) {
      assert.equal(familyId, 'family-a');
      return record;
    },
    async repairProtectedDisplayEmail() {
      assert.fail('active-key ciphertext must not request repair');
    },
  }, (accountId, encrypted) => {
    assert.equal(accountId, 'account-multi-family');
    assert.equal(encrypted, record.protectedDisplayEmail);
    return { email: 'parent@example.test', needsReencryption: false };
  });

  const dto = await model.getByFamilyId('family-a');
  assert.equal(dto.firstName, 'سارة');
  assert.equal(dto.lastName, 'الحسني');
  assert.equal(dto.email, 'parent@example.test');
  assert.equal(dto.phoneNumber, '+967123456789');
  assert.deepEqual(Object.keys(dto).sort(), ['email', 'firstName', 'lastName', 'phoneNumber']);
  const json = JSON.stringify(dto);
  for (const marker of ['must-not-escape', 'must-not-escape', 'must-not-escape', 'ciphertext-must-not-escape', 'key-must-not-escape']) {
    assert.equal(json.includes(marker), false);
  }
});

test('Parent identity read repairs previous-key ciphertext by exact-value CAS and ignores repair failure', async () => {
  const observed = { ciphertext: Buffer.from('old-ciphertext'), nonce: Buffer.alloc(12, 1), authTag: Buffer.alloc(16, 2) };
  const replacement = { ciphertext: Buffer.from('new-ciphertext'), nonce: Buffer.alloc(12, 3), authTag: Buffer.alloc(16, 4) };
  const record = {
    accountId: 'account-rotation',
    firstName: 'Mina',
    lastName: 'Hassan',
    protectedDisplayEmail: observed,
    phoneNumber: null,
    phoneVerifiedAt: null,
    verifiedAt: new Date('2026-01-03T00:00:00.000Z'),
    disabledAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    status: 'VERIFIED',
    familyMemberships: [],
  };
  let casArguments = null;
  const model = new ParentIdentityReadModel({
    async findByFamilyId(familyId) {
      assert.equal(familyId, 'family-rotation');
      return record;
    },
    async repairProtectedDisplayEmail(accountId, expected, next) {
      casArguments = { accountId, expected, next };
      throw new Error('transient repair database failure');
    },
  }, (accountId, encrypted) => {
    assert.equal(accountId, 'account-rotation');
    assert.equal(encrypted, observed);
    return { email: 'mina@example.test', needsReencryption: true };
  }, (accountId, email) => {
    assert.equal(accountId, 'account-rotation');
    assert.equal(email, 'mina@example.test');
    return replacement;
  });

  const dto = await model.getByFamilyId('family-rotation');
  assert.equal(dto.email, 'mina@example.test');
  assert.deepEqual(casArguments, { accountId: 'account-rotation', expected: observed, next: replacement });
  assert.equal(JSON.stringify(dto).includes('ciphertext'), false);
});
