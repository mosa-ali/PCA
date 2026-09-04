// PPR-2 opaque central child-profile membership registry -- real MySQL
// coverage for MySqlChildProfileRegistryRepository: fresh-migration schema
// shape, the DELIBERATE ABSENCE of an FK to families (see migration 0036's
// own header), idempotent-retry behaviour under real duplicate-key
// detection, per-family scoping of the idempotency key, the doc 39
// Section 5 oracle-safety property, and concurrent create safety.
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import test from 'node:test';
import { MySqlChildProfileRegistryRepository } from '../../dist/childprofiles/MySqlChildProfileRegistryRepository.js';
import { closePool, getPool } from '../../dist/db/pool.js';

if (!process.env.PCA_DATABASE_URL) throw new Error('PCA_DATABASE_URL is required for backend/test/db tests.');

async function createFamily() {
  const familyId = randomUUID();
  await getPool().query(`INSERT INTO families (family_id, family_reference_hash, created_at) VALUES (?, ?, NOW(3))`, [familyId, randomBytes(32)]);
  return familyId;
}

test('MySQL: create() mints a server-side id, durably persisted, readable via listForFamily()', async () => {
  const repository = new MySqlChildProfileRegistryRepository();
  const familyId = await createFamily();
  const { outcome, row } = await repository.create(familyId, null, new Date());
  assert.equal(outcome, 'CREATED');
  assert.equal(row.familyId, familyId);
  assert.match(row.childProfileId, /^[0-9a-f-]{36}$/);

  const list = await repository.listForFamily(familyId);
  assert.equal(list.length, 1);
  assert.equal(list[0].childProfileId, row.childProfileId);
});

// No FK to families(family_id) exists (see migration 0036's own header for
// why -- a real, verified charset/collation incompatibility with every
// OTHER family-scoped table in this schema). This is a DELIBERATE
// consequence of that choice, not an oversight: family-scope enforcement
// happens at the application layer (AuthzService.requiresFamilyScope, via
// service_account_family_scopes), same as every sibling table
// (enrollment_invitations, devices, eye_protection_settings, ...) already
// does. This test pins that the schema layer permits it -- proving the
// application-layer check is load-bearing, not redundant with a DB
// constraint that does not exist.
test('MySQL: the schema layer does NOT reject an unknown family_id -- application-layer authorization is the real boundary here', async () => {
  const repository = new MySqlChildProfileRegistryRepository();
  const { outcome, row } = await repository.create('no-such-family-id-at-all', null, new Date());
  assert.equal(outcome, 'CREATED');
  assert.equal(row.familyId, 'no-such-family-id-at-all');
});

test('MySQL: listForFamily never returns another family\'s rows', async () => {
  const repository = new MySqlChildProfileRegistryRepository();
  const familyA = await createFamily();
  const familyB = await createFamily();
  await repository.create(familyA, null, new Date());
  await repository.create(familyB, null, new Date());
  await repository.create(familyB, null, new Date());

  const listA = await repository.listForFamily(familyA);
  const listB = await repository.listForFamily(familyB);
  assert.equal(listA.length, 1);
  assert.equal(listB.length, 2);
  assert.ok(!listB.some((row) => row.childProfileId === listA[0].childProfileId));
});

test('MySQL: resolveMembership -- MEMBER for own child, NOT_MEMBER_OR_NOT_FOUND (identical) for cross-family and nonexistent', async () => {
  const repository = new MySqlChildProfileRegistryRepository();
  const familyA = await createFamily();
  const familyB = await createFamily();
  const { row } = await repository.create(familyB, null, new Date());

  assert.equal(await repository.resolveMembership(familyB, row.childProfileId), 'MEMBER');
  const crossFamily = await repository.resolveMembership(familyA, row.childProfileId);
  const nonexistent = await repository.resolveMembership(familyA, randomUUID());
  assert.equal(crossFamily, 'NOT_MEMBER_OR_NOT_FOUND');
  assert.equal(nonexistent, 'NOT_MEMBER_OR_NOT_FOUND');
  assert.equal(crossFamily, nonexistent);
});

test('MySQL: replaying the same (family, idempotencyKey) via a REAL duplicate-key error returns the ORIGINAL row', async () => {
  const repository = new MySqlChildProfileRegistryRepository();
  const familyId = await createFamily();
  const key = `retry-${randomUUID()}`;
  const first = await repository.create(familyId, key, new Date());
  const second = await repository.create(familyId, key, new Date(Date.now() + 5000));
  assert.equal(first.outcome, 'CREATED');
  assert.equal(second.outcome, 'IDEMPOTENT_REPLAY');
  assert.equal(second.row.childProfileId, first.row.childProfileId);

  const list = await repository.listForFamily(familyId);
  assert.equal(list.length, 1);
});

test('MySQL: the SAME idempotency key for TWO different families creates TWO different children -- uniqueness is per-family', async () => {
  const repository = new MySqlChildProfileRegistryRepository();
  const familyA = await createFamily();
  const familyB = await createFamily();
  const key = `shared-${randomUUID()}`;
  const a = await repository.create(familyA, key, new Date());
  const b = await repository.create(familyB, key, new Date());
  assert.equal(a.outcome, 'CREATED');
  assert.equal(b.outcome, 'CREATED');
  assert.notEqual(a.row.childProfileId, b.row.childProfileId);
});

test('MySQL: key-less creates are never deduplicated against each other -- each is a genuinely new child', async () => {
  const repository = new MySqlChildProfileRegistryRepository();
  const familyId = await createFamily();
  await repository.create(familyId, null, new Date());
  await repository.create(familyId, null, new Date());
  const list = await repository.listForFamily(familyId);
  assert.equal(list.length, 2);
});

test('MySQL: N concurrent creates for the same (family, idempotencyKey) resolve to exactly ONE row -- the DB unique index is the real safety mechanism, not application logic', async () => {
  const repository = new MySqlChildProfileRegistryRepository();
  const familyId = await createFamily();
  const key = `concurrent-${randomUUID()}`;
  const results = await Promise.all(Array.from({ length: 8 }, () => repository.create(familyId, key, new Date())));
  const distinctIds = new Set(results.map((r) => r.row.childProfileId));
  assert.equal(distinctIds.size, 1, 'all 8 concurrent calls must resolve to the SAME childProfileId');
  assert.equal(results.filter((r) => r.outcome === 'CREATED').length, 1, 'exactly one call actually inserted');

  const list = await repository.listForFamily(familyId);
  assert.equal(list.length, 1);
});

test('MySQL: family_child_memberships has no readable child column -- direct schema check', async () => {
  const [columns] = await getPool().query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'family_child_memberships'`,
  );
  const names = columns.map((c) => c.COLUMN_NAME).sort();
  assert.deepEqual(names, ['child_profile_id', 'created_at', 'creation_request_key', 'family_id'].sort());
});

test.after(async () => {
  await closePool();
});
