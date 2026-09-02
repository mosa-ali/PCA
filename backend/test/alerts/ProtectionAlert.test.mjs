import assert from 'node:assert/strict';
import test from 'node:test';
import {
  generateProtectionAlert,
  InvalidProtectionAlertInputError,
} from '../../dist/alerts/ProtectionAlertGenerator.js';
import { InMemoryProtectionAlertLedger } from '../../dist/alerts/ProtectionAlertLedger.js';

// Server-ciphertext TTL (migration 0034): these ledgers now expire rows
// SERVER_CIPHERTEXT_TTL_MS after generatedAtUtc, so a fixture dated in the
// past would be correctly filtered out against a real wall clock. Anchor the
// ledger's clock to the same instant the fixtures use.
const LEDGER_NOW = new Date('2026-08-19T12:00:00.000Z');

const BASE = {
  alertId: 'alert-1',
  familyId: 'family-1',
  deviceId: 'device-1',
  parentDeviceId: 'parent-1',
  trigger: 'PROTECTION_DEGRADED',
  keyEpoch: 3,
  generatedAtUtc: new Date('2026-08-19T12:00:00.000Z'),
  encryptedPayloadB64: 'AQID',
  nonceB64: 'BAUG',
  alertsEnabled: true,
};

test('PCA-ADD-ENR-020 creates opaque typed events and remains disabled by default', () => {
  assert.equal(generateProtectionAlert({ ...BASE, alertsEnabled: false }), null);
  const event = generateProtectionAlert(BASE);
  assert.equal(event?.trigger, 'PROTECTION_DEGRADED');
  assert.equal(event?.encryptedPayloadB64, 'AQID');
  assert.equal('plaintext' in event, false);
});

test('PCA-ADD-ENR-020 requires encrypted payloads and device identity for device-scoped triggers', () => {
  assert.throws(
    () => generateProtectionAlert({ ...BASE, encryptedPayloadB64: 'not-base64' }),
    InvalidProtectionAlertInputError,
  );
  assert.throws(
    () => generateProtectionAlert({ ...BASE, deviceId: null }),
    /requires a deviceId/,
  );
  const invitation = generateProtectionAlert({ ...BASE, deviceId: null, trigger: 'INVITATION_REDEEMED' });
  assert.equal(invitation?.deviceId, null);
});

test('PCA-ADD-ENR-020 ledger is append-only and idempotent without a plaintext read path', async () => {
  const ledger = new InMemoryProtectionAlertLedger(() => LEDGER_NOW);
  const event = generateProtectionAlert(BASE);
  assert.ok(event);
  assert.deepEqual(await ledger.record(event), { outcome: 'RECORDED' });
  assert.deepEqual(await ledger.record(event), { outcome: 'IDEMPOTENT_MATCH' });
  assert.deepEqual(
    await ledger.record({ ...event, encryptedPayloadB64: 'CQkJ' }),
    { outcome: 'CONFLICT' },
  );
  assert.deepEqual((await ledger.listForParentDevice('family-1', 'parent-1')).map((item) => item.alertId), ['alert-1']);
});
