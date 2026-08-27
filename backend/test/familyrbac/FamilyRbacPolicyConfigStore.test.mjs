import assert from 'node:assert/strict';
import test from 'node:test';
import { FamilyRbacPolicyConfigStore } from '../../dist/familyrbac/FamilyRbacPolicyConfigStore.js';
import { defaultFamilyRbacPolicyConfig } from '../../dist/familyrbac/types.js';

function createFakeRepository() {
  const byFamily = new Map();
  return {
    byFamily,
    async getForFamily(familyId) {
      return byFamily.get(familyId) ?? null;
    },
    async setForFamily(familyId, config) {
      byFamily.set(familyId, config);
    },
  };
}

test('snapshotFor returns the safe global default for a family never loaded or set', () => {
  const store = new FamilyRbacPolicyConfigStore(createFakeRepository());
  assert.deepEqual(store.snapshotFor('fam-unknown'), defaultFamilyRbacPolicyConfig());
});

test('setForFamily persists to the repository AND updates the in-memory snapshot immediately (write-through)', async () => {
  const repository = createFakeRepository();
  const store = new FamilyRbacPolicyConfigStore(repository);
  const config = { administratorCanManageViewers: true, administratorCanRevokeDeviceOrDisableProtection: false };
  await store.setForFamily('fam-1', config, new Date());

  assert.deepEqual(store.snapshotFor('fam-1'), config); // immediately visible, no separate reload needed
  assert.deepEqual(repository.byFamily.get('fam-1'), config); // genuinely durable, not cache-only
});

test('loadFamily populates the cache from a repository row set by a prior process (durability across restarts)', async () => {
  const repository = createFakeRepository();
  const config = { administratorCanManageViewers: false, administratorCanRevokeDeviceOrDisableProtection: true };
  repository.byFamily.set('fam-2', config); // simulates a row already durably persisted before this store instance existed
  const store = new FamilyRbacPolicyConfigStore(repository);

  assert.deepEqual(store.snapshotFor('fam-2'), defaultFamilyRbacPolicyConfig()); // not yet loaded into THIS instance's cache
  const loaded = await store.loadFamily('fam-2');
  assert.deepEqual(loaded, config);
  assert.deepEqual(store.snapshotFor('fam-2'), config); // now reflected synchronously
});

test('configuration is genuinely per-family, not a single global value shared across every family', async () => {
  const store = new FamilyRbacPolicyConfigStore(createFakeRepository());
  await store.setForFamily('fam-A', { administratorCanManageViewers: true, administratorCanRevokeDeviceOrDisableProtection: true }, new Date());
  await store.setForFamily('fam-B', { administratorCanManageViewers: false, administratorCanRevokeDeviceOrDisableProtection: false }, new Date());

  assert.equal(store.snapshotFor('fam-A').administratorCanManageViewers, true);
  assert.equal(store.snapshotFor('fam-B').administratorCanManageViewers, false);
  // A third, never-configured family is unaffected by either -- still the safe default.
  assert.deepEqual(store.snapshotFor('fam-C'), defaultFamilyRbacPolicyConfig());
});

test('snapshotFor is bindable as a bare function reference (ParentActionAuthorizationService.configProvider contract)', async () => {
  const store = new FamilyRbacPolicyConfigStore(createFakeRepository());
  await store.setForFamily('fam-1', { administratorCanManageViewers: true, administratorCanRevokeDeviceOrDisableProtection: false }, new Date());
  const configProvider = store.snapshotFor; // extracted, NOT called as store.snapshotFor(...) -- proves `this` is not required
  assert.deepEqual(configProvider('fam-1'), { administratorCanManageViewers: true, administratorCanRevokeDeviceOrDisableProtection: false });
});
