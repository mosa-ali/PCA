import assert from 'node:assert/strict';
import test from 'node:test';
import { FamilyAuditService, InMemoryFamilyAuditRepository, MAX_AUDIT_NOTE_LENGTH } from '../../dist/familyrbac/FamilyAuditStore.js';
import { MAX_FAMILY_EPOCH } from '../../dist/familyepoch/bounds.js';

function baseInput(overrides = {}) {
  return {
    familyId: 'fam-1',
    actionType: 'EDIT_CHILD_POLICY',
    actorDeviceId: 'dev-owner',
    actorMemberId: 'member-1',
    targetScope: { kind: 'CHILD_PROFILE', id: 'child-1' },
    authorizationRole: 'OWNER',
    trustSetEpoch: 5,
    policyRevision: 3,
    clientMonotonicSequence: 1,
    resultStatus: 'SUCCESS',
    targetAcknowledgementCount: 1,
    reasonCategory: null,
    correlationId: null,
    actionId: 'act-1',
    ...overrides,
  };
}

test('record appends an append-only audit record with a fresh eventId and timestamp', async () => {
  const repo = new InMemoryFamilyAuditRepository();
  const service = new FamilyAuditService(repo, () => new Date('2026-01-01T00:00:00Z'));
  const record = await service.record(baseInput());
  assert.ok(record.eventId.length > 0);
  assert.equal(record.occurredAtUtc.toISOString(), '2026-01-01T00:00:00.000Z');
});

test('listForFamily never returns another family\'s audit records', async () => {
  const repo = new InMemoryFamilyAuditRepository();
  const service = new FamilyAuditService(repo);
  await service.record(baseInput({ familyId: 'fam-1' }));
  await service.record(baseInput({ familyId: 'fam-2' }));
  const list = await repo.listForFamily('fam-1');
  assert.equal(list.length, 1);
  assert.equal(list[0].familyId, 'fam-1');
});

test('free text is truncated to MAX_AUDIT_NOTE_LENGTH', async () => {
  const repo = new InMemoryFamilyAuditRepository();
  const service = new FamilyAuditService(repo);
  const longNote = 'x'.repeat(MAX_AUDIT_NOTE_LENGTH + 50);
  const record = await service.record(baseInput({ freeTextNote: longNote }));
  assert.equal(record.freeTextNote.length, MAX_AUDIT_NOTE_LENGTH);
});

test('an absent free text note is stored as null, not an empty string', async () => {
  const repo = new InMemoryFamilyAuditRepository();
  const service = new FamilyAuditService(repo);
  const record = await service.record(baseInput());
  assert.equal(record.freeTextNote, null);
});

test('audit epoch keeps the zero sentinel and rejects values outside the SQL INT range before append', async () => {
  const repo = new InMemoryFamilyAuditRepository();
  const service = new FamilyAuditService(repo);
  const sentinel = await service.record(baseInput({ trustSetEpoch: 0 }));
  assert.equal(sentinel.trustSetEpoch, 0);
  await assert.rejects(service.record(baseInput({ trustSetEpoch: MAX_FAMILY_EPOCH + 1 })), /invalid trust set epoch/);
  assert.equal((await repo.listForFamily('fam-1')).length, 1);
});

test('the audit record type carries no URL, location, or activity-detail field -- only safe metadata', async () => {
  const repo = new InMemoryFamilyAuditRepository();
  const service = new FamilyAuditService(repo);
  const record = await service.record(baseInput());
  const keys = Object.keys(record);
  for (const forbidden of ['url', 'domain', 'location', 'latitude', 'longitude', 'searchQuery', 'pageTitle', 'recoverySecret']) {
    assert.equal(keys.includes(forbidden), false);
  }
});

test('caller and async repository mutation cannot change the captured audit record or listed LKG', async () => {
  const backing = new InMemoryFamilyAuditRepository();
  let appendStarted;
  const started = new Promise(resolve => { appendStarted = resolve; });
  let releaseAppend;
  const appendGate = new Promise(resolve => { releaseAppend = resolve; });
  let repositoryRecord;
  const repository = {
    async append(record) {
      repositoryRecord = record;
      appendStarted();
      await appendGate;
      await backing.append(record);
      // A repository that retains and mutates its argument must not mutate the
      // service's canonical record or the independent copy stored by backing.
      record.targetScope.id = 'repository-mutated-child';
      record.occurredAtUtc.setTime(0);
    },
    listForFamily: familyId => backing.listForFamily(familyId),
  };
  const clockDate = new Date('2026-01-01T00:00:00Z');
  const service = new FamilyAuditService(repository, () => clockDate);
  const input = baseInput();
  const recording = service.record(input);
  await started;

  input.targetScope.id = 'caller-mutated-child-before-append';
  clockDate.setTime(0);
  releaseAppend();
  const returned = await recording;

  assert.equal(repositoryRecord.targetScope.id, 'repository-mutated-child');
  assert.equal(returned.targetScope.id, 'child-1');
  assert.equal(returned.occurredAtUtc.toISOString(), '2026-01-01T00:00:00.000Z');
  returned.targetScope.id = 'caller-mutated-return-value';
  returned.occurredAtUtc.setTime(1);
  input.targetScope.id = 'caller-mutated-child-after-append';

  const listed = await repository.listForFamily('fam-1');
  assert.equal(listed.length, 1);
  assert.equal(listed[0].targetScope.id, 'child-1');
  assert.equal(listed[0].occurredAtUtc.toISOString(), '2026-01-01T00:00:00.000Z');
  listed[0].targetScope.id = 'caller-mutated-list-result';
  listed[0].occurredAtUtc.setTime(2);
  const listedAgain = await repository.listForFamily('fam-1');
  assert.equal(listedAgain[0].targetScope.id, 'child-1');
  assert.equal(listedAgain[0].occurredAtUtc.toISOString(), '2026-01-01T00:00:00.000Z');
});

test('async delivery mutation cannot change stored audit scope, timestamp, or returned record', async () => {
  const repo = new InMemoryFamilyAuditRepository();
  const service = new FamilyAuditService(repo, () => new Date('2026-01-01T00:00:00Z'));
  let deliveryStarted;
  const started = new Promise(resolve => { deliveryStarted = resolve; });
  let releaseDelivery;
  const deliveryGate = new Promise(resolve => { releaseDelivery = resolve; });
  let deliveryRecord;
  service.configureDelivery({
    async deliver(record) {
      deliveryRecord = record;
      deliveryStarted();
      await deliveryGate;
      record.targetScope.id = 'delivery-mutated-child';
      record.occurredAtUtc.setTime(0);
    },
  });

  const recording = service.record(baseInput());
  await started;
  releaseDelivery();
  const returned = await recording;

  assert.equal(deliveryRecord.targetScope.id, 'delivery-mutated-child');
  assert.equal(returned.targetScope.id, 'child-1');
  assert.equal(returned.occurredAtUtc.toISOString(), '2026-01-01T00:00:00.000Z');
  const listed = await repo.listForFamily('fam-1');
  assert.equal(listed[0].targetScope.id, 'child-1');
  assert.equal(listed[0].occurredAtUtc.toISOString(), '2026-01-01T00:00:00.000Z');
});

test('audit projection excludes unapproved input and nested target-scope fields at every boundary', async () => {
  const repo = new InMemoryFamilyAuditRepository();
  const service = new FamilyAuditService(repo, () => new Date('2026-01-01T00:00:00Z'));
  const delivered = [];
  service.configureDelivery({ async deliver(record) { delivered.push(record); } });
  const input = {
    ...baseInput(),
    url: 'https://private.example/path',
    location: { latitude: 12.3, longitude: 45.6 },
    secret: 'marker',
    targetScope: {
      kind: 'CHILD_PROFILE',
      id: 'child-1',
      url: 'https://child.example/',
      location: 'private-location',
      secret: 'marker',
      nested: { recoverySecret: 'marker' },
    },
  };

  const returned = await service.record(input);
  const [stored] = await repo.listForFamily('fam-1');

  for (const record of [returned, stored, delivered[0]]) {
    assert.deepEqual(Object.keys(record.targetScope).sort(), ['id', 'kind']);
    assert.deepEqual(Object.keys(record).sort(), [
      'actionId', 'actionType', 'actorDeviceId', 'actorMemberId', 'authorizationRole',
      'clientMonotonicSequence', 'correlationId', 'eventId', 'familyId', 'freeTextNote',
      'occurredAtUtc', 'policyRevision', 'reasonCategory', 'resultStatus',
      'targetAcknowledgementCount', 'targetScope', 'trustSetEpoch',
    ].sort());
    assert.equal(record.targetScope.id, 'child-1');
    assert.equal('url' in record.targetScope, false);
    assert.equal('location' in record.targetScope, false);
    assert.equal('secret' in record.targetScope, false);
  }
});
