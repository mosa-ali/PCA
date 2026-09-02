// PCA-COMMERCIAL-RUNTIME-1: real MySQL tests for CommercialMaintenanceRunner
// -- boundary/clock-edge quote expiry, exactly-once QUOTE_EXPIRED
// notification under concurrent runner instances, restart-safety after a
// simulated crash mid-batch, multi-instance retention-pruning safety,
// unattributed-quote skip behavior, and a privacy check that warning logs
// never carry notification message content.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { closePool, getPool, runInTransaction } from '../../dist/db/pool.js';
import { QuoteRepository } from '../../dist/billing/quote.js';
import { PlatformAdminAccountService } from '../../dist/platformadmin/auth/PlatformAdminAccountService.js';
import { MySqlPlatformAdminAuthRepository } from '../../dist/platformadmin/auth/MySqlAuthRepository.js';
import { hashAdminEmail } from '../../dist/platformadmin/auth/emailHash.js';
import { MySqlChangeRequestRepository } from '../../dist/entitlements/requests/MySqlChangeRequestRepository.js';
import { CommercialNotificationRepository } from '../../dist/commercialnotifications/CommercialNotificationRepository.js';
import { MySqlCommercialNotificationPublisher } from '../../dist/commercialnotifications/CommercialNotificationPublisher.js';
import { MySqlCommercialMaintenanceRunner } from '../../dist/commercialmaintenance/CommercialMaintenanceRunner.js';
import { COMMERCIAL_MAINTENANCE_CONFIG_DEFAULTS } from '../../dist/commercialmaintenance/config.js';
import { SubscriptionRepository } from '../../dist/billing/subscription.js';

if (!process.env.PCA_DATABASE_URL) throw new Error('PCA_DATABASE_URL is required for backend/test/db tests.');

function uniqueEmail(label) {
  return `${label}-${randomUUID()}@example.test`;
}

async function createAdmin(role = 'FINANCE_ADMIN') {
  const accountService = new PlatformAdminAccountService(new MySqlPlatformAdminAuthRepository());
  const account = await accountService.createAccount('DB Test Admin', hashAdminEmail(uniqueEmail('admin')), 'password-value', role, 'BOOTSTRAP');
  return account.adminId;
}

function buildQuoteService() {
  const quoteRepository = new QuoteRepository();
  return { quoteRepository };
}

/** Directly inserts a `billing_quotes` row bypassing QuoteService's
 * >now-only validation, so tests can create ALREADY-past-expiry rows to
 * exercise the runner without waiting in real time. */
async function insertQuoteAt(quoteRepository, { increaseRequestRef, expiresAt, adminId, targetDeviceLimit = 5 }) {
  const quoteId = randomUUID();
  return runInTransaction((conn) =>
    quoteRepository.insert(
      conn,
      quoteId,
      {
        increaseRequestRef,
        commercialMarket: 'YEMEN',
        targetDeviceLimit,
        amountMinor: 1234n,
        currencyCode: 'YER',
        expiresAt,
      },
      adminId,
      new Date(Date.now() - 60_000),
    ),
  );
}

async function createChangeRequestForFamily(changeRequestRepository, familyId) {
  const requestId = randomUUID();
  await runInTransaction((conn) =>
    changeRequestRepository.create(conn, {
      requestId,
      familyId,
      limitType: 'MANAGED_DEVICE_LIMIT',
      currentLimitAtRequest: 0,
      targetLimit: 5,
      now: new Date(),
    }),
  );
  return requestId;
}

function buildRunner(overrides = {}) {
  const { quoteRepository } = overrides.quoteService ?? buildQuoteService();
  const changeRequestRepository = overrides.changeRequestRepository ?? new MySqlChangeRequestRepository();
  const notificationRepository = overrides.notificationRepository ?? new CommercialNotificationRepository();
  const notificationPublisher = overrides.notificationPublisher ?? new MySqlCommercialNotificationPublisher(notificationRepository);
  const config = overrides.config ?? COMMERCIAL_MAINTENANCE_CONFIG_DEFAULTS;
  const now = overrides.now ?? (() => new Date());
  const logger = overrides.logger ?? { warn: () => {} };
  return new MySqlCommercialMaintenanceRunner(quoteRepository, changeRequestRepository, notificationPublisher, notificationRepository, config, now, logger);
}

async function countNotificationRows(dedupeKey) {
  const [rows] = await getPool().query(`SELECT COUNT(*) AS n FROM commercial_notifications WHERE dedupe_key = ?`, [dedupeKey]);
  return Number(rows[0].n);
}

async function readQuoteStatus(quoteId) {
  const [rows] = await getPool().query(`SELECT status FROM billing_quotes WHERE quote_id = ?`, [quoteId]);
  return rows[0]?.status ?? null;
}

/** Fixture: billing_subscriptions.plan_id is a real FOREIGN KEY into
 * billing_plans (migration 0007) -- unlike quotes' opaque
 * increase_request_ref, a subscription test row needs an actual plan row to
 * satisfy the constraint. */
async function createPlan() {
  const planId = randomUUID();
  const planCode = `RENEWAL_TEST_PLAN_${randomUUID().slice(0, 8)}`;
  await getPool().query(
    `INSERT INTO billing_plans
       (plan_id, plan_code, plan_version, status, billing_cadence, default_parent_member_limit, default_managed_device_limit)
     VALUES (?, ?, 1, 'ACTIVE', 'MONTHLY', 2, 5)`,
    [planId, planCode],
  );
  return planId;
}

/** Directly inserts a `billing_subscriptions` row via the repository's
 * `create`, bypassing SubscriptionService's RBAC gate (mirroring
 * insertQuoteAt's bypass of QuoteService's own validation above), so tests
 * can freely set `status` and `currentPeriodEnd` to exercise the
 * upcoming-renewal sweep without waiting in real time. */
async function insertSubscriptionAt(subscriptionRepository, { accountRef, planId, status = 'ACTIVE', currentPeriodStart, currentPeriodEnd }) {
  return runInTransaction((conn) =>
    subscriptionRepository.create(
      conn,
      { accountRef, planId, status, currentPeriodStart, currentPeriodEnd, paymentMethodId: null },
      new Date(Date.now() - 60_000),
    ),
  );
}

async function readNotificationRow(dedupeKey) {
  const [rows] = await getPool().query(`SELECT account_ref, event_type, resource_ref FROM commercial_notifications WHERE dedupe_key = ?`, [dedupeKey]);
  return rows[0] ?? null;
}

test('MySQL BOUNDARY: a quote whose expiresAt has just passed is expired; one whose expiresAt has not yet passed is untouched', async () => {
  const adminId = await createAdmin();
  const { quoteRepository } = buildQuoteService();
  const changeRequestRepository = new MySqlChangeRequestRepository();
  const familyId = `family_${randomUUID()}`;
  const requestId = await createChangeRequestForFamily(changeRequestRepository, familyId);

  const now = new Date();
  const juststPassed = await insertQuoteAt(quoteRepository, { increaseRequestRef: requestId, expiresAt: new Date(now.getTime() - 1), adminId });
  const justNotPassed = await insertQuoteAt(quoteRepository, { increaseRequestRef: requestId, expiresAt: new Date(now.getTime() + 60_000), adminId });
  const exactlyNow = await insertQuoteAt(quoteRepository, { increaseRequestRef: requestId, expiresAt: now, adminId });

  const runner = buildRunner({ quoteService: { quoteRepository }, changeRequestRepository, now: () => now });
  const result = await runner.runOnce();

  assert.equal(await readQuoteStatus(juststPassed.quoteId), 'EXPIRED', 'a quote 1ms past expiry must be expired');
  assert.equal(await readQuoteStatus(exactlyNow.quoteId), 'EXPIRED', 'a quote expiring EXACTLY at `now` (<=) must be expired');
  assert.equal(await readQuoteStatus(justNotPassed.quoteId), 'ACTIVE', 'a quote expiring 60s in the future must remain ACTIVE');
  assert.ok(result.quotesExpired >= 2, 'at least the two due quotes must be counted as expired');
  assert.ok(result.notificationsPublished >= 2, 'at least the two due quotes must be notified');

  assert.equal(await countNotificationRows(`QUOTE_EXPIRED:${juststPassed.quoteId}`), 1);
  assert.equal(await countNotificationRows(`QUOTE_EXPIRED:${exactlyNow.quoteId}`), 1);
  assert.equal(await countNotificationRows(`QUOTE_EXPIRED:${justNotPassed.quoteId}`), 0, 'a still-ACTIVE quote must never be notified');

  const [notifRows] = await getPool().query(`SELECT account_ref, event_type FROM commercial_notifications WHERE dedupe_key = ?`, [`QUOTE_EXPIRED:${juststPassed.quoteId}`]);
  assert.equal(notifRows[0].account_ref, familyId);
  assert.equal(notifRows[0].event_type, 'QUOTE_EXPIRED');
});

test('MySQL CONCURRENCY: multiple simulated runner instances racing the SAME due quotes -- exactly one QUOTE_EXPIRED notification per quote, no duplicates', async () => {
  const adminId = await createAdmin();
  const { quoteRepository } = buildQuoteService();
  const changeRequestRepository = new MySqlChangeRequestRepository();
  const familyId = `family_${randomUUID()}`;
  const requestId = await createChangeRequestForFamily(changeRequestRepository, familyId);

  const now = new Date();
  const quotes = [];
  for (let i = 0; i < 5; i++) {
    quotes.push(await insertQuoteAt(quoteRepository, { increaseRequestRef: requestId, expiresAt: new Date(now.getTime() - 1000 - i), adminId }));
  }

  // Four independent runner instances (their own repository/publisher
  // instances, exactly as separate processes would be) racing runOnce()
  // concurrently against the SAME due quotes.
  const runners = Array.from({ length: 4 }, () => buildRunner({ quoteService: { quoteRepository }, changeRequestRepository, now: () => now }));
  const results = await Promise.all(runners.map((r) => r.runOnce()));

  const totalPublished = results.reduce((sum, r) => sum + r.notificationsPublished, 0);
  assert.equal(totalPublished, quotes.length, 'across all racing instances, the total PUBLISHED count must equal exactly one per quote');

  for (const quote of quotes) {
    assert.equal(await readQuoteStatus(quote.quoteId), 'EXPIRED');
    assert.equal(await countNotificationRows(`QUOTE_EXPIRED:${quote.quoteId}`), 1, `quote ${quote.quoteId} must have exactly one notification row`);
  }
});

test('MySQL RESTART SAFETY: a quote transitioned to EXPIRED but never notified (simulated crash between transition and publish) is picked up -- exactly once -- by the NEXT runOnce(), never duplicated', async () => {
  const adminId = await createAdmin();
  const { quoteRepository } = buildQuoteService();
  const changeRequestRepository = new MySqlChangeRequestRepository();
  const familyId = `family_${randomUUID()}`;
  const requestId = await createChangeRequestForFamily(changeRequestRepository, familyId);

  const now = new Date();
  const quote = await insertQuoteAt(quoteRepository, { increaseRequestRef: requestId, expiresAt: new Date(now.getTime() - 1), adminId });

  // Simulate "the process crashed right after the transition committed, but
  // before any notification was published" by calling the exact same
  // primitive the runner uses for that step, directly, with no publish step.
  const transitioned = await runInTransaction((conn) => quoteRepository.expireDueQuotes(conn, now));
  assert.ok(transitioned >= 1);
  assert.equal(await readQuoteStatus(quote.quoteId), 'EXPIRED');
  assert.equal(await countNotificationRows(`QUOTE_EXPIRED:${quote.quoteId}`), 0, 'precondition: no notification yet, mimicking the crash gap');

  const runner = buildRunner({ quoteService: { quoteRepository }, changeRequestRepository, now: () => now });
  const first = await runner.runOnce();
  assert.equal(first.quotesExpired, 0, 'the quote was already EXPIRED before this call -- expireDueQuotes must not re-count it');
  assert.ok(first.notificationsPublished >= 1, 'the backlog scan must publish the missed notification on the very next run');
  assert.equal(await countNotificationRows(`QUOTE_EXPIRED:${quote.quoteId}`), 1);

  // A THIRD runOnce() (simulating the runner continuing to run on its normal
  // interval after recovery) must not produce a duplicate.
  const second = await runner.runOnce();
  assert.equal(second.notificationsPublished, 0, 'no duplicate work once already recovered');
  assert.equal(await countNotificationRows(`QUOTE_EXPIRED:${quote.quoteId}`), 1);
});

test('MySQL: a quote with no increase_request_ref (unattributable) is expired but never notified, and never crashes the batch', async () => {
  const adminId = await createAdmin();
  const { quoteRepository } = buildQuoteService();
  const changeRequestRepository = new MySqlChangeRequestRepository();
  const familyId = `family_${randomUUID()}`;
  const requestId = await createChangeRequestForFamily(changeRequestRepository, familyId);

  const now = new Date();
  const orphan = await insertQuoteAt(quoteRepository, { increaseRequestRef: null, expiresAt: new Date(now.getTime() - 1), adminId });
  const attributed = await insertQuoteAt(quoteRepository, { increaseRequestRef: requestId, expiresAt: new Date(now.getTime() - 1), adminId });

  const warnings = [];
  const runner = buildRunner({
    quoteService: { quoteRepository },
    changeRequestRepository,
    now: () => now,
    logger: { warn: (event, detail) => warnings.push({ event, detail }) },
  });
  const result = await runner.runOnce();

  assert.equal(await readQuoteStatus(orphan.quoteId), 'EXPIRED');
  assert.equal(await readQuoteStatus(attributed.quoteId), 'EXPIRED');
  assert.equal(await countNotificationRows(`QUOTE_EXPIRED:${orphan.quoteId}`), 0, 'an unattributable quote must never be notified');
  assert.equal(await countNotificationRows(`QUOTE_EXPIRED:${attributed.quoteId}`), 1);
  assert.ok(result.quotesExpired >= 2);

  const unattributedWarning = warnings.find((w) => w.event === 'commercial_maintenance.quote_expired_unattributed' && w.detail.quoteId === orphan.quoteId);
  assert.ok(unattributedWarning, 'must log a structured warning for the unattributable quote');
});

test('MySQL PRIVACY: warning-log detail objects never carry notification message content (messageKey/params/free text)', async () => {
  const adminId = await createAdmin();
  const { quoteRepository } = buildQuoteService();
  const changeRequestRepository = new MySqlChangeRequestRepository();
  const now = new Date();
  const orphan = await insertQuoteAt(quoteRepository, { increaseRequestRef: null, expiresAt: new Date(now.getTime() - 1), adminId });

  const warnings = [];
  const runner = buildRunner({
    quoteService: { quoteRepository },
    changeRequestRepository,
    now: () => now,
    logger: { warn: (event, detail) => warnings.push({ event, detail }) },
  });
  await runner.runOnce();

  assert.ok(warnings.length > 0);
  for (const { detail } of warnings) {
    assert.equal(Object.prototype.hasOwnProperty.call(detail, 'messageKey'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(detail, 'params'), false);
  }
  void orphan;
});

test('MySQL: quote-expiry-notification catch-up drains a backlog larger than one batch across multiple passes within a single runOnce()', async () => {
  const adminId = await createAdmin();
  const { quoteRepository } = buildQuoteService();
  const changeRequestRepository = new MySqlChangeRequestRepository();
  const familyId = `family_${randomUUID()}`;
  const requestId = await createChangeRequestForFamily(changeRequestRepository, familyId);

  const now = new Date();
  const quotes = [];
  for (let i = 0; i < 7; i++) {
    quotes.push(await insertQuoteAt(quoteRepository, { increaseRequestRef: requestId, expiresAt: new Date(now.getTime() - 10_000 + i), adminId }));
  }

  const runner = buildRunner({
    quoteService: { quoteRepository },
    changeRequestRepository,
    now: () => now,
    config: { ...COMMERCIAL_MAINTENANCE_CONFIG_DEFAULTS, quoteExpiryBatchSize: 2 }, // forces multiple passes for 7 quotes
  });
  const result = await runner.runOnce();

  assert.ok(result.quotesExpired >= 7);
  assert.ok(result.notificationsPublished >= 7, 'a small batch size must still drain the entire backlog within one runOnce() call');
  for (const quote of quotes) {
    assert.equal(await countNotificationRows(`QUOTE_EXPIRED:${quote.quoteId}`), 1);
  }
});

test('MySQL RETENTION: a notification older than the configured retention window is pruned; a newer one is retained (never earlier than policy)', async () => {
  const publisher = new MySqlCommercialNotificationPublisher(new CommercialNotificationRepository());
  const accountRef = `family_${randomUUID()}`;

  const oldDedupeKey = `PAYMENT_CONFIRMED:${randomUUID()}`;
  const newDedupeKey = `PAYMENT_CONFIRMED:${randomUUID()}`;
  const veryOld = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000); // 200 days ago
  const recent = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000); // 1 day ago

  await publisher.publish({ accountRef, eventType: 'PAYMENT_CONFIRMED', dedupeKey: oldDedupeKey, resourceRef: null, messageKey: 'commercial_notification.payment_confirmed', params: null }, veryOld);
  await publisher.publish({ accountRef, eventType: 'PAYMENT_CONFIRMED', dedupeKey: newDedupeKey, resourceRef: null, messageKey: 'commercial_notification.payment_confirmed', params: null }, recent);

  const runner = buildRunner({ config: { ...COMMERCIAL_MAINTENANCE_CONFIG_DEFAULTS, notificationRetentionDays: 180, notificationPruneBatchSize: 500 } });
  const result = await runner.runOnce();

  assert.ok(result.notificationsPruned >= 1);
  assert.equal(await countNotificationRows(oldDedupeKey), 0, 'a notification older than the retention window must be pruned');
  assert.equal(await countNotificationRows(newDedupeKey), 1, 'a notification within the retention window must NEVER be deleted earlier than policy');
});

test('MySQL CONCURRENCY: two concurrent retention-prune passes never double-delete or error on an already-deleted row', async () => {
  const repository = new CommercialNotificationRepository();
  const publisher = new MySqlCommercialNotificationPublisher(repository);
  const accountRef = `family_${randomUUID()}`;
  const veryOld = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000);

  const dedupeKeys = [];
  for (let i = 0; i < 20; i++) {
    const dedupeKey = `PAYMENT_CONFIRMED:${randomUUID()}`;
    dedupeKeys.push(dedupeKey);
    await publisher.publish({ accountRef, eventType: 'PAYMENT_CONFIRMED', dedupeKey, resourceRef: null, messageKey: 'commercial_notification.payment_confirmed', params: null }, veryOld);
  }

  const cutoff = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000);
  // Two concurrent prune calls racing the SAME backlog -- both must
  // complete without error, and the total deleted must never exceed (and
  // for this fully-covered backlog, must equal) the number of eligible rows.
  const [a, b] = await Promise.all([repository.pruneOlderThan(cutoff, 100), repository.pruneOlderThan(cutoff, 100)]);
  assert.equal(a + b <= dedupeKeys.length, true, 'combined deletions must never exceed the eligible row count (no double-delete)');

  for (const dedupeKey of dedupeKeys) {
    assert.equal(await countNotificationRows(dedupeKey), 0);
  }

  // A THIRD prune call against the now-empty backlog must be a safe no-op, not an error.
  const c = await repository.pruneOlderThan(cutoff, 100);
  assert.equal(c, 0);
});

test('MySQL RENEWAL UPCOMING: a subscription renewing within the 7-day window is reminded once; one renewing well outside the window is untouched', async () => {
  const subscriptionRepository = new SubscriptionRepository();
  const planId = await createPlan();
  const now = new Date();

  const soon = await insertSubscriptionAt(subscriptionRepository, {
    accountRef: `family_${randomUUID()}`,
    planId,
    status: 'ACTIVE',
    currentPeriodStart: new Date(now.getTime() - 23 * 24 * 60 * 60 * 1000),
    currentPeriodEnd: new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000), // 3 days out -- within window
  });
  const faraway = await insertSubscriptionAt(subscriptionRepository, {
    accountRef: `family_${randomUUID()}`,
    planId,
    status: 'ACTIVE',
    currentPeriodStart: now,
    currentPeriodEnd: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000), // 30 days out -- outside window
  });

  const runner = buildRunner({ now: () => now });
  const result = await runner.runOnce();

  assert.ok(result.notificationsPublished >= 1);
  const soonDedupeKey = `RENEWAL_UPCOMING:${soon.subscriptionId}:${soon.currentPeriodEnd.toISOString().slice(0, 10)}`;
  const farDedupeKey = `RENEWAL_UPCOMING:${faraway.subscriptionId}:${faraway.currentPeriodEnd.toISOString().slice(0, 10)}`;
  assert.equal(await countNotificationRows(soonDedupeKey), 1, 'a subscription renewing within the window must be reminded');
  assert.equal(await countNotificationRows(farDedupeKey), 0, 'a subscription renewing well outside the window must never be reminded yet');

  const notifRow = await readNotificationRow(soonDedupeKey);
  assert.equal(notifRow.account_ref, soon.accountRef);
  assert.equal(notifRow.event_type, 'RENEWAL_UPCOMING');
  assert.equal(notifRow.resource_ref, soon.subscriptionId);
});

test('MySQL RENEWAL UPCOMING: a CANCELED subscription renewing within the window is never reminded', async () => {
  const subscriptionRepository = new SubscriptionRepository();
  const planId = await createPlan();
  const now = new Date();

  const canceled = await insertSubscriptionAt(subscriptionRepository, {
    accountRef: `family_${randomUUID()}`,
    planId,
    status: 'CANCELED',
    currentPeriodStart: new Date(now.getTime() - 20 * 24 * 60 * 60 * 1000),
    currentPeriodEnd: new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000), // within window, but CANCELED
  });

  const runner = buildRunner({ now: () => now });
  await runner.runOnce();

  const dedupeKey = `RENEWAL_UPCOMING:${canceled.subscriptionId}:${canceled.currentPeriodEnd.toISOString().slice(0, 10)}`;
  assert.equal(await countNotificationRows(dedupeKey), 0, 'a CANCELED subscription must never be reminded, even if current_period_end is within the window');
});

test('MySQL RENEWAL UPCOMING: idempotent across repeated runOnce() calls for the same cycle -- no duplicate reminder', async () => {
  const subscriptionRepository = new SubscriptionRepository();
  const planId = await createPlan();
  const now = new Date();

  const subscription = await insertSubscriptionAt(subscriptionRepository, {
    accountRef: `family_${randomUUID()}`,
    planId,
    status: 'ACTIVE',
    currentPeriodStart: new Date(now.getTime() - 25 * 24 * 60 * 60 * 1000),
    currentPeriodEnd: new Date(now.getTime() + 1 * 24 * 60 * 60 * 1000),
  });
  const dedupeKey = `RENEWAL_UPCOMING:${subscription.subscriptionId}:${subscription.currentPeriodEnd.toISOString().slice(0, 10)}`;

  const runner = buildRunner({ now: () => now });
  const first = await runner.runOnce();
  assert.ok(first.notificationsPublished >= 1);
  assert.equal(await countNotificationRows(dedupeKey), 1);

  await runner.runOnce();
  assert.equal(await countNotificationRows(dedupeKey), 1, 'a second runOnce() for the SAME renewal cycle must never create a duplicate notification');

  // A THIRD run via an entirely separate runner instance (simulating another
  // process) racing the same already-notified cycle must also be a safe no-op.
  const other = buildRunner({ now: () => now });
  await other.runOnce();
  assert.equal(await countNotificationRows(dedupeKey), 1);
});

test('MySQL RENEWAL UPCOMING: a subscription renewing exactly at the window boundaries is reminded (inclusive range)', async () => {
  const subscriptionRepository = new SubscriptionRepository();
  const planId = await createPlan();
  const now = new Date();

  const exactlyNow = await insertSubscriptionAt(subscriptionRepository, {
    accountRef: `family_${randomUUID()}`,
    planId,
    status: 'ACTIVE',
    currentPeriodStart: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
    currentPeriodEnd: now,
  });
  const exactlySevenDaysOut = await insertSubscriptionAt(subscriptionRepository, {
    accountRef: `family_${randomUUID()}`,
    planId,
    status: 'ACTIVE',
    currentPeriodStart: now,
    currentPeriodEnd: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
  });

  const runner = buildRunner({ now: () => now });
  await runner.runOnce();

  const nowDedupeKey = `RENEWAL_UPCOMING:${exactlyNow.subscriptionId}:${exactlyNow.currentPeriodEnd.toISOString().slice(0, 10)}`;
  const sevenDayDedupeKey = `RENEWAL_UPCOMING:${exactlySevenDaysOut.subscriptionId}:${exactlySevenDaysOut.currentPeriodEnd.toISOString().slice(0, 10)}`;
  assert.equal(await countNotificationRows(nowDedupeKey), 1, 'a subscription renewing exactly now must be reminded');
  assert.equal(await countNotificationRows(sevenDayDedupeKey), 1, 'a subscription renewing exactly at the far edge of the window must be reminded');
});

test.after(async () => {
  await closePool();
});
