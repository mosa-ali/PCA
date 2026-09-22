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

/** The durable attribution state for one quote, or null when the quote has none
 * (i.e. it was never unattributable, or its state was cleared after a publish). */
async function readAttributionRow(quoteId) {
  const [rows] = await getPool().query(
    'SELECT state, reason_code, attempt_count, next_attempt_at, terminal_at FROM commercial_quote_attribution_retry WHERE quote_id = ?',
    [quoteId],
  );
  return rows[0] ?? null;
}

/** Test control over the BACKOFF CLOCK only, never over the decision: it moves
 * `next_attempt_at` into the past so the next runOnce() considers the row due,
 * exactly as waiting would. It cannot make a terminal row eligible again, which
 * is what keeps TERMINAL_UNATTRIBUTABLE honest. */
async function makeAttributionDue(quoteId, when = new Date(Date.now() - 1_000)) {
  await getPool().query('UPDATE commercial_quote_attribution_retry SET next_attempt_at = ? WHERE quote_id = ?', [when, quoteId]);
}

/** Same as createChangeRequestForFamily, but with a CALLER-CHOSEN request id, so a
 * test can write a quote that references a request which does not exist YET and
 * then create it -- the only way to exercise "temporarily unattributable". */
async function createChangeRequestWithId(changeRequestRepository, familyId, requestId) {
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

// ---------------------------------------------------------------------------
// LIVENESS REGRESSION (PCA-COMMERCIAL-LIVENESS-1)
//
// This is the test whose ABSENCE let a production starvation defect ship. The
// drain loop used to re-issue the same `LIMIT ?` scan every pass and treat "this
// pass returned fewer rows than the batch size" as its only convergence signal.
// That signal is invalid whenever a pass SKIPS a row: an unattributable expired
// quote never gains a notification, so it never leaves the
// `missing notification` predicate, and because the scan is ordered
// `expires_at ASC` a batch-full of them permanently occupies the head of the
// window. Measured before the fix, with 3 such rows and a batch size of 3: 1,000
// passes executed (the MAX_PASSES_PER_RUN cap, i.e. the safety net WAS the
// termination path), 3,000 unattributed warns, and an eligible expired quote
// behind them never notified at all -- starved indefinitely, not merely delayed.
//
// The assertions below are deliberately about PROGRESS, not about counts of
// notifications alone: a test that only asserted "the eligible row is notified"
// on an otherwise-empty database would have passed against the broken loop too,
// which is precisely how the defect survived.
test('MySQL LIVENESS: unattributable expired quotes filling the batch must not starve an eligible quote behind them, and the drain must end by exhaustion, not by the pass cap', async () => {
  const adminId = await createAdmin();
  const { quoteRepository } = buildQuoteService();
  const changeRequestRepository = new MySqlChangeRequestRepository();
  const familyId = `family_${randomUUID()}`;
  const requestId = await createChangeRequestForFamily(changeRequestRepository, familyId);

  const BATCH = 3;
  const now = Date.now();

  // Ineligible rows FIRST in scan order: unattributable (no increase_request_ref)
  // and OLDER than the eligible row, so they sit at the head of the
  // (expires_at ASC, quote_id ASC) window. Exactly BATCH of them, so every pass
  // that re-issued the same query would return these same rows and nothing else.
  const ineligibleQuoteIds = [];
  for (let i = 0; i < BATCH; i++) {
    // insertQuoteAt returns the inserted QuoteRow, so take .quoteId.
    const row = await insertQuoteAt(quoteRepository, { increaseRequestRef: null, expiresAt: new Date(now - 50_000 + i * 1_000), adminId });
    ineligibleQuoteIds.push(row.quoteId);
  }
  // One ELIGIBLE row behind them: it has a resolvable increase_request_ref, so
  // it is genuinely publishable and must eventually be reached. (The helper
  // pins issued_at to 60s ago, so every expiry here must stay inside that
  // minute -- billing_quotes_expiry_check requires expires_at > issued_at --
  // which is why the ineligible rows use -50s..-48s and this one -10s.)
  const eligibleQuoteId = (await insertQuoteAt(quoteRepository, { increaseRequestRef: requestId, expiresAt: new Date(now - 10_000), adminId })).quoteId;

  // Count passes indirectly and independently of the implementation: publishOne
  // emits exactly one `quote_expired_unattributed` warn per skipped row per
  // pass. Reaching MAX_PASSES_PER_RUN (1,000) therefore REQUIRES at least
  // 1,000 x BATCH = 3,000 warns, so any warn total below 1,000 is proof on its
  // own that the loop terminated by exhaustion rather than by the cap. This
  // matters because the cap must remain a safety net, never the normal exit.
  let unattributedWarns = 0;
  const logger = {
    warn: (event) => {
      if (event === 'commercial_maintenance.quote_expired_unattributed') unattributedWarns += 1;
    },
  };

  const runner = buildRunner({
    quoteService: { quoteRepository },
    changeRequestRepository,
    config: { ...COMMERCIAL_MAINTENANCE_CONFIG_DEFAULTS, quoteExpiryBatchSize: BATCH },
    logger,
  });

  const first = await runner.runOnce();

  // INELIGIBLE_ROWS_NOT_NOTIFIED -- skipping must stay a skip, never a guess.
  for (const quoteId of ineligibleQuoteIds) {
    assert.equal(await countNotificationRows(`QUOTE_EXPIRED:${quoteId}`), 0, `unattributable quote ${quoteId} must never be notified`);
  }

  // ELIGIBLE_ROW_BEHIND_UNATTRIBUTABLE_ROWS = EVENTUALLY_PROCESSED, and
  // ELIGIBLE_NOTIFICATION_EXACTLY_ONCE.
  assert.equal(await countNotificationRows(`QUOTE_EXPIRED:${eligibleQuoteId}`), 1, 'the eligible quote BEHIND a batch-full of unattributable rows must still be reached and notified exactly once');
  assert.ok(first.notificationsPublished >= 1);

  // RUN_TERMINATES_BEFORE_MAX_PASSES / MAX_PASS_LIMIT = SAFETY_NET, NOT
  // NORMAL_TERMINATION / NO_PROGRESS_LOOP.
  assert.ok(
    unattributedWarns < 1_000,
    `the drain must terminate by exhausting the scan, not by hitting MAX_PASSES_PER_RUN; ${unattributedWarns} unattributed warns means it did not (reaching the cap needs at least 3,000)`,
  );

  // REPEATED_RUN_ON_POPULATED_DB = IDEMPOTENT and SECOND_RUN_DUPLICATE_NOTIFICATION = NO.
  const warnsBeforeSecondRun = unattributedWarns;
  const second = await runner.runOnce();
  assert.equal(await countNotificationRows(`QUOTE_EXPIRED:${eligibleQuoteId}`), 1, 'a second run must not publish a duplicate for the same quote');
  for (const quoteId of ineligibleQuoteIds) {
    assert.equal(await countNotificationRows(`QUOTE_EXPIRED:${quoteId}`), 0);
  }
  assert.equal(second.notificationsPublished, 0, 'a second run over an already-drained backlog must publish nothing');

  // SUPERSEDED BY THE OWNER'S ATTRIBUTION DECISION (PCA-COMMERCIAL-LIVENESS-2).
  // This used to assert that unattributable rows are re-examined on every later
  // run. They no longer are -- and that is the point of the state table: the
  // rows here carry no reference at all, so they are PROVABLY permanent
  // (REFERENCE_ABSENT) and become TERMINAL_UNATTRIBUTABLE on first sighting,
  // which is what stops an unattributable backlog costing work for ever. The
  // earlier assertion would now be pinning the removed behaviour as the spec.
  for (const quoteId of ineligibleQuoteIds) {
    const state = await readAttributionRow(quoteId);
    assert.equal(state.state, 'TERMINAL_UNATTRIBUTABLE', 'a quote with no reference at all is provably never attributable');
    assert.equal(state.reason_code, 'REFERENCE_ABSENT');
  }
  assert.equal(unattributedWarns, warnsBeforeSecondRun, 'now-terminal rows must NOT be re-scanned on a later run');
});

test('MySQL LIVENESS: a SINGLE unattributable expired quote must not loop the drain to the pass cap, and an eligible row behind it is still processed', async () => {
  const adminId = await createAdmin();
  const { quoteRepository } = buildQuoteService();
  const changeRequestRepository = new MySqlChangeRequestRepository();
  const familyId = `family_${randomUUID()}`;
  const requestId = await createChangeRequestForFamily(changeRequestRepository, familyId);

  const now = Date.now();
  const ineligibleQuoteId = (await insertQuoteAt(quoteRepository, { increaseRequestRef: null, expiresAt: new Date(now - 50_000), adminId })).quoteId;
  const eligibleQuoteId = (await insertQuoteAt(quoteRepository, { increaseRequestRef: requestId, expiresAt: new Date(now - 10_000), adminId })).quoteId;

  let unattributedWarns = 0;
  const logger = {
    warn: (event) => {
      if (event === 'commercial_maintenance.quote_expired_unattributed') unattributedWarns += 1;
    },
  };

  // Batch size 1 is the tightest window: EVERY pass returns exactly one row, so
  // the old loop could only ever exit via the pass cap once it reached a row it
  // always skips (ONE_UNATTRIBUTABLE_EXPIRED_QUOTE = DOES_NOT_LOOP_FOREVER).
  const runner = buildRunner({
    quoteService: { quoteRepository },
    changeRequestRepository,
    config: { ...COMMERCIAL_MAINTENANCE_CONFIG_DEFAULTS, quoteExpiryBatchSize: 1 },
    logger,
  });

  await runner.runOnce();

  assert.equal(await countNotificationRows(`QUOTE_EXPIRED:${ineligibleQuoteId}`), 0, 'the unattributable quote must never be notified');
  assert.equal(await countNotificationRows(`QUOTE_EXPIRED:${eligibleQuoteId}`), 1, 'the eligible quote behind it must still be processed in the SAME run');
  assert.ok(unattributedWarns < 1_000, `batch size 1 must not drive the drain to the pass cap; got ${unattributedWarns} unattributed warns`);
});

// ---------------------------------------------------------------------------
// ATTRIBUTION STATE (PCA-COMMERCIAL-LIVENESS-2)
//
// The owner's decision: model attribution explicitly, make terminality depend on
// PROOF rather than on age or retry count, and give anything not provably
// permanent a durable bounded retry instead of an unconditional re-scan.
// ---------------------------------------------------------------------------
test('MySQL ATTRIBUTION: a quote whose reference does not resolve YET stays PENDING_ATTRIBUTION, then becomes attributable and is notified exactly once', async () => {
  const adminId = await createAdmin();
  const { quoteRepository } = buildQuoteService();
  const changeRequestRepository = new MySqlChangeRequestRepository();
  const familyId = `family_${randomUUID()}`;

  // A reference to a change request that deliberately does not exist yet.
  const futureRequestId = randomUUID();
  const now = Date.now();
  const quoteId = (await insertQuoteAt(quoteRepository, { increaseRequestRef: futureRequestId, expiresAt: new Date(now - 10_000), adminId })).quoteId;

  const runner = buildRunner({ quoteService: { quoteRepository }, changeRequestRepository });

  await runner.runOnce();

  // Not attributable, and NOT terminalised: nothing in source proves this
  // reference can never later resolve, so it must stay pending rather than being
  // written off.
  const pending = await readAttributionRow(quoteId);
  assert.equal(pending.state, 'PENDING_ATTRIBUTION', 'an unresolved reference must stay pending, never terminal');
  assert.equal(pending.reason_code, 'REFERENCE_UNRESOLVED');
  assert.equal(Number(pending.attempt_count), 1);
  assert.equal(pending.terminal_at, null);
  assert.equal(await countNotificationRows(`QUOTE_EXPIRED:${quoteId}`), 0);

  // Now the referenced request appears -- the "temporarily unattributable" case.
  await createChangeRequestWithId(changeRequestRepository, familyId, futureRequestId);

  // Elapse the backoff (test control over the CLOCK only).
  await makeAttributionDue(quoteId);
  const recovered = await runner.runOnce();

  assert.equal(await countNotificationRows(`QUOTE_EXPIRED:${quoteId}`), 1, 'once attributable, the quote must be notified');
  assert.equal(recovered.notificationsPublished, 1);
  assert.equal(await readAttributionRow(quoteId), null, 'the retry state must be cleared once the notification exists');

  // And exactly once, across a further run.
  await runner.runOnce();
  assert.equal(await countNotificationRows(`QUOTE_EXPIRED:${quoteId}`), 1);
});

test('MySQL ATTRIBUTION: a quote with NO reference at all is TERMINAL_UNATTRIBUTABLE exactly once, and is never re-scanned', async () => {
  const adminId = await createAdmin();
  const { quoteRepository } = buildQuoteService();
  const changeRequestRepository = new MySqlChangeRequestRepository();

  const now = Date.now();
  const quoteId = (await insertQuoteAt(quoteRepository, { increaseRequestRef: null, expiresAt: new Date(now - 10_000), adminId })).quoteId;

  let unattributedWarns = 0;
  const logger = { warn: (event) => { if (event === 'commercial_maintenance.quote_expired_unattributed') unattributedWarns += 1; } };
  const runner = buildRunner({ quoteService: { quoteRepository }, changeRequestRepository, logger });

  await runner.runOnce();

  const terminal = await readAttributionRow(quoteId);
  assert.equal(terminal.state, 'TERMINAL_UNATTRIBUTABLE', 'no reference at all is provably permanent');
  assert.equal(terminal.reason_code, 'REFERENCE_ABSENT');
  assert.ok(terminal.terminal_at, 'a terminal row must record when it became terminal');
  assert.equal(await countNotificationRows(`QUOTE_EXPIRED:${quoteId}`), 0, 'a terminal quote is never notified');

  // Run twice more: the terminal state must be reached exactly once and the row
  // must drop out of the scan entirely (no further skip-warnings for it).
  const firstTerminalAt = terminal.terminal_at;
  const [firstCount] = await getPool().query('SELECT COUNT(*) AS n FROM commercial_quote_attribution_retry WHERE quote_id = ?', [quoteId]);
  assert.equal(Number(firstCount[0].n), 1);
  const warnsAfterFirstRun = unattributedWarns;

  await runner.runOnce();
  await runner.runOnce();

  const after = await readAttributionRow(quoteId);
  assert.equal(after.state, 'TERMINAL_UNATTRIBUTABLE');
  assert.deepEqual(after.terminal_at, firstTerminalAt, 'terminal_at must not move: the transition happens exactly once');
  const [secondCount] = await getPool().query('SELECT COUNT(*) AS n FROM commercial_quote_attribution_retry WHERE quote_id = ?', [quoteId]);
  assert.equal(Number(secondCount[0].n), 1, 're-terminalising must not create a second row');
  assert.equal(unattributedWarns, warnsAfterFirstRun, 'a terminal row must not be re-scanned on later runs');
});

test('MySQL ATTRIBUTION: a not-yet-due pending row is NOT re-scanned before next_attempt_at', async () => {
  const adminId = await createAdmin();
  const { quoteRepository } = buildQuoteService();
  const changeRequestRepository = new MySqlChangeRequestRepository();

  const now = Date.now();
  const quoteId = (await insertQuoteAt(quoteRepository, { increaseRequestRef: randomUUID(), expiresAt: new Date(now - 10_000), adminId })).quoteId;

  let unattributedWarns = 0;
  const logger = { warn: (event) => { if (event === 'commercial_maintenance.quote_expired_unattributed') unattributedWarns += 1; } };
  const runner = buildRunner({ quoteService: { quoteRepository }, changeRequestRepository, logger });

  await runner.runOnce();
  const first = await readAttributionRow(quoteId);
  assert.equal(first.state, 'PENDING_ATTRIBUTION');
  assert.ok(new Date(first.next_attempt_at).getTime() > Date.now(), 'the schedule must be in the FUTURE, not due immediately');
  const warnsAfterFirstRun = unattributedWarns;

  // Several cycles pass with the row not yet due.
  await runner.runOnce();
  await runner.runOnce();

  assert.equal(unattributedWarns, warnsAfterFirstRun, 'a not-yet-due pending row must not be re-scanned every cycle');
  const unchanged = await readAttributionRow(quoteId);
  assert.equal(Number(unchanged.attempt_count), 1, 'an un-attempted cycle must not inflate attempt_count');

  // And once due, it is retried (attempt_count advances) -- bounded retry, not
  // abandonment.
  await makeAttributionDue(quoteId);
  await runner.runOnce();
  const retried = await readAttributionRow(quoteId);
  assert.equal(Number(retried.attempt_count), 2, 'a due pending row must be retried');
  assert.ok(new Date(retried.next_attempt_at).getTime() > Date.now(), 'and rescheduled into the future again');
});

test('MySQL ATTRIBUTION: a large not-due pending backlog cannot starve a newly eligible quote', async () => {
  const adminId = await createAdmin();
  const { quoteRepository } = buildQuoteService();
  const changeRequestRepository = new MySqlChangeRequestRepository();
  const familyId = `family_${randomUUID()}`;
  const requestId = await createChangeRequestForFamily(changeRequestRepository, familyId);

  const now = Date.now();
  // A backlog of unresolved-reference quotes, all of which become not-yet-due
  // pending rows on first sighting.
  const backlog = [];
  for (let i = 0; i < 6; i++) {
    backlog.push((await insertQuoteAt(quoteRepository, { increaseRequestRef: randomUUID(), expiresAt: new Date(now - 50_000 + i * 100), adminId })).quoteId);
  }
  const runner = buildRunner({ quoteService: { quoteRepository }, changeRequestRepository, config: { ...COMMERCIAL_MAINTENANCE_CONFIG_DEFAULTS, quoteExpiryBatchSize: 2 } });
  await runner.runOnce();
  for (const id of backlog) {
    assert.equal((await readAttributionRow(id)).state, 'PENDING_ATTRIBUTION');
  }

  // A brand-new eligible quote arrives while the whole backlog is not due.
  const eligibleId = (await insertQuoteAt(quoteRepository, { increaseRequestRef: requestId, expiresAt: new Date(now - 5_000), adminId })).quoteId;
  const run = await runner.runOnce();

  assert.equal(await countNotificationRows(`QUOTE_EXPIRED:${eligibleId}`), 1, 'a newly eligible quote must be processed in the SAME run even with a pending backlog ahead of it');
  assert.ok(run.notificationsPublished >= 1);
  for (const id of backlog) {
    assert.equal(await countNotificationRows(`QUOTE_EXPIRED:${id}`), 0, 'backlog rows must remain un-notified, not guessed at');
  }
});

test('MySQL ATTRIBUTION: retry state survives a restart (a brand-new runner instance honours the persisted schedule)', async () => {
  const adminId = await createAdmin();
  const { quoteRepository } = buildQuoteService();
  const changeRequestRepository = new MySqlChangeRequestRepository();

  const now = Date.now();
  const quoteId = (await insertQuoteAt(quoteRepository, { increaseRequestRef: randomUUID(), expiresAt: new Date(now - 10_000), adminId })).quoteId;

  let firstInstanceWarns = 0;
  const firstLogger = { warn: (event) => { if (event === 'commercial_maintenance.quote_expired_unattributed') firstInstanceWarns += 1; } };
  await buildRunner({ quoteService: { quoteRepository }, changeRequestRepository, logger: firstLogger }).runOnce();
  const persisted = await readAttributionRow(quoteId);
  assert.equal(Number(persisted.attempt_count), 1);

  // A completely separate instance, as a restarted process would be. Nothing is
  // carried in memory, so the schedule must come from the database.
  let secondInstanceWarns = 0;
  const secondLogger = { warn: (event) => { if (event === 'commercial_maintenance.quote_expired_unattributed') secondInstanceWarns += 1; } };
  await buildRunner({ quoteService: { quoteRepository }, changeRequestRepository, logger: secondLogger }).runOnce();

  assert.equal(secondInstanceWarns, 0, 'the restarted process must respect the persisted next_attempt_at, not retry immediately');
  assert.equal(Number((await readAttributionRow(quoteId)).attempt_count), 1, 'and must not inflate attempt_count');
});

test('MySQL ATTRIBUTION: concurrent runners do not duplicate the terminal transition', async () => {
  const adminId = await createAdmin();
  const { quoteRepository } = buildQuoteService();
  const changeRequestRepository = new MySqlChangeRequestRepository();

  const now = Date.now();
  const quoteId = (await insertQuoteAt(quoteRepository, { increaseRequestRef: null, expiresAt: new Date(now - 10_000), adminId })).quoteId;

  // Four instances race the same unattributable quote.
  const runners = Array.from({ length: 4 }, () => buildRunner({ quoteService: { quoteRepository }, changeRequestRepository }));
  await Promise.all(runners.map((r) => r.runOnce()));

  const rows = await getPool().query('SELECT state, terminal_at FROM commercial_quote_attribution_retry WHERE quote_id = ?', [quoteId]);
  assert.equal(rows[0].length, 1, 'exactly one state row may exist, whatever raced');
  assert.equal(rows[0][0].state, 'TERMINAL_UNATTRIBUTABLE');

  const [count] = await getPool().query('SELECT COUNT(*) AS n FROM commercial_quote_attribution_retry WHERE quote_id = ? AND terminal_at IS NOT NULL', [quoteId]);
  assert.equal(Number(count[0].n), 1, 'the terminal transition must happen exactly once even under concurrency');
  assert.equal(await countNotificationRows(`QUOTE_EXPIRED:${quoteId}`), 0);
});

test('MySQL ATTRIBUTION: the state table CHECK constraints reject an out-of-vocabulary state or reason', async () => {
  const adminId = await createAdmin();
  const { quoteRepository } = buildQuoteService();
  const now = Date.now();
  const quoteId = (await insertQuoteAt(quoteRepository, { increaseRequestRef: null, expiresAt: new Date(now - 10_000), adminId })).quoteId;

  await assert.rejects(
    () => getPool().query(
      `INSERT INTO commercial_quote_attribution_retry (quote_id, state, reason_code, attempt_count, next_attempt_at, terminal_at, created_at, updated_at)
       VALUES (?, 'NOTIFIED', 'REFERENCE_ABSENT', 0, ?, ?, ?, ?)`,
      [quoteId, new Date(), new Date(), new Date(), new Date()],
    ),
    (error) => error.code === 'ER_CHECK_CONSTRAINT_VIOLATED',
    'NOTIFIED must be unstorable: the notification row is its evidence, and a copy could diverge from it',
  );
  await assert.rejects(
    () => getPool().query(
      `INSERT INTO commercial_quote_attribution_retry (quote_id, state, reason_code, attempt_count, next_attempt_at, terminal_at, created_at, updated_at)
       VALUES (?, 'TERMINAL_UNATTRIBUTABLE', 'REFERENCE_UNRESOLVED', 0, ?, NULL, ?, ?)`,
      [quoteId, new Date(), new Date(), new Date()],
    ),
    (error) => error.code === 'ER_CHECK_CONSTRAINT_VIOLATED',
    'a terminal row must carry terminal_at; the constraint asserts it in both directions',
  );
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
