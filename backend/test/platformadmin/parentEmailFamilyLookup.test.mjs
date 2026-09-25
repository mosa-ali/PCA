import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyParentEmailFamilyLookup } from '../../dist/platformadmin/accounts/ParentEmailFamilyLookup.js';
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
