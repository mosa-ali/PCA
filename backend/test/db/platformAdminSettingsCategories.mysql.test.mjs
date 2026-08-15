// PCA-ADD-PA-043/044 (Writer65): real-MySQL tests for the remaining
// Platform Administration settings categories (branding, payment-provider,
// notification, maintenance, feature-flag) built on the new
// platform_admin_settings table (migration 0016). Covers: RBAC per
// category (sensitive vs non-sensitive gate), the PA-044 write-only/masked
// rule for PAYMENT_PROVIDER (never a raw value on any read path, even
// though it is genuinely persisted), key validation, and an HTTP
// round-trip through the real route module.
if (!process.env.PLATFORM_ADMIN_MFA_ENC_KEY) process.env.PLATFORM_ADMIN_MFA_ENC_KEY = 'ab'.repeat(32);

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import Fastify from 'fastify';
import { closePool, getPool } from '../../dist/db/pool.js';
import { MySqlPlatformAdminSettingsRepository } from '../../dist/platformadmin/settings/PlatformAdminSettingsRepository.js';
import { PlatformAdminSettingsService, PlatformAdminSettingsError } from '../../dist/platformadmin/settings/PlatformAdminSettingsService.js';
import { registerPlatformAdminSettingsRoutes } from '../../dist/http/routes/platformadmin/settingsRoutes.js';
import { createRateLimiter } from '../../dist/http/rateLimit.js';
import { MySqlEntitlementRepository } from '../../dist/entitlements/MySqlEntitlementRepository.js';
import { MySqlChangeRequestRepository } from '../../dist/entitlements/requests/MySqlChangeRequestRepository.js';
import { EntitlementService } from '../../dist/entitlements/EntitlementService.js';
import { ChangeRequestService } from '../../dist/entitlements/requests/ChangeRequestService.js';
import { NoPriceBookQuotePort } from '../../dist/entitlements/quote/QuotePort.js';
import { CommercialNotificationRepository } from '../../dist/commercialnotifications/CommercialNotificationRepository.js';
import { MySqlCommercialNotificationPublisher } from '../../dist/commercialnotifications/CommercialNotificationPublisher.js';
import { MySqlSlotReservationRepository } from '../../dist/entitlements/slots/MySqlSlotReservationRepository.js';
import { SlotReservationService } from '../../dist/entitlements/slots/SlotReservationService.js';
import { PlatformAdminEntitlementService } from '../../dist/platformadmin/entitlements/PlatformAdminEntitlementService.js';
import { PlatformAdminAuthService } from '../../dist/platformadmin/auth/PlatformAdminAuthService.js';
import { PlatformAdminAccountService } from '../../dist/platformadmin/auth/PlatformAdminAccountService.js';
import { MySqlPlatformAdminAuthRepository } from '../../dist/platformadmin/auth/MySqlAuthRepository.js';
import { hashAdminEmail } from '../../dist/platformadmin/auth/emailHash.js';
import { computeTotp, encryptTotpSecret, generateTotpSecret, loadMfaEncryptionKey } from '../../dist/platformadmin/auth/totp.js';
import { LoggingAlertAdapter } from '../../dist/platformadmin/auth/alertPort.js';

if (!process.env.PCA_DATABASE_URL) throw new Error('PCA_DATABASE_URL is required for backend/test/db tests.');

const authRepository = new MySqlPlatformAdminAuthRepository();
const accountService = new PlatformAdminAccountService(authRepository);
let clockOffsetMs = 0;
const clock = () => new Date(Date.now() + clockOffsetMs);
const authService = new PlatformAdminAuthService(authRepository, new LoggingAlertAdapter(), clock);

const settingsService = new PlatformAdminSettingsService(new MySqlPlatformAdminSettingsRepository());

const entitlementRepository = new MySqlEntitlementRepository();
const changeRequestRepository = new MySqlChangeRequestRepository();
const entitlementService = new EntitlementService(entitlementRepository, changeRequestRepository);
const quotePort = new NoPriceBookQuotePort();
const commercialNotificationPublisher = new MySqlCommercialNotificationPublisher(new CommercialNotificationRepository());
const changeRequestService = new ChangeRequestService(changeRequestRepository, entitlementRepository, entitlementService, quotePort, commercialNotificationPublisher);
const slotReservationRepository = new MySqlSlotReservationRepository(entitlementRepository);
const slotReservationService = new SlotReservationService(slotReservationRepository);
const adminEntitlementService = new PlatformAdminEntitlementService(authService, entitlementRepository, changeRequestRepository, entitlementService, changeRequestService, slotReservationService);

function uniqueEmail(label) {
  return `${label}-${randomUUID()}@example.test`;
}

async function createAdmin({ role = 'APP_OWNER' } = {}) {
  const email = uniqueEmail('admin');
  const password = 'correct horse battery staple';
  const account = await accountService.createAccount('DB Test Admin', hashAdminEmail(email), password, role, 'BOOTSTRAP');
  const secret = generateTotpSecret();
  const key = loadMfaEncryptionKey();
  const { ciphertext, nonce } = encryptTotpSecret(secret, key);
  await getPool().query(
    `UPDATE platform_admin_mfa_state SET status = 'ACTIVE', totp_secret_ciphertext = ?, totp_secret_nonce = ?, activated_at = NOW(3) WHERE admin_id = ?`,
    [ciphertext, nonce, account.adminId],
  );
  const code = computeTotp(secret, clock().getTime());
  const { rawToken } = await authService.login(email, password, code);
  const identity = await authService.validateSession(rawToken);
  return { adminId: account.adminId, roles: [role], sessionId: identity.sessionId, secret, rawToken };
}

function actorOf(admin) {
  return { adminId: admin.adminId, roles: admin.roles };
}

// ---------------------------------------------------------------------------
// Non-sensitive categories: BRANDING / NOTIFICATION / MAINTENANCE / FEATURE_FLAG
// ---------------------------------------------------------------------------

test('BRANDING: APP_OWNER and PLATFORM_ADMIN can write, value round-trips in plaintext (non-sensitive), and PLATFORM_ADMIN can also read it back', async () => {
  const owner = await createAdmin({ role: 'APP_OWNER' });
  const key = `branding.support_${randomUUID().replace(/-/g, '')}`;
  const value = { supportEmail: 'support@example.test', legalEntityName: 'PCA Test Entity Ltd' };
  const written = await settingsService.put(actorOf(owner), key, 'BRANDING', value, null);
  assert.deepEqual(written.value, value);
  assert.equal('maskedDisplay' in written, false);

  const platformAdmin = await createAdmin({ role: 'PLATFORM_ADMIN' });
  const read = await settingsService.get(actorOf(platformAdmin), key);
  assert.deepEqual(read.value, value);

  // PLATFORM_ADMIN can also mutate a non-sensitive category.
  const updated = await settingsService.put(actorOf(platformAdmin), key, 'BRANDING', { ...value, supportPhone: '+10000000' }, null);
  assert.equal(updated.value.supportPhone, '+10000000');
});

test('FEATURE_FLAG: listByCategory returns every flag under that category, and a SUPPORT_ADMIN can read (VIEW_SUPPORT_ACCOUNT_METADATA) but not write (ADMINISTER_NONSENSITIVE_PLATFORM_SETTINGS denies)', async () => {
  const owner = await createAdmin({ role: 'APP_OWNER' });
  const flagA = `feature_flag.billing_${randomUUID().replace(/-/g, '')}`;
  const flagB = `feature_flag.platformadmin_${randomUUID().replace(/-/g, '')}`;
  await settingsService.put(actorOf(owner), flagA, 'FEATURE_FLAG', true, null);
  await settingsService.put(actorOf(owner), flagB, 'FEATURE_FLAG', false, null);

  const supportAdmin = await createAdmin({ role: 'SUPPORT_ADMIN' });
  const listed = await settingsService.listByCategory(actorOf(supportAdmin), 'FEATURE_FLAG');
  const keys = listed.map((r) => r.settingKey);
  assert.ok(keys.includes(flagA));
  assert.ok(keys.includes(flagB));

  await assert.rejects(
    () => settingsService.put(actorOf(supportAdmin), flagA, 'FEATURE_FLAG', false, null),
    (err) => err instanceof PlatformAdminSettingsError && err.code === 'FORBIDDEN',
  );
});

test('MAINTENANCE: a real maintenance-mode toggle persists and round-trips exactly', async () => {
  const owner = await createAdmin({ role: 'APP_OWNER' });
  const key = 'maintenance.global';
  const enabled = await settingsService.put(actorOf(owner), key, 'MAINTENANCE', { enabled: true, message: 'Scheduled maintenance 02:00-04:00 UTC' }, null);
  assert.equal(enabled.value.enabled, true);
  const disabled = await settingsService.put(actorOf(owner), key, 'MAINTENANCE', { enabled: false, message: null }, null);
  assert.equal(disabled.value.enabled, false);
});

// ---------------------------------------------------------------------------
// PAYMENT_PROVIDER: the one sensitive category -- PA-044 write-only/masked
// ---------------------------------------------------------------------------

test('PAYMENT_PROVIDER: value is genuinely persisted but NEVER returned on any read path -- only maskedDisplay/updatedAt/updatedByAdminId', async () => {
  const owner = await createAdmin({ role: 'APP_OWNER' });
  const key = `payment_provider.${randomUUID().replace(/-/g, '')}`;
  const rawValue = { providerRef: `secretref:${randomUUID()}`, providerName: 'STRIPE_TEST' };

  const written = await settingsService.put(actorOf(owner), key, 'PAYMENT_PROVIDER', rawValue, '**** 4242');
  assert.equal(Object.prototype.hasOwnProperty.call(written, 'value'), false, 'PUT response must not echo the raw value back');
  assert.equal(written.maskedDisplay, '**** 4242');

  const supportAdmin = await createAdmin({ role: 'SUPPORT_ADMIN' });
  const read = await settingsService.get(actorOf(supportAdmin), key);
  assert.equal(Object.prototype.hasOwnProperty.call(read, 'value'), false);
  assert.equal(read.maskedDisplay, '**** 4242');

  const listed = await settingsService.listByCategory(actorOf(supportAdmin), 'PAYMENT_PROVIDER');
  const row = listed.find((r) => r.settingKey === key);
  assert.ok(row);
  assert.equal(Object.prototype.hasOwnProperty.call(row, 'value'), false);

  // The raw value IS genuinely persisted (never silently dropped) -- verified directly against the row, never via the masked service surface.
  const [rows] = await getPool().query(`SELECT value_json FROM platform_admin_settings WHERE setting_key = ?`, [key]);
  assert.deepEqual(JSON.parse(rows[0].value_json), rawValue);
});

test('PAYMENT_PROVIDER: requires maskedDisplay on write (PA-044 -- an admin must supply the masked label, never derived from the secret)', async () => {
  const owner = await createAdmin({ role: 'APP_OWNER' });
  const key = `payment_provider.${randomUUID().replace(/-/g, '')}`;
  await assert.rejects(
    () => settingsService.put(actorOf(owner), key, 'PAYMENT_PROVIDER', { providerRef: 'x' }, null),
    (err) => err instanceof PlatformAdminSettingsError && err.code === 'INVALID_INPUT',
  );
});

test('RBAC: PAYMENT_PROVIDER mutation is APP_OWNER-only -- PLATFORM_ADMIN (who CAN mutate BRANDING) is denied here', async () => {
  const platformAdmin = await createAdmin({ role: 'PLATFORM_ADMIN' });
  const key = `payment_provider.${randomUUID().replace(/-/g, '')}`;
  await assert.rejects(
    () => settingsService.put(actorOf(platformAdmin), key, 'PAYMENT_PROVIDER', { providerRef: 'x' }, '**** 0000'),
    (err) => err instanceof PlatformAdminSettingsError && err.code === 'FORBIDDEN',
  );
});

test('a non-sensitive category rejects a caller-supplied maskedDisplay (nothing to mask)', async () => {
  const owner = await createAdmin({ role: 'APP_OWNER' });
  const key = `branding.reject_masked_${randomUUID().replace(/-/g, '')}`;
  await assert.rejects(
    () => settingsService.put(actorOf(owner), key, 'BRANDING', { supportEmail: 'x@example.test' }, '**** 1234'),
    (err) => err instanceof PlatformAdminSettingsError && err.code === 'INVALID_INPUT',
  );
});

// ---------------------------------------------------------------------------
// HTTP round-trip
// ---------------------------------------------------------------------------

test('HTTP: PUT then GET a BRANDING key and a PAYMENT_PROVIDER key through the real route module -- the payment-provider GET never leaks the raw value over the wire', async () => {
  const owner = await createAdmin({ role: 'APP_OWNER' });
  const app = Fastify({ logger: false });
  registerPlatformAdminSettingsRoutes(app, {
    platformAdminAuthService: authService,
    platformAdminEntitlementService: adminEntitlementService,
    entitlementRepository,
    rateLimiter: createRateLimiter(),
  });
  await app.ready();
  try {
    const brandingKey = `branding.http_${randomUUID().replace(/-/g, '')}`;
    const putBranding = await app.inject({
      method: 'PUT',
      url: `/platform-admin/settings/key/${brandingKey}`,
      headers: { authorization: `Bearer ${owner.rawToken}` },
      payload: { category: 'BRANDING', value: { supportEmail: 'ops@example.test' } },
    });
    assert.equal(putBranding.statusCode, 200);
    assert.deepEqual(putBranding.json().value, { supportEmail: 'ops@example.test' });

    const getBranding = await app.inject({ method: 'GET', url: `/platform-admin/settings/key/${brandingKey}`, headers: { authorization: `Bearer ${owner.rawToken}` } });
    assert.equal(getBranding.statusCode, 200);
    assert.deepEqual(getBranding.json().value, { supportEmail: 'ops@example.test' });

    const providerKey = `payment_provider.http_${randomUUID().replace(/-/g, '')}`;
    const putProvider = await app.inject({
      method: 'PUT',
      url: `/platform-admin/settings/key/${providerKey}`,
      headers: { authorization: `Bearer ${owner.rawToken}` },
      payload: { category: 'PAYMENT_PROVIDER', value: { providerRef: `secretref:${randomUUID()}` }, maskedDisplay: '**** 9999' },
    });
    assert.equal(putProvider.statusCode, 200);
    const putBody = putProvider.json();
    assert.equal(Object.prototype.hasOwnProperty.call(putBody, 'value'), false);
    assert.equal(putBody.maskedDisplay, '**** 9999');

    const getProvider = await app.inject({ method: 'GET', url: `/platform-admin/settings/key/${providerKey}`, headers: { authorization: `Bearer ${owner.rawToken}` } });
    assert.equal(getProvider.statusCode, 200);
    const getBody = getProvider.json();
    assert.equal(Object.prototype.hasOwnProperty.call(getBody, 'value'), false);
    assert.equal(getBody.maskedDisplay, '**** 9999');

    const listProvider = await app.inject({ method: 'GET', url: `/platform-admin/settings/category/PAYMENT_PROVIDER`, headers: { authorization: `Bearer ${owner.rawToken}` } });
    assert.equal(listProvider.statusCode, 200);
    for (const item of listProvider.json().items) {
      assert.equal(Object.prototype.hasOwnProperty.call(item, 'value'), false);
    }
  } finally {
    await app.close();
  }
});

test('HTTP: an invalid category returns 400, and an unknown key returns 404', async () => {
  const owner = await createAdmin({ role: 'APP_OWNER' });
  const app = Fastify({ logger: false });
  registerPlatformAdminSettingsRoutes(app, {
    platformAdminAuthService: authService,
    platformAdminEntitlementService: adminEntitlementService,
    entitlementRepository,
    rateLimiter: createRateLimiter(),
  });
  await app.ready();
  try {
    const badCategory = await app.inject({ method: 'GET', url: '/platform-admin/settings/category/NOT_A_REAL_CATEGORY', headers: { authorization: `Bearer ${owner.rawToken}` } });
    assert.equal(badCategory.statusCode, 400);

    const missingKey = await app.inject({ method: 'GET', url: `/platform-admin/settings/key/branding.does_not_exist_${randomUUID().replace(/-/g, '')}`, headers: { authorization: `Bearer ${owner.rawToken}` } });
    assert.equal(missingKey.statusCode, 404);
  } finally {
    await app.close();
  }
});

test.after(async () => {
  await closePool();
});
