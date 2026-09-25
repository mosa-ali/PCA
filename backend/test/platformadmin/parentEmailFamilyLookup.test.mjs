import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyParentEmailFamilyLookup } from '../../dist/platformadmin/accounts/ParentEmailFamilyLookup.js';
import { hashParentEmail } from '../../dist/parentaccount/emailHash.js';

const activeParent = { status: 'VERIFIED', disabledAt: null };
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
  assert.deepEqual(
    classifyParentEmailFamilyLookup({ status: 'PENDING_VERIFICATION', disabledAt: new Date() }, []),
    { outcome: 'ACCOUNT_FOUND_BUT_NOT_ELIGIBLE', reason: 'ACCOUNT_SUSPENDED', familyIds: [] },
  );
  assert.deepEqual(
    classifyParentEmailFamilyLookup(
      { status: 'PENDING_VERIFICATION', disabledAt: null },
      [{ ...activeFamily('family-suspended'), status: 'SUSPENDED' }],
    ),
    { outcome: 'ACCOUNT_FOUND_BUT_NOT_ELIGIBLE', reason: 'ACCOUNT_SUSPENDED', familyIds: ['family-suspended'] },
  );
});

test('verification precedes family provisioning', () => {
  assert.deepEqual(
    classifyParentEmailFamilyLookup({ status: 'PENDING_VERIFICATION', disabledAt: null }, []),
    { outcome: 'ACCOUNT_FOUND_BUT_NOT_ELIGIBLE', reason: 'EMAIL_NOT_VERIFIED', familyIds: [] },
  );
});

test('a verified account without a usable linked family is not provisioned', () => {
  assert.deepEqual(
    classifyParentEmailFamilyLookup(activeParent, []),
    { outcome: 'ACCOUNT_FOUND_BUT_NOT_ELIGIBLE', reason: 'FAMILY_NOT_PROVISIONED', familyIds: [] },
  );
  assert.deepEqual(
    classifyParentEmailFamilyLookup(activeParent, [{ ...activeFamily('family-deleted'), deletedAt: new Date() }]),
    { outcome: 'ACCOUNT_FOUND_BUT_NOT_ELIGIBLE', reason: 'FAMILY_NOT_PROVISIONED', familyIds: ['family-deleted'] },
  );
});

test('an already entitled family remains available to read-only family searches', () => {
  assert.deepEqual(
    classifyParentEmailFamilyLookup(activeParent, [activeFamily('family-entitled', true)]),
    { outcome: 'ACCOUNT_FOUND_BUT_NOT_ELIGIBLE', reason: 'ALREADY_ENTITLED', familyIds: ['family-entitled'] },
  );
});

test('an eligible linked family is found and all directly linked IDs are retained', () => {
  assert.deepEqual(
    classifyParentEmailFamilyLookup(activeParent, [activeFamily('family-entitled', true), activeFamily('family-eligible')]),
    { outcome: 'ELIGIBLE_FAMILY_FOUND', familyIds: ['family-entitled', 'family-eligible'] },
  );
});

test('duplicate family links are deduplicated and unrelated memberships are not part of classification', () => {
  assert.deepEqual(
    classifyParentEmailFamilyLookup(activeParent, [activeFamily('family-1'), activeFamily('family-1')]),
    { outcome: 'ELIGIBLE_FAMILY_FOUND', familyIds: ['family-1'] },
  );
});
