import assert from 'node:assert/strict';
import test from 'node:test';
import { InMemoryChildProfileRegistryRepository } from '../../dist/childprofiles/ChildProfileRegistryRepository.js';

const T0 = new Date('2026-01-07T09:00:00.000Z');
const FAMILY = 'family-registry-1';
const OTHER_FAMILY = 'family-registry-other';

test('create mints a server-side id -- the caller never supplies one', async () => {
  let mintCalls = 0;
  const repository = new InMemoryChildProfileRegistryRepository(() => {
    mintCalls += 1;
    return `minted-${mintCalls}`;
  });
  const { outcome, row } = await repository.create(FAMILY, null, T0);
  assert.equal(outcome, 'CREATED');
  assert.equal(row.childProfileId, 'minted-1');
  assert.equal(mintCalls, 1);
});

test('listForFamily returns only that family\'s rows, in creation order', async () => {
  const repository = new InMemoryChildProfileRegistryRepository();
  const a = await repository.create(FAMILY, null, T0);
  await repository.create(OTHER_FAMILY, null, T0);
  const b = await repository.create(FAMILY, null, new Date(T0.getTime() + 1000));

  const list = await repository.listForFamily(FAMILY);
  assert.equal(list.length, 2);
  assert.deepEqual(
    list.map((row) => row.childProfileId),
    [a.row.childProfileId, b.row.childProfileId],
  );
});

test('resolveMembership: MEMBER only when the id exists AND belongs to the asking family', async () => {
  const repository = new InMemoryChildProfileRegistryRepository();
  const { row } = await repository.create(FAMILY, null, T0);

  assert.equal(await repository.resolveMembership(FAMILY, row.childProfileId), 'MEMBER');
});

test('resolveMembership: a nonexistent id and a cross-family id are INDISTINGUISHABLE (oracle-safety, doc 39 Section 5)', async () => {
  const repository = new InMemoryChildProfileRegistryRepository();
  const { row } = await repository.create(OTHER_FAMILY, null, T0);

  const nonexistent = await repository.resolveMembership(FAMILY, 'no-such-id');
  const crossFamily = await repository.resolveMembership(FAMILY, row.childProfileId);
  assert.equal(nonexistent, 'NOT_MEMBER_OR_NOT_FOUND');
  assert.equal(crossFamily, 'NOT_MEMBER_OR_NOT_FOUND');
  assert.equal(nonexistent, crossFamily);
});

test('an idempotency key is scoped per family -- the same key for two families never collides', async () => {
  const repository = new InMemoryChildProfileRegistryRepository();
  const a = await repository.create(FAMILY, 'shared-key', T0);
  const b = await repository.create(OTHER_FAMILY, 'shared-key', T0);
  assert.equal(a.outcome, 'CREATED');
  assert.equal(b.outcome, 'CREATED');
  assert.notEqual(a.row.childProfileId, b.row.childProfileId);
});

test('replaying the same (family, key) pair returns IDEMPOTENT_REPLAY with the ORIGINAL row, not a new one', async () => {
  const repository = new InMemoryChildProfileRegistryRepository();
  const first = await repository.create(FAMILY, 'retry-1', T0);
  const second = await repository.create(FAMILY, 'retry-1', new Date(T0.getTime() + 5000));
  assert.equal(first.outcome, 'CREATED');
  assert.equal(second.outcome, 'IDEMPOTENT_REPLAY');
  assert.equal(second.row.childProfileId, first.row.childProfileId);
  assert.equal(second.row.createdAtUtc, first.row.createdAtUtc);
});

test('two key-less creates for the same family each produce a genuinely distinct child', async () => {
  const repository = new InMemoryChildProfileRegistryRepository();
  const a = await repository.create(FAMILY, null, T0);
  const b = await repository.create(FAMILY, null, T0);
  assert.equal(a.outcome, 'CREATED');
  assert.equal(b.outcome, 'CREATED');
  assert.notEqual(a.row.childProfileId, b.row.childProfileId);
});
