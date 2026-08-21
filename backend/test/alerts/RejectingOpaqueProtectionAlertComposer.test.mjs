// PCA-ADD-ENR-020: production wires createRejectingOpaqueProtectionAlertComposer()
// as ProtectionAlertProducer's composer until a reviewed one exists
// (CRYPTO_SUITE = PENDING_HUMAN_SECURITY_REVIEW, doc 09 PCA-DEC-020). Unlike
// RejectingDeviceSignatureVerifier/RejectingEnvelopeSignatureVerifier (which
// fail closed by returning false), this composer cannot return a boolean --
// it must produce ciphertext or nothing -- so its fail-closed mechanism is
// rejecting, never a fabricated/empty payload.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createRejectingOpaqueProtectionAlertComposer } from '../../dist/alerts/RejectingOpaqueProtectionAlertComposer.js';
import { ProtectionAlertProducer } from '../../dist/alerts/ProtectionAlertProducer.js';
import { InMemoryProtectionAlertLedger } from '../../dist/alerts/ProtectionAlertLedger.js';

function compositionInput(overrides = {}) {
  return {
    alertId: randomUUID(),
    familyId: 'family-1',
    deviceId: 'device-1',
    parentDeviceId: 'parent-device-1',
    trigger: 'INVITATION_REDEEMED',
    keyEpoch: 1,
    generatedAtUtc: new Date('2026-08-21T00:00:00.000Z'),
    ...overrides,
  };
}

test('the composer always rejects, for every trigger in the closed vocabulary', async () => {
  const composer = createRejectingOpaqueProtectionAlertComposer();
  const triggers = [
    'DISABLE_OR_REMOVAL_REQUESTED', 'REPEATED_INVALID_PIN', 'AUTHORITY_CHANGE',
    'CRITICAL_PERMISSION_OR_VPN_LOST', 'UNEXPECTED_OFFLINE', 'TIME_TAMPERING',
    'PROTECTION_DEGRADED', 'REINSTALLATION', 'INVITATION_REDEEMED', 'UNENROLLMENT',
  ];
  for (const trigger of triggers) {
    await assert.rejects(() => composer(compositionInput({ trigger })));
  }
});

test('the composer rejects even for a null deviceId (invitation-redemption shape)', async () => {
  const composer = createRejectingOpaqueProtectionAlertComposer();
  await assert.rejects(() => composer(compositionInput({ deviceId: null })));
});

test('the composer never returns a plausible-looking placeholder payload -- it throws, it never resolves', async () => {
  const composer = createRejectingOpaqueProtectionAlertComposer();
  let resolved = false;
  try {
    await composer(compositionInput());
    resolved = true;
  } catch {
    // expected
  }
  assert.equal(resolved, false);
});

test('wired into a real ProtectionAlertProducer, produce() rejects and records nothing in the ledger', async () => {
  const ledger = new InMemoryProtectionAlertLedger();
  const producer = new ProtectionAlertProducer(ledger, createRejectingOpaqueProtectionAlertComposer(), () => new Date('2026-08-21T00:00:00.000Z'));
  await assert.rejects(() =>
    producer.produce({
      familyId: 'family-1',
      deviceId: 'device-1',
      parentDeviceId: 'parent-device-1',
      trigger: 'INVITATION_REDEEMED',
      keyEpoch: 1,
      alertsEnabled: true,
    }),
  );
  assert.deepEqual(await ledger.listForFamily('family-1'), []);
});
