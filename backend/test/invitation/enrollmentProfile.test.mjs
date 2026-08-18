import test from 'node:test';
import assert from 'node:assert/strict';
import { InvitationService } from '../../dist/invitation/InvitationService.js';
import { createInMemoryInvitationRepository } from '../support/inMemoryInvitationRepository.mjs';

const baseInput = {
  familyId: 'family-profile-test',
  platform: 'ANDROID',
  requestedProtectionMode: 'ANDROID_STANDARD',
};

test('enrollment profile is persisted as opaque child id plus controlled defaults', async () => {
  const service = new InvitationService(createInMemoryInvitationRepository());
  const { record } = await service.createInvitation({
    ...baseInput,
    childProfileId: 'child_profile_01',
    ageUxTier: 'TEEN',
    initialPolicyProfile: 'STRICT',
  });
  assert.equal(record.childProfileId, 'child_profile_01');
  assert.equal(record.ageUxTier, 'TEEN');
  assert.equal(record.initialPolicyProfile, 'STRICT');
});

test('invalid enrollment profile values are rejected before persistence', async () => {
  const service = new InvitationService(createInMemoryInvitationRepository());
  await assert.rejects(() => service.createInvitation({ ...baseInput, ageUxTier: 'CHILD' }), RangeError);
  await assert.rejects(() => service.createInvitation({ ...baseInput, initialPolicyProfile: 'OPEN' }), RangeError);
  await assert.rejects(() => service.createInvitation({ ...baseInput, childProfileId: 'child profile' }), RangeError);
  await assert.rejects(() => service.createInvitation({ ...baseInput, platform: 'IOS', requestedProtectionMode: 'ANDROID_STANDARD' }), RangeError);
});
