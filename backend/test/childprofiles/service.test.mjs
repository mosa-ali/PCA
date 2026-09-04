import assert from 'node:assert/strict';
import test from 'node:test';
import { ChildProfileService, ChildProfileError } from '../../dist/childprofiles/ChildProfileService.js';
import { InMemoryChildProfileRegistryRepository } from '../../dist/childprofiles/ChildProfileRegistryRepository.js';

const T0 = new Date('2026-01-07T09:00:00.000Z');
const FAMILY = 'family-service-1';

test('createChildProfile never receives, stores, or returns a readable field -- the input contract has none', async () => {
  const repository = new InMemoryChildProfileRegistryRepository();
  const service = new ChildProfileService(repository, () => T0);
  const result = await service.createChildProfile(FAMILY, null);
  assert.deepEqual(Object.keys(result).sort(), ['childProfileId', 'createdAtUtc']);
});

test('an idempotency key over the length limit is rejected before touching the repository', async () => {
  const repository = new InMemoryChildProfileRegistryRepository();
  const service = new ChildProfileService(repository, () => T0);
  const tooLong = 'x'.repeat(192);
  await assert.rejects(() => service.createChildProfile(FAMILY, tooLong), (error) => {
    assert.ok(error instanceof ChildProfileError);
    assert.equal(error.code, 'INVALID_IDEMPOTENCY_KEY');
    return true;
  });
  assert.deepEqual(await repository.listForFamily(FAMILY), []);
});

test('an empty-string idempotency key is rejected', async () => {
  const repository = new InMemoryChildProfileRegistryRepository();
  const service = new ChildProfileService(repository, () => T0);
  await assert.rejects(() => service.createChildProfile(FAMILY, ''), (error) => {
    assert.ok(error instanceof ChildProfileError);
    assert.equal(error.code, 'INVALID_IDEMPOTENCY_KEY');
    return true;
  });
});

test('listChildProfiles returns the repository rows unmodified, still with no readable field', async () => {
  const repository = new InMemoryChildProfileRegistryRepository();
  const service = new ChildProfileService(repository, () => T0);
  await service.createChildProfile(FAMILY, null);
  const list = await service.listChildProfiles(FAMILY);
  assert.equal(list.length, 1);
  assert.deepEqual(Object.keys(list[0]).sort(), ['childProfileId', 'createdAtUtc', 'familyId']);
});
