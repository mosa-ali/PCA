// PCA-ADD-ENR-020: real-MySQL proof that MySqlProtectionAlertLedger
// genuinely persists opaque alert envelopes (append-only, idempotent by
// alert_id, never a silent overwrite), and that MySqlOwnerParentDeviceResolver
// reads a real, signature-chain-verified Owner device out of the family
// commercial authority tables -- not a fabricated/guessed recipient.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { closePool, getPool } from '../../dist/db/pool.js';
import { MySqlProtectionAlertLedger } from '../../dist/alerts/MySqlProtectionAlertLedger.js';
import { MySqlOwnerParentDeviceResolver } from '../../dist/alerts/MySqlOwnerParentDeviceResolver.js';
import { MySqlFamilyAuthorityGenesisStore } from '../../dist/familycommercial/authority/MySqlGenesisAnchorStore.js';
import { MySqlFamilyAuthorityAttestationChainStore } from '../../dist/familycommercial/authority/MySqlAttestationChainStore.js';
import { FamilyOwnerAttestationChainEngine } from '../../dist/familycommercial/authority/FamilyOwnerAttestationChainEngine.js';
import { createTestOnlyDeviceSignatureVerifier } from '../support/testOnlyDeviceSignatureVerifier.mjs';
import { buildGenesisAnchor, buildGenesisAttestation, buildTransferAttestation } from '../familycommercial/authority/fixtures.mjs';

if (!process.env.PCA_DATABASE_URL) throw new Error('PCA_DATABASE_URL is required for backend/test/db tests.');

// Server-ciphertext TTL (migration 0034): protection_alerts rows now expire
// SERVER_CIPHERTEXT_TTL_MS after generatedAtUtc, and record() purges expired
// rows as housekeeping. The fixtures below are dated 2026-08-21, so against a
// real wall clock they would be legitimately expired; anchor the ledger's clock
// to the fixture instant so these tests keep asserting persistence semantics
// rather than the TTL (which backend/test/db/auditAlertCiphertextExpiry.mysql.test.mjs covers).
const LEDGER_NOW = new Date('2026-08-21T00:00:00.000Z');
const ledger = new MySqlProtectionAlertLedger(() => LEDGER_NOW);
const attestationChainStore = new MySqlFamilyAuthorityAttestationChainStore();
const resolver = new MySqlOwnerParentDeviceResolver(attestationChainStore);

function engine() {
  return new FamilyOwnerAttestationChainEngine(
    new MySqlFamilyAuthorityGenesisStore(),
    attestationChainStore,
    createTestOnlyDeviceSignatureVerifier(),
    () => new Date('2026-01-03T00:00:00Z'),
  );
}

function alertEvent(overrides = {}) {
  return {
    alertId: randomUUID(),
    familyId: `family-${randomUUID()}`,
    deviceId: `device-${randomUUID()}`,
    parentDeviceId: `parent-${randomUUID()}`,
    trigger: 'INVITATION_REDEEMED',
    keyEpoch: 1,
    generatedAtUtc: new Date('2026-08-21T00:00:00.000Z'),
    encryptedPayloadB64: 'AQID',
    nonceB64: 'BAUG',
    ...overrides,
  };
}

test('record persists a real row, readable back byte-identical', async () => {
  const event = alertEvent();
  const result = await ledger.record(event);
  assert.deepEqual(result, { outcome: 'RECORDED' });
  const fetched = await ledger.get(event.alertId);
  assert.deepEqual(fetched, event);
});

test('recording the identical event twice is IDEMPOTENT_MATCH, never a second row', async () => {
  const event = alertEvent();
  assert.deepEqual(await ledger.record(event), { outcome: 'RECORDED' });
  assert.deepEqual(await ledger.record(event), { outcome: 'IDEMPOTENT_MATCH' });
  const [rows] = await getPool().query('SELECT COUNT(*) AS n FROM protection_alerts WHERE alert_id = ?', [event.alertId]);
  assert.equal(Number(rows[0].n), 1);
});

test('recording a DIFFERENT event under an already-used alert_id is CONFLICT, never a silent overwrite', async () => {
  const event = alertEvent();
  assert.deepEqual(await ledger.record(event), { outcome: 'RECORDED' });
  const conflicting = alertEvent({ alertId: event.alertId, trigger: 'UNENROLLMENT' });
  assert.deepEqual(await ledger.record(conflicting), { outcome: 'CONFLICT' });
  const fetched = await ledger.get(event.alertId);
  assert.equal(fetched.trigger, 'INVITATION_REDEEMED', 'the original row must survive unchanged');
});

test('listForFamily returns only this family, ordered chronologically', async () => {
  const familyId = `family-${randomUUID()}`;
  const other = `family-${randomUUID()}`;
  const first = alertEvent({ familyId, generatedAtUtc: new Date('2026-08-21T00:00:00.000Z') });
  const second = alertEvent({ familyId, generatedAtUtc: new Date('2026-08-21T00:05:00.000Z') });
  const foreign = alertEvent({ familyId: other });
  await ledger.record(second);
  await ledger.record(first);
  await ledger.record(foreign);
  const events = await ledger.listForFamily(familyId);
  assert.deepEqual(events.map((e) => e.alertId), [first.alertId, second.alertId]);
});

test('listForParentDevice filters to the exact parent device within a family', async () => {
  const familyId = `family-${randomUUID()}`;
  const parentA = `parent-${randomUUID()}`;
  const parentB = `parent-${randomUUID()}`;
  const forA = alertEvent({ familyId, parentDeviceId: parentA });
  const forB = alertEvent({ familyId, parentDeviceId: parentB });
  await ledger.record(forA);
  await ledger.record(forB);
  const events = await ledger.listForParentDevice(familyId, parentA);
  assert.deepEqual(events.map((e) => e.alertId), [forA.alertId]);
});

test('deviceId may be null (invitation redemption before a device is bound), round-trips correctly', async () => {
  const event = alertEvent({ deviceId: null });
  await ledger.record(event);
  const fetched = await ledger.get(event.alertId);
  assert.equal(fetched.deviceId, null);
});

test('an unknown alertId reads back null', async () => {
  assert.equal(await ledger.get(randomUUID()), null);
});

test('the schema CHECK constraint rejects a trigger outside the closed vocabulary', async () => {
  await assert.rejects(() =>
    getPool().query(
      `INSERT INTO protection_alerts (alert_id, family_id, parent_device_id, trigger_type, key_epoch, generated_at_utc, encrypted_payload_b64, nonce_b64)
       VALUES (?, 'family-x', 'parent-x', 'MADE_UP_TRIGGER', 1, NOW(3), 'AQID', 'BAUG')`,
      [randomUUID()],
    ),
  );
});

test('MySqlOwnerParentDeviceResolver resolves the real, signature-chain-verified genesis Owner as the sole recipient', async () => {
  const familyId = `fam-alert-owner-${randomUUID()}`;
  const anchor = buildGenesisAnchor({ familyId, genesisDeviceId: 'owner-dev-1' });
  const genesisAttestation = buildGenesisAttestation(anchor);
  const bootstrapResult = await engine().bootstrapFamilyAuthority({ anchor, genesisAttestation });
  assert.equal(bootstrapResult.status, 'BOOTSTRAPPED');

  const parentDevices = await resolver.resolveParentDevices(familyId);
  assert.deepEqual(parentDevices, [{ deviceId: 'owner-dev-1', keyEpoch: genesisAttestation.keyEpoch }]);
});

test('MySqlOwnerParentDeviceResolver follows an Owner transfer -- resolves the NEW owner, never the outgoing one', async () => {
  const familyId = `fam-alert-transfer-${randomUUID()}`;
  const anchor = buildGenesisAnchor({ familyId, genesisDeviceId: 'owner-dev-old' });
  const genesisAttestation = buildGenesisAttestation(anchor);
  const bootstrapResult = await engine().bootstrapFamilyAuthority({ anchor, genesisAttestation });
  const next = buildTransferAttestation(genesisAttestation, bootstrapResult.attestationId, {
    ownerDeviceId: 'owner-dev-new', ownerDskKeyId: 'nk-1', ownerDskPublicKey: 'pk-new-owner', keyEpoch: 2,
  });
  const transferResult = await engine().transferOwnerAuthority(familyId, next);
  assert.equal(transferResult.status, 'TRANSFERRED');

  const parentDevices = await resolver.resolveParentDevices(familyId);
  assert.deepEqual(parentDevices, [{ deviceId: 'owner-dev-new', keyEpoch: 2 }]);
});

test('MySqlOwnerParentDeviceResolver resolves zero recipients for a family with no genesis/attestation at all -- never fabricated', async () => {
  const parentDevices = await resolver.resolveParentDevices(`fam-alert-unknown-${randomUUID()}`);
  assert.deepEqual(parentDevices, []);
});

test.after(async () => {
  await closePool();
});
