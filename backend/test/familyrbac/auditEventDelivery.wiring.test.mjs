// Verifies FamilyAuditService.configureDelivery's real wiring seam (PCA
// product-completion programme, Writer P0-D): a REAL authorized mutation
// through FamilyMemberInvitationService.createInvitation -- the same
// service/call-site Writer P0-C built -- actually produces a delivered
// AUDIT_EVENT-shaped opaque envelope, with zero changes to
// FamilyMemberInvitationService/ParentActionAuthorizationService's own call
// sites. Mirrors auditWiring.test.mjs's own "call the real service, assert
// on what landed downstream" convention, extended one hop further (past
// FamilyAuditRepository.append into FamilyAuditEventProducer.deliver).
import assert from 'node:assert/strict';
import test from 'node:test';
import { FamilyAuditService, InMemoryFamilyAuditRepository } from '../../dist/familyrbac/FamilyAuditStore.js';
import { FamilyAuditEventProducer } from '../../dist/familyrbac/FamilyAuditEventProducer.js';
import { InMemoryFamilyAuditEventLedger } from '../../dist/familyrbac/FamilyAuditEventLedger.js';
import { FamilyMemberInvitationService } from '../../dist/familymembers/FamilyMemberInvitationService.js';
import { createInMemoryFamilyMemberInvitationRepository } from '../support/inMemoryFamilyMemberInvitationRepository.mjs';

// Server-ciphertext TTL (migration 0034): these ledgers now expire rows
// SERVER_CIPHERTEXT_TTL_MS after generatedAtUtc, so a fixture dated in the
// past would be correctly filtered out against a real wall clock. Anchor the
// ledger's clock to the same instant the fixtures use.
const LEDGER_NOW = new Date('2026-01-01T00:00:00.000Z');

function fakeAuthorization(verdict = { verdict: 'ALLOW' }) {
  return { authorize: () => verdict };
}

test('creating a family-member invitation through the real service delivers a decryptable-shaped opaque audit envelope to the resolved parent device', async () => {
  const auditRepository = new InMemoryFamilyAuditRepository();
  const familyAuditService = new FamilyAuditService(auditRepository, () => new Date('2026-01-01T00:00:00.000Z'));

  const eventLedger = new InMemoryFamilyAuditEventLedger(() => LEDGER_NOW);
  const composedInputs = [];
  const composer = async (input) => {
    composedInputs.push(input);
    return { encryptedPayloadB64: 'b3BhcXVl', nonceB64: 'bm9uY2UtdmFsdWU' };
  };
  const resolveParentDevices = async (familyId) => [{ deviceId: `owner-device-of-${familyId}`, keyEpoch: 7 }];
  familyAuditService.configureDelivery(new FamilyAuditEventProducer(eventLedger, composer, resolveParentDevices));

  const invitationService = new FamilyMemberInvitationService(
    createInMemoryFamilyMemberInvitationRepository(),
    fakeAuthorization({ verdict: 'ALLOW' }),
    () => new Date('2026-01-01T00:00:00.000Z'),
    familyAuditService,
  );

  await invitationService.createInvitation({
    familyId: 'fam-delivery-1',
    invitedEmail: 'new-member@example.test',
    role: 'VIEWER',
    invitedByAccountId: 'account-owner-1',
    actorDeviceId: 'actor-device-owner-1',
  });

  // The underlying plaintext audit record was durably appended, unaffected by delivery.
  const plaintextRecords = await auditRepository.listForFamily('fam-delivery-1');
  assert.equal(plaintextRecords.length, 1);
  assert.equal(plaintextRecords[0].actionType, 'ROLE_INVITATION');

  // A real opaque envelope was delivered to the family's resolved parent device.
  const delivered = await eventLedger.listForParentDevice('fam-delivery-1', 'owner-device-of-fam-delivery-1');
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0].encryptedPayloadB64, 'b3BhcXVl');
  assert.equal(delivered[0].keyEpoch, 7);

  // The composer received the real plaintext record content -- never a fabricated/empty stand-in.
  assert.equal(composedInputs.length, 1);
  assert.equal(composedInputs[0].record.actionType, 'ROLE_INVITATION');
  assert.equal(composedInputs[0].record.familyId, 'fam-delivery-1');
});

test('when no delivery is configured, record() behaves exactly as before -- no error, no envelope, unchanged callers unaffected', async () => {
  const auditRepository = new InMemoryFamilyAuditRepository();
  const familyAuditService = new FamilyAuditService(auditRepository, () => new Date('2026-01-01T00:00:00.000Z'));
  // Deliberately never calling configureDelivery().

  const invitationService = new FamilyMemberInvitationService(
    createInMemoryFamilyMemberInvitationRepository(),
    fakeAuthorization({ verdict: 'ALLOW' }),
    () => new Date('2026-01-01T00:00:00.000Z'),
    familyAuditService,
  );

  await assert.doesNotReject(() =>
    invitationService.createInvitation({
      familyId: 'fam-no-delivery',
      invitedEmail: 'another@example.test',
      role: 'VIEWER',
      invitedByAccountId: 'account-owner-2',
      actorDeviceId: 'actor-device-owner-2',
    }),
  );
  assert.equal((await auditRepository.listForFamily('fam-no-delivery')).length, 1);
});

test('a delivery failure (composer throws) never blocks or reverses the mutation the audit record describes', async () => {
  const auditRepository = new InMemoryFamilyAuditRepository();
  const familyAuditService = new FamilyAuditService(auditRepository, () => new Date('2026-01-01T00:00:00.000Z'));
  const eventLedger = new InMemoryFamilyAuditEventLedger(() => LEDGER_NOW);
  familyAuditService.configureDelivery(
    new FamilyAuditEventProducer(
      eventLedger,
      async () => {
        throw new Error('crypto suite not reviewed');
      },
      async () => [{ deviceId: 'owner-device', keyEpoch: 1 }],
    ),
  );

  const invitationService = new FamilyMemberInvitationService(
    createInMemoryFamilyMemberInvitationRepository(),
    fakeAuthorization({ verdict: 'ALLOW' }),
    () => new Date('2026-01-01T00:00:00.000Z'),
    familyAuditService,
  );

  const created = await invitationService.createInvitation({
    familyId: 'fam-delivery-fails',
    invitedEmail: 'third@example.test',
    role: 'ADMINISTRATOR',
    invitedByAccountId: 'account-owner-3',
    actorDeviceId: 'actor-device-owner-3',
  });

  assert.equal(created.status, 'PENDING');
  assert.equal((await auditRepository.listForFamily('fam-delivery-fails')).length, 1);
  assert.equal((await eventLedger.listForFamily('fam-delivery-fails')).length, 0);
});
