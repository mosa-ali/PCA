// Real MySQL HTTP smoke test: the family-facing commercial-notification
// routes (list, unread-count, read, acknowledge) end to end through a real
// Fastify instance wired with registerCommercialNotificationRoutes and real
// MySQL-backed AuthService/AuthzService/PlatformAdminAuthService, mirroring
// test/db/http.mysql.test.mjs's session/scope helper pattern. Builds a bare
// Fastify app directly (not the full buildServer composition) so this test
// depends only on this lane's own route module, never on other domains'
// wiring shape.
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { randomBytes, randomUUID } from 'node:crypto';
import test from 'node:test';
import { registerCommercialNotificationRoutes } from '../../dist/http/routes/commercialNotificationRoutes.js';
import { registerParentAccountRoutes } from '../../dist/http/routes/parentAccountRoutes.js';
import { createRateLimiter } from '../../dist/http/rateLimit.js';
import { AuthService } from '../../dist/auth/AuthService.js';
import { MySqlAuthRepository } from '../../dist/auth/MySqlAuthRepository.js';
import { ParentAccountService } from '../../dist/parentaccount/ParentAccountService.js';
import { MySqlParentAccountRepository } from '../../dist/parentaccount/MySqlParentAccountRepository.js';
import { AuthzService } from '../../dist/authz/AuthzService.js';
import { MySqlAuthzRepository } from '../../dist/authz/MySqlAuthzRepository.js';
import { PlatformAdminAuthService } from '../../dist/platformadmin/auth/PlatformAdminAuthService.js';
import { MySqlPlatformAdminAuthRepository } from '../../dist/platformadmin/auth/MySqlAuthRepository.js';
import { closePool, getPool } from '../../dist/db/pool.js';
import { CommercialNotificationRepository } from '../../dist/commercialnotifications/CommercialNotificationRepository.js';
import { CommercialNotificationService, CommercialNotificationSupportService } from '../../dist/commercialnotifications/CommercialNotificationService.js';
import { MySqlCommercialNotificationPublisher, DEFAULT_MESSAGE_KEYS } from '../../dist/commercialnotifications/CommercialNotificationPublisher.js';

if (!process.env.PCA_DATABASE_URL) throw new Error('PCA_DATABASE_URL is required for backend/test/db tests.');

const authRepository = new MySqlAuthRepository();
const authService = new AuthService(authRepository);
const authzRepository = new MySqlAuthzRepository();
const authzService = new AuthzService(authzRepository);
const platformAdminAuthService = new PlatformAdminAuthService(new MySqlPlatformAdminAuthRepository());
const commercialNotificationRepository = new CommercialNotificationRepository();
const commercialNotificationService = new CommercialNotificationService(commercialNotificationRepository);
const commercialNotificationSupportService = new CommercialNotificationSupportService(commercialNotificationRepository);
const publisher = new MySqlCommercialNotificationPublisher(commercialNotificationRepository);

class RecordingEmailSender {
  codes = new Map();

  async sendVerificationCode(email, code) {
    this.codes.set(email, code);
  }

  codeFor(email) {
    return this.codes.get(email);
  }
}

const parentEmailSender = new RecordingEmailSender();
const parentAccountService = new ParentAccountService({
  repository: new MySqlParentAccountRepository(),
  authService,
  emailSender: parentEmailSender,
});

function server() {
  const app = Fastify({ logger: false });
  const rateLimiter = createRateLimiter();
  registerCommercialNotificationRoutes(app, {
    commercialNotificationService,
    commercialNotificationSupportService,
    authService,
    authzService,
    platformAdminAuthService,
    rateLimiter,
    authAttemptLimiter: rateLimiter({ windowMs: 60_000, max: 60, bucket: 'auth-attempt' }),
  });
  registerParentAccountRoutes(app, { parentAccountService });
  return app;
}

function family() {
  return `family-${randomUUID()}`;
}

async function createAccountWithSession() {
  const { rawToken, session } = await authService.issueSession({ accountReferenceHash: randomBytes(32) });
  return { rawToken, accountId: session.accountId };
}

async function grantScope(accountId, familyId, status = 'ACTIVE') {
  await getPool().query(
    `INSERT INTO service_account_family_scopes (account_id, family_id, status, created_at) VALUES (?, ?, ?, NOW(3))`,
    [accountId, familyId, status],
  );
}

test('MySQL HTTP: family-facing commercial-notification list/unread-count/read/acknowledge round-trip end to end through the real server', async () => {
  const { rawToken, accountId } = await createAccountWithSession();
  const familyId = randomUUID();
  await grantScope(accountId, familyId);

  const published = await publisher.publish({
    accountRef: familyId,
    eventType: 'QUOTE_READY',
    dedupeKey: `QUOTE_READY:${randomUUID()}`,
    resourceRef: null,
    messageKey: DEFAULT_MESSAGE_KEYS.QUOTE_READY,
    params: { deviceLimit: 5 },
  });

  const app = server();
  try {
    const unreadBefore = await app.inject({
      method: 'GET',
      url: `/v1/families/${familyId}/commercial-notifications/unread-count`,
      headers: { authorization: `Bearer ${rawToken}` },
    });
    assert.equal(unreadBefore.statusCode, 200);
    assert.equal(unreadBefore.json().unreadCount, 1);

    const list = await app.inject({
      method: 'GET',
      url: `/v1/families/${familyId}/commercial-notifications`,
      headers: { authorization: `Bearer ${rawToken}` },
    });
    assert.equal(list.statusCode, 200);
    const notifications = list.json().notifications;
    assert.equal(notifications.length, 1);
    assert.equal(notifications[0].notificationId, published.notification.notificationId);
    assert.equal(notifications[0].eventType, 'QUOTE_READY');
    assert.equal(notifications[0].messageKey, DEFAULT_MESSAGE_KEYS.QUOTE_READY);
    assert.deepEqual(notifications[0].params, { deviceLimit: 5 });

    const markRead = await app.inject({
      method: 'POST',
      url: `/v1/families/${familyId}/commercial-notifications/${published.notification.notificationId}/read`,
      headers: { authorization: `Bearer ${rawToken}` },
    });
    assert.equal(markRead.statusCode, 200);

    const unreadAfter = await app.inject({
      method: 'GET',
      url: `/v1/families/${familyId}/commercial-notifications/unread-count`,
      headers: { authorization: `Bearer ${rawToken}` },
    });
    assert.equal(unreadAfter.json().unreadCount, 0);

    const acknowledge = await app.inject({
      method: 'POST',
      url: `/v1/families/${familyId}/commercial-notifications/${published.notification.notificationId}/acknowledge`,
      headers: { authorization: `Bearer ${rawToken}` },
    });
    assert.equal(acknowledge.statusCode, 200);
  } finally {
    await app.close();
  }
});

test('MySQL HTTP: an account with NO family scope for this family gets 403, never sees the notification', async () => {
  const { rawToken } = await createAccountWithSession();
  const familyId = family();
  await publisher.publish({
    accountRef: familyId,
    eventType: 'PAYMENT_FAILED',
    dedupeKey: `PAYMENT_FAILED:${randomUUID()}`,
    resourceRef: null,
    messageKey: DEFAULT_MESSAGE_KEYS.PAYMENT_FAILED,
    params: null,
  });

  const app = server();
  try {
    const response = await app.inject({
      method: 'GET',
      url: `/v1/families/${familyId}/commercial-notifications`,
      headers: { authorization: `Bearer ${rawToken}` },
    });
    assert.equal(response.statusCode, 403);
  } finally {
    await app.close();
  }
});

test('MySQL HTTP: the real parent session cookie reaches /api/parent/session and family notifications, with CSRF required for acknowledgement', async () => {
  const email = `cookie-notify-${randomUUID()}@example.test`;
  const password = 'a genuinely long password';
  await parentAccountService.register(email, password, password);
  const verificationCode = parentEmailSender.codeFor(email);
  assert.equal(typeof verificationCode, 'string');
  const verified = await parentAccountService.verifyEmail(email, verificationCode);
  const serviceAccountId = await authService.validateSession(verified.rawSessionToken);
  const familyId = randomUUID();
  await getPool().query(`UPDATE parent_accounts SET family_id = ? WHERE account_id = ?`, [familyId, verified.accountId]);
  await grantScope(serviceAccountId, familyId);
  const published = await publisher.publish({
    accountRef: familyId,
    eventType: 'PAYMENT_FAILED',
    dedupeKey: `PAYMENT_FAILED:${randomUUID()}`,
    resourceRef: null,
    messageKey: DEFAULT_MESSAGE_KEYS.PAYMENT_FAILED,
    params: null,
  });
  const csrfToken = randomBytes(32).toString('base64url');
  const cookie = `pca_family_session=${encodeURIComponent(verified.rawSessionToken)}; pca_family_csrf=${encodeURIComponent(csrfToken)}`;
  const app = server();
  try {
    const session = await app.inject({ method: 'GET', url: '/api/parent/session', headers: { cookie } });
    assert.equal(session.statusCode, 200);
    assert.equal(session.json().familyId, familyId);

    const list = await app.inject({
      method: 'GET',
      url: `/v1/families/${familyId}/commercial-notifications`,
      headers: { cookie },
    });
    assert.equal(list.statusCode, 200);
    assert.equal(list.json().notifications[0].notificationId, published.notification.notificationId);

    const missingCsrf = await app.inject({
      method: 'POST',
      url: `/v1/families/${familyId}/commercial-notifications/${published.notification.notificationId}/acknowledge`,
      headers: { cookie },
    });
    assert.equal(missingCsrf.statusCode, 403);

    const acknowledge = await app.inject({
      method: 'POST',
      url: `/v1/families/${familyId}/commercial-notifications/${published.notification.notificationId}/acknowledge`,
      headers: { cookie, 'x-pca-csrf-token': csrfToken },
    });
    assert.equal(acknowledge.statusCode, 200);
  } finally {
    await app.close();
  }
});

test('MySQL HTTP: marking a nonexistent notification id read is a 404, not a 500', async () => {
  const { rawToken, accountId } = await createAccountWithSession();
  const familyId = family();
  await grantScope(accountId, familyId);

  const app = server();
  try {
    const response = await app.inject({
      method: 'POST',
      url: `/v1/families/${familyId}/commercial-notifications/${randomUUID()}/read`,
      headers: { authorization: `Bearer ${rawToken}` },
    });
    assert.equal(response.statusCode, 404);
  } finally {
    await app.close();
  }
});

test('MySQL HTTP: an unauthenticated request is rejected before ever reaching CommercialNotificationService', async () => {
  const familyId = family();
  const app = server();
  try {
    const response = await app.inject({ method: 'GET', url: `/v1/families/${familyId}/commercial-notifications` });
    assert.equal(response.statusCode, 401);
  } finally {
    await app.close();
  }
});

test.after(async () => {
  await closePool();
});
