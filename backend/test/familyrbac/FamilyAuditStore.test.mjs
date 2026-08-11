import assert from 'node:assert/strict';
import test from 'node:test';
import { FamilyAuditService, InMemoryFamilyAuditRepository, MAX_AUDIT_NOTE_LENGTH } from '../../dist/familyrbac/FamilyAuditStore.js';

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

test('the audit record type carries no URL, location, or activity-detail field -- only safe metadata', async () => {
  const repo = new InMemoryFamilyAuditRepository();
  const service = new FamilyAuditService(repo);
  const record = await service.record(baseInput());
  const keys = Object.keys(record);
  for (const forbidden of ['url', 'domain', 'location', 'latitude', 'longitude', 'searchQuery', 'pageTitle', 'recoverySecret']) {
    assert.equal(keys.includes(forbidden), false);
  }
});
