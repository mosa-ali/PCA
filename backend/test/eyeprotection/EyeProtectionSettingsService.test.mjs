import assert from 'node:assert/strict';
import test from 'node:test';
import { InMemoryFamilyTrustSetStore } from '../../dist/familytrustset/InMemoryFamilyTrustSetStore.js';
import { FamilyTrustSetRoleResolver } from '../../dist/familyrbac/TrustSetRoleResolver.js';
import { InMemoryActionIdempotencyLedger } from '../../dist/familyrbac/ActionIdempotencyLedger.js';
import { ParentActionAuthorizationService } from '../../dist/familyrbac/ParentActionAuthorizationService.js';
import { defaultFamilyRbacPolicyConfig } from '../../dist/familyrbac/types.js';
import { StaticChildProfileMembershipResolver } from '../../dist/childprofiles/ChildProfileMembershipResolver.js';
import { UnavailableTrustSetRoleResolver } from '../../dist/familyrbac/UnavailableTrustSetRoleResolver.js';
import { InMemoryEyeProtectionSettingsRepository } from '../../dist/eyeprotection/EyeProtectionSettingsRepository.js';
import { EyeProtectionError, EyeProtectionSettingsService } from '../../dist/eyeprotection/EyeProtectionSettingsService.js';

const CHILD_PROFILE_FAMILY_MAP = new Map([
  ['child-1', 'fam-1'],
  ['child-in-other-family', 'fam-2'],
]);
const T0 = new Date('2026-01-07T09:00:00.000Z');

function epoch() {
  return {
    familyId: 'fam-1',
    trustSetEpoch: 5,
    keyEpoch: 3,
    entries: [
      { deviceId: 'dev-owner', role: 'OWNER', dskKeyId: 'k1', dskPublicKey: 'pk1', dekKeyId: 'k2', dekPublicKey: 'pk2', status: 'ACTIVE' },
      { deviceId: 'dev-viewer', role: 'VIEWER', dskKeyId: 'k5', dskPublicKey: 'pk5', dekKeyId: 'k6', dekPublicKey: 'pk6', status: 'ACTIVE' },
    ],
    issuedAt: T0,
    supersedesEpoch: null,
    signature: 'sig',
  };
}

function makeHarness({ nowFn = () => T0, roleResolver } = {}) {
  const childProfileResolver = new StaticChildProfileMembershipResolver(CHILD_PROFILE_FAMILY_MAP);
  const resolver = roleResolver ?? (() => {
    const store = new InMemoryFamilyTrustSetStore();
    store.setCurrentEpoch(epoch());
    return new FamilyTrustSetRoleResolver(store);
  })();
  const authz = new ParentActionAuthorizationService(resolver, defaultFamilyRbacPolicyConfig, new InMemoryActionIdempotencyLedger(), nowFn, childProfileResolver);
  const repo = new InMemoryEyeProtectionSettingsRepository();
  const service = new EyeProtectionSettingsService(repo, authz, nowFn);
  return { repo, service };
}

test('get() returns a safe all-disabled default when no row exists yet, never throwing', async () => {
  const { service } = makeHarness();
  const settings = await service.get('fam-1', 'child-1');
  assert.equal(settings.remindersEnabled, false);
  assert.equal(settings.childProfileId, 'child-1');
  assert.equal(settings.updatedAtUtc, new Date(0).toISOString());
});

test('an Owner can enable reminders for their own child, and the write is durable through the repository', async () => {
  const { repo, service } = makeHarness();
  const updated = await service.updateReminders('fam-1', 'child-1', 'dev-owner', true, 'idem-1', 'action-1');
  assert.equal(updated.remindersEnabled, true);
  assert.equal(updated.childProfileId, 'child-1');

  const stored = await repo.get('fam-1', 'child-1');
  assert.equal(stored.remindersEnabled, true);
});

test('disabling reminders after enabling them round-trips correctly', async () => {
  const { service } = makeHarness();
  await service.updateReminders('fam-1', 'child-1', 'dev-owner', true, 'idem-1', 'action-1');
  const disabled = await service.updateReminders('fam-1', 'child-1', 'dev-owner', false, 'idem-2', 'action-2');
  assert.equal(disabled.remindersEnabled, false);
});

test('a VIEWER cannot edit the eye-protection setting: EyeProtectionError NOT_AUTHORIZED, no write occurs', async () => {
  const { repo, service } = makeHarness();
  await assert.rejects(
    () => service.updateReminders('fam-1', 'child-1', 'dev-viewer', true, 'idem-1', 'action-1'),
    (error) => error instanceof EyeProtectionError && error.code === 'NOT_AUTHORIZED',
  );
  const stored = await repo.get('fam-1', 'child-1');
  assert.equal(stored.remindersEnabled, false, 'no write should have happened');
});

test('cross-family target denial: a childProfileId belonging to another family is rejected', async () => {
  const { repo, service } = makeHarness();
  await assert.rejects(
    () => service.updateReminders('fam-1', 'child-in-other-family', 'dev-owner', true, 'idem-1', 'action-1'),
    (error) => error instanceof EyeProtectionError && error.code === 'NOT_AUTHORIZED',
  );
  const stored = await repo.get('fam-1', 'child-in-other-family');
  assert.equal(stored.remindersEnabled, false);
});

test('while UnavailableTrustSetRoleResolver is wired (production default), every update fails closed honestly', async () => {
  const { repo, service } = makeHarness({ roleResolver: new UnavailableTrustSetRoleResolver() });
  await assert.rejects(
    () => service.updateReminders('fam-1', 'child-1', 'dev-owner', true, 'idem-1', 'action-1'),
    (error) => error instanceof EyeProtectionError && error.code === 'NOT_AUTHORIZED',
  );
  const stored = await repo.get('fam-1', 'child-1');
  assert.equal(stored.remindersEnabled, false);
});
