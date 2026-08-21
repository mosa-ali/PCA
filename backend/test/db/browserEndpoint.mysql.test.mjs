// PCA-FR-063: real-MySQL proof that a BROWSER-platform device registers,
// persists, and self-approval-denies exactly as the in-memory/unit tests
// predict -- including the widened devices.platform CHECK constraint and
// the registered_by_account_id FK (migration 0026).
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import test from 'node:test';
import { BrowserEndpointService, BrowserEndpointError } from '../../dist/device/BrowserEndpointService.js';
import { PairingService } from '../../dist/pairing/PairingService.js';
import { MySqlDeviceRepository } from '../../dist/device/MySqlDeviceRepository.js';
import { closePool, getPool } from '../../dist/db/pool.js';

if (!process.env.PCA_DATABASE_URL) throw new Error('PCA_DATABASE_URL is required for backend/test/db tests.');

const repository = new MySqlDeviceRepository();
const browserEndpointService = new BrowserEndpointService(repository, () => new Date());
const pairingService = new PairingService(repository, () => new Date());

function key() {
  return randomBytes(32).toString('base64url');
}

function family() {
  return `family-${randomUUID()}`;
}

async function createAccount() {
  const accountId = randomUUID();
  await getPool().query(
    `INSERT INTO service_accounts (account_id, account_reference_hash, created_at, disabled_at) VALUES (?, ?, NOW(3), NULL)`,
    [accountId, Buffer.from(randomUUID())],
  );
  return accountId;
}

test('MySQL: registering a BROWSER endpoint persists platform=BROWSER, status=PAIRING_PENDING, a single DSK, and registered_by_account_id', async () => {
  const familyId = family();
  const registeredBy = await createAccount();
  const result = await browserEndpointService.registerEndpoint(familyId, registeredBy, key());

  const [rows] = await getPool().query(`SELECT * FROM devices WHERE device_id = ?`, [result.deviceId]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].platform, 'BROWSER');
  assert.equal(rows[0].status, 'PAIRING_PENDING');
  assert.equal(rows[0].registered_by_account_id, registeredBy);
  assert.equal(rows[0].paired_by_account_id, null);

  const [keyRows] = await getPool().query(`SELECT * FROM device_public_keys WHERE device_id = ?`, [result.deviceId]);
  assert.equal(keyRows.length, 1);
  assert.equal(keyRows[0].key_purpose, 'DSK');
  assert.equal(keyRows[0].status, 'ACTIVE');
});

test('MySQL: the devices_platform_check CHECK constraint accepts BROWSER and still rejects an unlisted platform', async () => {
  const familyId = family();
  const deviceId = randomUUID();
  await assert.doesNotReject(() =>
    getPool().query(
      `INSERT INTO devices (device_id, family_id, platform, status, created_at) VALUES (?, ?, 'BROWSER', 'PAIRING_PENDING', NOW(3))`,
      [deviceId, familyId],
    ),
  );
  await assert.rejects(() =>
    getPool().query(
      `INSERT INTO devices (device_id, family_id, platform, status, created_at) VALUES (?, ?, 'DESKTOP', 'PAIRING_PENDING', NOW(3))`,
      [randomUUID(), familyId],
    ),
  );
});

test('MySQL: registered_by_account_id must reference a real service_accounts row (FK)', async () => {
  const familyId = family();
  await assert.rejects(() =>
    getPool().query(
      `INSERT INTO devices (device_id, family_id, platform, status, created_at, registered_by_account_id) VALUES (?, ?, 'BROWSER', 'PAIRING_PENDING', NOW(3), ?)`,
      [randomUUID(), familyId, randomUUID()],
    ),
  );
});

test('MySQL end-to-end: the registering account is denied confirming its own endpoint; a different account succeeds', async () => {
  const familyId = family();
  const registeredBy = await createAccount();
  const confirmedBy = await createAccount();
  const { deviceId } = await browserEndpointService.registerEndpoint(familyId, registeredBy, key());

  await assert.rejects(
    () => pairingService.confirmPairing(familyId, deviceId, registeredBy),
    { code: 'SELF_APPROVAL_DENIED' },
  );
  const [stillPending] = await getPool().query(`SELECT status FROM devices WHERE device_id = ?`, [deviceId]);
  assert.equal(stillPending[0].status, 'PAIRING_PENDING');

  const view = await pairingService.confirmPairing(familyId, deviceId, confirmedBy);
  assert.equal(view.status, 'PAIRED');
});

test('MySQL: registering the same public key twice is rejected, never creating a duplicate device', async () => {
  const familyId = family();
  const registeredBy = await createAccount();
  const sharedKey = key();
  await browserEndpointService.registerEndpoint(familyId, registeredBy, sharedKey);
  await assert.rejects(
    () => browserEndpointService.registerEndpoint(familyId, registeredBy, sharedKey),
    { code: 'DUPLICATE_KEY' },
  );
  const [rows] = await getPool().query(`SELECT COUNT(*) AS n FROM device_public_keys WHERE public_key = ?`, [sharedKey]);
  assert.equal(Number(rows[0].n), 1);
});

test.after(async () => {
  await closePool();
});
