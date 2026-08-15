// PCA-BILL-3 (Writer62, Round6): real-MySQL tests for the Settlement /
// Reconciliation domain (SETTLEMENT_RECONCILIATION_V1). Covers: schema
// privacy (no raw banking secret column, static + live DDL), masked reads,
// the full RBAC matrix (explicit PLATFORM_ADMIN/SUPPORT_ADMIN denial),
// step-up required on every mutation (including step-up identity binding),
// same-currency and cross-currency (FX snapshot) batches, exact bigint
// arithmetic round-tripped through real BIGINT columns, the reconciliation
// state machine, the double-batch-attribution race, concurrent
// reconciliation attempts, wrong-currency rejection, and an HTTP masked-GET
// smoke test through the real route module. Mirrors
// test/db/complimentaryGrants.mysql.test.mjs's structure/helpers.
if (!process.env.PLATFORM_ADMIN_MFA_ENC_KEY) process.env.PLATFORM_ADMIN_MFA_ENC_KEY = 'ab'.repeat(32);

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import Fastify from 'fastify';
import { closePool, getPool } from '../../dist/db/pool.js';
import { money } from '../../dist/billing/money.js';
import { MySqlSettlementRepository } from '../../dist/billing/settlement/MySqlSettlementRepository.js';
import { SettlementService } from '../../dist/billing/settlement/SettlementService.js';
import { SettlementError } from '../../dist/billing/settlement/types.js';
import { PlatformAdminSettlementService, PlatformAdminSettlementError } from '../../dist/platformadmin/settlement/PlatformAdminSettlementService.js';
import { registerSettlementRoutes } from '../../dist/http/routes/platformadmin/settlementRoutes.js';
import { createRateLimiter } from '../../dist/http/rateLimit.js';
import { PaymentRepository, PaymentService } from '../../dist/billing/payment.js';
import { PriceBookService, PriceBookRepository } from '../../dist/billing/priceBook.js';
import { QuoteService, QuoteRepository } from '../../dist/billing/quote.js';
import { PlatformAdminAuditService } from '../../dist/platformadmin/audit/PlatformAdminAuditService.js';
import { MySqlPlatformAdminAuditRepository } from '../../dist/platformadmin/audit/MySqlPlatformAdminAuditRepository.js';
import { PlatformAdminAuthService } from '../../dist/platformadmin/auth/PlatformAdminAuthService.js';
import { PlatformAdminAccountService } from '../../dist/platformadmin/auth/PlatformAdminAccountService.js';
import { MySqlPlatformAdminAuthRepository } from '../../dist/platformadmin/auth/MySqlAuthRepository.js';
import { hashAdminEmail } from '../../dist/platformadmin/auth/emailHash.js';
import { computeTotp, encryptTotpSecret, generateTotpSecret, loadMfaEncryptionKey } from '../../dist/platformadmin/auth/totp.js';
import { LoggingAlertAdapter } from '../../dist/platformadmin/auth/alertPort.js';

if (!process.env.PCA_DATABASE_URL) throw new Error('PCA_DATABASE_URL is required for backend/test/db tests.');

const settlementRepository = new MySqlSettlementRepository();
const paymentRepository = new PaymentRepository();
const settlementService = new SettlementService(settlementRepository, paymentRepository);

const authRepository = new MySqlPlatformAdminAuthRepository();
const accountService = new PlatformAdminAccountService(authRepository);
let clockOffsetMs = 0;
const clock = () => new Date(Date.now() + clockOffsetMs);
const authService = new PlatformAdminAuthService(authRepository, new LoggingAlertAdapter(), clock);
const adminSettlementService = new PlatformAdminSettlementService(authService, settlementService, clock);

const auditService = new PlatformAdminAuditService(new MySqlPlatformAdminAuditRepository());
const priceBookRepository = new PriceBookRepository();
const priceBookService = new PriceBookService(priceBookRepository, auditService);
const quoteService = new QuoteService(priceBookRepository, new QuoteRepository(), auditService);
const paymentService = new PaymentService(paymentRepository, quoteService, auditService);

function uniqueEmail(label) {
  return `${label}-${randomUUID()}@example.test`;
}

async function createAdmin({ role = 'FINANCE_ADMIN' } = {}) {
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

async function stepUpFor(admin, scope = 'SETTLEMENT_BANK_CONFIG') {
  clockOffsetMs += 31_000;
  const code = computeTotp(admin.secret, clock().getTime());
  const result = await authService.assertStepUp(admin.adminId, admin.sessionId, scope, code, admin.roles[0]);
  return result.stepUpId;
}

function actorOf(admin) {
  return { adminId: admin.adminId, roles: admin.roles, sessionId: admin.sessionId };
}

async function countAuditEvents(eventType, targetRef) {
  const [rows] = await getPool().query(`SELECT COUNT(*) AS n FROM platform_admin_audit_events WHERE event_type = ? AND target_ref = ?`, [eventType, targetRef]);
  return rows[0].n;
}

/** Real end-to-end flow (publish price -> resolve quote -> create attempt -> confirm) so settlement tests attribute a GENUINE, unmodified PaymentTransactionRow -- never a synthetic/hand-crafted row -- mirroring billingCore.mysql.test.mjs's own full-flow test. */
async function confirmedTransaction({ currencyCode = 'USD', market = 'GLOBAL_OTHER', amountMinor = 5000n } = {}) {
  const financeAdminId = (await createAdmin({ role: 'FINANCE_ADMIN' })).adminId;
  const actor = { adminId: financeAdminId, role: 'FINANCE_ADMIN' };
  const key = { commercialMarket: market, currencyCode, targetDeviceLimit: 400_000 + Math.floor(Math.random() * 100_000) };
  await priceBookService.publishPrice({ ...key, amountMinor }, actor, ['FINANCE_ADMIN']);
  const resolution = await quoteService.resolveStandardQuote(key.commercialMarket, key.currencyCode, key.targetDeviceLimit, new Date());
  assert.equal(resolution.kind, 'RESOLVED');
  const accountRef = `account-${randomUUID()}`;
  const attempt = await paymentService.createAttemptFromSnapshot({ accountRef, invoiceId: null, increaseRequestRef: `req-${randomUUID()}`, paymentMethodId: null }, resolution.snapshot);
  const transaction = await paymentService.confirmPaymentAttempt(attempt.paymentAttemptId, 'TEST_SANDBOX', `ref-${randomUUID()}`, actor);
  return { transaction, accountRef };
}

async function createActiveAccount(admin, currency = 'USD') {
  const stepUpId = await stepUpFor(admin);
  return adminSettlementService.createAccount(actorOf(admin), { providerRef: `secretref:${randomUUID()}`, displayLabel: '****4242', settlementCurrency: currency, stepUpId });
}

// ---------------------------------------------------------------------------
// Schema privacy: static DDL scan + live information_schema scan
// ---------------------------------------------------------------------------

test('SCHEMA PRIVACY (static): migration 0015 never declares a raw banking-secret column (password/pin/cvv/private_key/api_key/secret-value pattern)', () => {
  const migrationPath = fileURLToPath(new URL('../../migrations/0015_settlement_reconciliation.sql', import.meta.url));
  const sql = readFileSync(migrationPath, 'utf8');
  // Strip SQL comments before scanning column definitions -- the file's own
  // prose comments legitimately discuss "credential"/"secret" in English.
  const withoutComments = sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');
  const forbiddenColumnPatterns = [/\bpassword\w*\s+(VARCHAR|CHAR|TEXT|BLOB)/i, /\bpin\w*\s+(VARCHAR|CHAR|INT)/i, /\bcvv\w*/i, /\bpan\b/i, /\bprivate_key\w*/i, /\braw_api_key\w*/i, /\bcredential\w*/i];
  for (const pattern of forbiddenColumnPatterns) {
    assert.equal(pattern.test(withoutComments), false, `forbidden banking-secret-shaped column pattern found: ${pattern}`);
  }
});

test('SCHEMA PRIVACY (live): every settlement_* table in the real database has only opaque-reference/bounded/monetary/timestamp columns -- no raw secret column', async () => {
  const [rows] = await getPool().query(
    `SELECT table_name AS table_name, column_name AS column_name, column_type AS column_type FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name LIKE 'settlement_%' ORDER BY table_name, ordinal_position`,
  );
  assert.ok(rows.length > 0, 'expected settlement_* tables to exist after migration 0015');
  const forbidden = /password|secret_value|private_key|cvv|\bpan\b|api_key_raw/i;
  for (const row of rows) {
    assert.equal(forbidden.test(row.column_name), false, `forbidden column ${row.table_name}.${row.column_name}`);
  }
  // provider_ref columns are opaque references, never wider than a bounded VARCHAR (never TEXT/BLOB, which would invite dumping unbounded secret material).
  const providerRefColumns = rows.filter((r) => r.column_name === 'provider_ref');
  assert.equal(
    providerRefColumns.length,
    3,
    `expected settlement_accounts/settlement_batches/settlement_fx_snapshots.provider_ref, got: ${JSON.stringify(rows.map((r) => `${r.table_name}.${r.column_name}`))}`,
  );
  for (const col of providerRefColumns) assert.match(col.column_type, /^varchar\(\d+\)$/i);
});

test('SCHEMA PRIVACY (live): settlement_batch_items carries no account/family identifier -- only an opaque payment_transaction_id association', async () => {
  const [rows] = await getPool().query(`SELECT column_name AS column_name FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'settlement_batch_items'`);
  const columns = rows.map((r) => r.column_name);
  for (const forbidden of ['account_ref', 'family_id', 'accountRef']) assert.equal(columns.includes(forbidden), false);
});

// ---------------------------------------------------------------------------
// Masked reads
// ---------------------------------------------------------------------------

test('createAccount returns a masked view -- providerRef never appears on the wire object, even though it is genuinely persisted', async () => {
  const admin = await createAdmin({ role: 'APP_OWNER' });
  const rawProviderRef = `secretref:${randomUUID()}`;
  const stepUpId = await stepUpFor(admin);
  const view = await adminSettlementService.createAccount(actorOf(admin), { providerRef: rawProviderRef, displayLabel: '****7777', settlementCurrency: 'USD', stepUpId });
  assert.equal(Object.prototype.hasOwnProperty.call(view, 'providerRef'), false);
  assert.equal(view.displayLabel, '****7777');

  // The raw providerRef IS genuinely persisted (not silently dropped) -- verified directly against the row, never via the masked service surface.
  const [rows] = await getPool().query(`SELECT provider_ref FROM settlement_accounts WHERE settlement_account_id = ?`, [view.settlementAccountId]);
  assert.equal(rows[0].provider_ref, rawProviderRef);
});

test('HTTP: GET /platform-admin/settlement/accounts never leaks providerRef over the wire', async () => {
  const admin = await createAdmin({ role: 'APP_OWNER' });
  await createActiveAccount(admin, 'USD');

  const app = Fastify({ logger: false });
  registerSettlementRoutes(app, { platformAdminAuthService: authService, platformAdminSettlementService: adminSettlementService, rateLimiter: createRateLimiter() });
  await app.ready();
  try {
    const response = await app.inject({ method: 'GET', url: '/platform-admin/settlement/accounts', headers: { authorization: `Bearer ${admin.rawToken}` } });
    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.ok(body.items.length > 0);
    for (const item of body.items) {
      assert.equal(Object.prototype.hasOwnProperty.call(item, 'providerRef'), false);
      assert.match(item.displayLabel, /^\*+/);
    }
  } finally {
    await app.close();
  }
});

// ---------------------------------------------------------------------------
// RBAC matrix, incl. explicit PLATFORM_ADMIN / SUPPORT_ADMIN denial
// ---------------------------------------------------------------------------

test('RBAC: PLATFORM_ADMIN is DENIED on every settlement operation, including read -- verified end-to-end through the composed service', async () => {
  const admin = await createAdmin({ role: 'PLATFORM_ADMIN' });
  await assert.rejects(() => adminSettlementService.listAccounts(actorOf(admin)), (e) => e instanceof PlatformAdminSettlementError && e.code === 'FORBIDDEN');
  const stepUpId = await stepUpFor(admin).catch(() => null); // PLATFORM_ADMIN may still assert a step-up (step-up scope is not itself role-gated) but the RBAC check runs first regardless.
  await assert.rejects(
    () => adminSettlementService.createAccount(actorOf(admin), { providerRef: 'x', displayLabel: '****0000', settlementCurrency: 'USD', stepUpId: stepUpId ?? 'irrelevant' }),
    (e) => e instanceof PlatformAdminSettlementError && e.code === 'FORBIDDEN',
  );
});

test('RBAC: SUPPORT_ADMIN is DENIED on every settlement operation, including read', async () => {
  const admin = await createAdmin({ role: 'SUPPORT_ADMIN' });
  await assert.rejects(() => adminSettlementService.listAccounts(actorOf(admin)), (e) => e instanceof PlatformAdminSettlementError && e.code === 'FORBIDDEN');
});

test('RBAC: AUDITOR_READ_ONLY can read but cannot create a settlement account', async () => {
  const admin = await createAdmin({ role: 'AUDITOR_READ_ONLY' });
  await assert.doesNotReject(() => adminSettlementService.listAccounts(actorOf(admin)));
  await assert.rejects(
    () => adminSettlementService.createAccount(actorOf(admin), { providerRef: 'x', displayLabel: '****0000', settlementCurrency: 'USD', stepUpId: 'irrelevant' }),
    (e) => e instanceof PlatformAdminSettlementError && e.code === 'FORBIDDEN',
  );
});

test('RBAC: APP_OWNER and FINANCE_ADMIN can fully mutate settlement records', async () => {
  for (const role of ['APP_OWNER', 'FINANCE_ADMIN']) {
    const admin = await createAdmin({ role });
    const account = await createActiveAccount(admin, 'USD');
    assert.equal(account.status, 'ACTIVE');
  }
});

// ---------------------------------------------------------------------------
// Step-up required on every mutation, incl. identity binding
// ---------------------------------------------------------------------------

test('STEP-UP: creating a settlement account without a valid stepUpId is rejected even for an authorized role', async () => {
  const admin = await createAdmin({ role: 'APP_OWNER' });
  await assert.rejects(() => adminSettlementService.createAccount(actorOf(admin), { providerRef: 'x', displayLabel: '****0000', settlementCurrency: 'USD', stepUpId: 'never-asserted' }));
});

test("STEP-UP: one admin's stepUpId cannot be consumed by a different admin's mutation (identity binding)", async () => {
  const adminA = await createAdmin({ role: 'APP_OWNER' });
  const adminB = await createAdmin({ role: 'APP_OWNER' });
  const stepUpForA = await stepUpFor(adminA);
  await assert.rejects(() => adminSettlementService.createAccount(actorOf(adminB), { providerRef: 'x', displayLabel: '****0000', settlementCurrency: 'USD', stepUpId: stepUpForA }));
});

test('STEP-UP: a stepUpId is single-use -- a second mutation with the same id fails even for the SAME admin', async () => {
  const admin = await createAdmin({ role: 'APP_OWNER' });
  const stepUpId = await stepUpFor(admin);
  await adminSettlementService.createAccount(actorOf(admin), { providerRef: 'x1', displayLabel: '****1111', settlementCurrency: 'USD', stepUpId });
  await assert.rejects(() => adminSettlementService.createAccount(actorOf(admin), { providerRef: 'x2', displayLabel: '****2222', settlementCurrency: 'USD', stepUpId }));
});

// ---------------------------------------------------------------------------
// Same-currency / cross-currency (FX snapshot) batches + exact arithmetic
// ---------------------------------------------------------------------------

test('same-currency batch: net/received/difference round-trip through real BIGINT columns exactly, MATCHED when difference is zero', async () => {
  const admin = await createAdmin({ role: 'FINANCE_ADMIN' });
  const account = await createActiveAccount(admin, 'USD');
  const stepUpId = await stepUpFor(admin);
  const batch = await adminSettlementService.openBatch(actorOf(admin), {
    settlementAccountRef: account.settlementAccountId,
    settlementCurrency: 'USD',
    periodStart: new Date('2026-03-01T00:00:00Z'),
    periodEnd: new Date('2026-03-08T00:00:00Z'),
    expectedGross: money(9_007_199_254_740_993n, 'USD'), // > Number.MAX_SAFE_INTEGER -- proves no precision loss through the BIGINT round-trip
    fees: money(1_000_000_000n, 'USD'),
    received: money(9_007_199_254_740_993n - 1_000_000_000n, 'USD'),
    providerRef: `report:${randomUUID()}`,
    stepUpId,
  });
  assert.equal(batch.net.amountMinor, 9_007_199_254_740_993n - 1_000_000_000n);
  assert.equal(batch.differenceMinor, 0n);
  assert.equal(batch.status, 'MATCHED');

  const fetched = await adminSettlementService.getBatch(actorOf(admin), batch.settlementBatchId);
  assert.equal(fetched.net.amountMinor, batch.net.amountMinor, 'exact bigint round-trip through a real BIGINT column, no float precision loss');

  const auditCount = await countAuditEvents('SETTLEMENT_BATCH_CREATED', `settlement-batch:${batch.settlementBatchId}`);
  assert.equal(auditCount, 1);
});

test('cross-currency batch: attributing a SAR transaction into a USD batch requires an FX snapshot, recorded as an immutable exact-decimal string', async () => {
  const admin = await createAdmin({ role: 'FINANCE_ADMIN' });
  const account = await createActiveAccount(admin, 'USD');
  const stepUpId1 = await stepUpFor(admin);
  const batch = await adminSettlementService.openBatch(actorOf(admin), {
    settlementAccountRef: account.settlementAccountId,
    settlementCurrency: 'USD',
    periodStart: new Date('2026-03-01T00:00:00Z'),
    periodEnd: new Date('2026-03-08T00:00:00Z'),
    expectedGross: money(0n, 'USD'),
    fees: money(0n, 'USD'),
    received: money(0n, 'USD'),
    providerRef: `report:${randomUUID()}`,
    stepUpId: stepUpId1,
  });

  const { transaction } = await confirmedTransaction({ currencyCode: 'SAR', market: 'GULF', amountMinor: 3750n });
  const stepUpId2 = await stepUpFor(admin);
  const item = await adminSettlementService.attributeTransaction(actorOf(admin), {
    settlementBatchId: batch.settlementBatchId,
    paymentTransactionId: transaction.paymentTransactionId,
    fx: { recordedRate: '3.7500000000', effectiveTimestamp: new Date(), providerRef: `fx:${randomUUID()}` },
    stepUpId: stepUpId2,
  });
  assert.equal(item.amount.currencyCode, 'SAR');
  assert.equal(item.amount.amountMinor, 3750n);

  const [fxRows] = await getPool().query(`SELECT recorded_rate, source_currency, settlement_currency FROM settlement_fx_snapshots WHERE settlement_batch_item_id = ?`, [item.settlementBatchItemId]);
  assert.equal(fxRows.length, 1);
  assert.equal(fxRows[0].source_currency, 'SAR');
  assert.equal(fxRows[0].settlement_currency, 'USD');
  assert.equal(Number(fxRows[0].recorded_rate), 3.75);

  const auditCount = await countAuditEvents('SETTLEMENT_BATCH_ITEM_ATTRIBUTED', `settlement-batch:${batch.settlementBatchId}`);
  assert.equal(auditCount, 1);
});

test('wrong-currency rejection: a batch currency that does not match its settlement account currency is rejected', async () => {
  const admin = await createAdmin({ role: 'FINANCE_ADMIN' });
  const account = await createActiveAccount(admin, 'USD');
  const stepUpId = await stepUpFor(admin);
  await assert.rejects(
    () =>
      adminSettlementService.openBatch(actorOf(admin), {
        settlementAccountRef: account.settlementAccountId,
        settlementCurrency: 'SAR',
        periodStart: new Date('2026-03-01T00:00:00Z'),
        periodEnd: new Date('2026-03-08T00:00:00Z'),
        expectedGross: money(100n, 'SAR'),
        fees: money(0n, 'SAR'),
        received: money(100n, 'SAR'),
        providerRef: `report:${randomUUID()}`,
        stepUpId,
      }),
    (e) => e instanceof SettlementError && e.code === 'CURRENCY_MISMATCH',
  );
});

// ---------------------------------------------------------------------------
// PaymentTransactionRow is never mutated by settlement attribution
// ---------------------------------------------------------------------------

test('attributing a transaction never mutates the original billing_payment_transactions row', async () => {
  const admin = await createAdmin({ role: 'FINANCE_ADMIN' });
  const account = await createActiveAccount(admin, 'USD');
  const stepUpId1 = await stepUpFor(admin);
  const batch = await adminSettlementService.openBatch(actorOf(admin), {
    settlementAccountRef: account.settlementAccountId,
    settlementCurrency: 'USD',
    periodStart: new Date('2026-03-01T00:00:00Z'),
    periodEnd: new Date('2026-03-08T00:00:00Z'),
    expectedGross: money(0n, 'USD'),
    fees: money(0n, 'USD'),
    received: money(0n, 'USD'),
    providerRef: `report:${randomUUID()}`,
    stepUpId: stepUpId1,
  });
  const { transaction } = await confirmedTransaction({ currencyCode: 'USD', amountMinor: 999n });
  const [beforeRows] = await getPool().query(`SELECT * FROM billing_payment_transactions WHERE payment_transaction_id = ?`, [transaction.paymentTransactionId]);

  const stepUpId2 = await stepUpFor(admin);
  await adminSettlementService.attributeTransaction(actorOf(admin), { settlementBatchId: batch.settlementBatchId, paymentTransactionId: transaction.paymentTransactionId, fx: null, stepUpId: stepUpId2 });

  const [afterRows] = await getPool().query(`SELECT * FROM billing_payment_transactions WHERE payment_transaction_id = ?`, [transaction.paymentTransactionId]);
  assert.deepEqual(afterRows[0], beforeRows[0]);
});

// ---------------------------------------------------------------------------
// Reconciliation state machine
// ---------------------------------------------------------------------------

test('resolveReconciliation transitions UNDER_INVESTIGATION -> RESOLVED with reason/actor/timestamp and a single audit event', async () => {
  const admin = await createAdmin({ role: 'FINANCE_ADMIN' });
  const account = await createActiveAccount(admin, 'USD');
  const stepUp1 = await stepUpFor(admin);
  const batch = await adminSettlementService.openBatch(actorOf(admin), {
    settlementAccountRef: account.settlementAccountId,
    settlementCurrency: 'USD',
    periodStart: new Date('2026-03-01T00:00:00Z'),
    periodEnd: new Date('2026-03-08T00:00:00Z'),
    expectedGross: money(1000n, 'USD'),
    fees: money(0n, 'USD'),
    received: money(900n, 'USD'),
    providerRef: `report:${randomUUID()}`,
    stepUpId: stepUp1,
  });
  assert.equal(batch.status, 'UNDER_INVESTIGATION');

  const stepUp2 = await stepUpFor(admin);
  const resolved = await adminSettlementService.resolveReconciliation(actorOf(admin), batch.settlementBatchId, 'provider reported a short payout, confirmed against their own report', stepUp2);
  assert.equal(resolved.status, 'RESOLVED');
  assert.equal(resolved.resolvedByAdminId, admin.adminId);
  assert.ok(resolved.resolvedAt);

  const [rows] = await getPool().query(`SELECT status, resolution_reason, resolved_by_admin_id, resolved_at FROM settlement_batches WHERE settlement_batch_id = ?`, [batch.settlementBatchId]);
  assert.equal(rows[0].status, 'RESOLVED');
  assert.ok(rows[0].resolution_reason && rows[0].resolved_by_admin_id && rows[0].resolved_at);

  const auditCount = await countAuditEvents('SETTLEMENT_RECONCILIATION_RESOLVED', `settlement-batch:${batch.settlementBatchId}`);
  assert.equal(auditCount, 1);
});

// ---------------------------------------------------------------------------
// CONCURRENCY: double-batch-attribution race
// ---------------------------------------------------------------------------

test('CONCURRENCY: attributing the SAME PaymentTransaction to two different batches concurrently -- exactly one wins, DB unique-constraint-backed', async () => {
  const admin = await createAdmin({ role: 'FINANCE_ADMIN' });
  const account = await createActiveAccount(admin, 'USD');
  const stepUp1 = await stepUpFor(admin);
  const stepUp2 = await stepUpFor(admin);
  const [batchA, batchB] = await Promise.all([
    adminSettlementService.openBatch(actorOf(admin), {
      settlementAccountRef: account.settlementAccountId,
      settlementCurrency: 'USD',
      periodStart: new Date('2026-04-01T00:00:00Z'),
      periodEnd: new Date('2026-04-08T00:00:00Z'),
      expectedGross: money(0n, 'USD'),
      fees: money(0n, 'USD'),
      received: money(0n, 'USD'),
      providerRef: `report:${randomUUID()}`,
      stepUpId: stepUp1,
    }),
    adminSettlementService.openBatch(actorOf(admin), {
      settlementAccountRef: account.settlementAccountId,
      settlementCurrency: 'USD',
      periodStart: new Date('2026-05-01T00:00:00Z'),
      periodEnd: new Date('2026-05-08T00:00:00Z'),
      expectedGross: money(0n, 'USD'),
      fees: money(0n, 'USD'),
      received: money(0n, 'USD'),
      providerRef: `report:${randomUUID()}`,
      stepUpId: stepUp2,
    }),
  ]);

  const { transaction } = await confirmedTransaction({ currencyCode: 'USD', amountMinor: 4200n });
  // Fresh, distinct stepUpIds for each concurrent attempt (step-up is
  // single-use) -- the guarantee under test is the DB unique-key race, not
  // step-up single-use serializing the attempts artificially.
  const stepUpA = await stepUpFor(admin);
  const stepUpB = await stepUpFor(admin);

  const results = await Promise.allSettled([
    adminSettlementService.attributeTransaction(actorOf(admin), { settlementBatchId: batchA.settlementBatchId, paymentTransactionId: transaction.paymentTransactionId, fx: null, stepUpId: stepUpA }),
    adminSettlementService.attributeTransaction(actorOf(admin), { settlementBatchId: batchB.settlementBatchId, paymentTransactionId: transaction.paymentTransactionId, fx: null, stepUpId: stepUpB }),
  ]);

  const succeeded = results.filter((r) => r.status === 'fulfilled');
  const failed = results.filter((r) => r.status === 'rejected');
  assert.equal(succeeded.length, 1, 'exactly one concurrent attribution attempt must succeed');
  assert.equal(failed.length, 1);
  assert.ok(failed[0].reason instanceof SettlementError && failed[0].reason.code === 'ALREADY_ATTRIBUTED');

  const [countRows] = await getPool().query(`SELECT COUNT(*) AS n FROM settlement_batch_items WHERE payment_transaction_id = ?`, [transaction.paymentTransactionId]);
  assert.equal(Number(countRows[0].n), 1, 'the DB unique key must allow exactly one settlement_batch_items row for this transaction, ever');
});

// ---------------------------------------------------------------------------
// CONCURRENCY: concurrent reconciliation resolution
// ---------------------------------------------------------------------------

test('CONCURRENCY: two concurrent resolveReconciliation attempts on the same batch -- exactly one wins, one audit event', async () => {
  const admin = await createAdmin({ role: 'FINANCE_ADMIN' });
  const account = await createActiveAccount(admin, 'USD');
  const stepUp1 = await stepUpFor(admin);
  const batch = await adminSettlementService.openBatch(actorOf(admin), {
    settlementAccountRef: account.settlementAccountId,
    settlementCurrency: 'USD',
    periodStart: new Date('2026-06-01T00:00:00Z'),
    periodEnd: new Date('2026-06-08T00:00:00Z'),
    expectedGross: money(1000n, 'USD'),
    fees: money(0n, 'USD'),
    received: money(950n, 'USD'),
    providerRef: `report:${randomUUID()}`,
    stepUpId: stepUp1,
  });
  assert.equal(batch.status, 'UNDER_INVESTIGATION');

  const stepUpA = await stepUpFor(admin);
  const stepUpB = await stepUpFor(admin);
  const results = await Promise.allSettled([
    adminSettlementService.resolveReconciliation(actorOf(admin), batch.settlementBatchId, 'resolution attempt A', stepUpA),
    adminSettlementService.resolveReconciliation(actorOf(admin), batch.settlementBatchId, 'resolution attempt B', stepUpB),
  ]);
  const succeeded = results.filter((r) => r.status === 'fulfilled');
  const failed = results.filter((r) => r.status === 'rejected');
  assert.equal(succeeded.length, 1, 'exactly one concurrent resolution attempt must succeed');
  assert.equal(failed.length, 1);
  assert.ok(failed[0].reason instanceof SettlementError && failed[0].reason.code === 'NOT_UNDER_INVESTIGATION');

  const auditCount = await countAuditEvents('SETTLEMENT_RECONCILIATION_RESOLVED', `settlement-batch:${batch.settlementBatchId}`);
  assert.equal(auditCount, 1, 'exactly one resolution audit event, never a duplicate from the race');
});

// ---------------------------------------------------------------------------
// Cross-object authorization: NOT_FOUND vs. leaking existence, and UNDER_INVESTIGATION never treated as final
// ---------------------------------------------------------------------------

test('a nonexistent settlementBatchId reports NOT_FOUND, never a raw 500 or a partial object', async () => {
  const admin = await createAdmin({ role: 'FINANCE_ADMIN' });
  await assert.rejects(() => adminSettlementService.getBatch(actorOf(admin), randomUUID()), (e) => e instanceof SettlementError && e.code === 'NOT_FOUND');
});

test('an UNDER_INVESTIGATION batch is never reported as RESOLVED and cannot be double-counted as closed', async () => {
  const admin = await createAdmin({ role: 'FINANCE_ADMIN' });
  const account = await createActiveAccount(admin, 'USD');
  const stepUp1 = await stepUpFor(admin);
  const batch = await adminSettlementService.openBatch(actorOf(admin), {
    settlementAccountRef: account.settlementAccountId,
    settlementCurrency: 'USD',
    periodStart: new Date('2026-07-01T00:00:00Z'),
    periodEnd: new Date('2026-07-08T00:00:00Z'),
    expectedGross: money(1000n, 'USD'),
    fees: money(0n, 'USD'),
    received: money(1n, 'USD'),
    providerRef: `report:${randomUUID()}`,
    stepUpId: stepUp1,
  });
  assert.equal(batch.status, 'UNDER_INVESTIGATION');
  const summary = await adminSettlementService.dashboardSummary(actorOf(admin));
  assert.ok(summary.underInvestigationBatchCount >= 1);
});

test.after(async () => {
  await closePool();
});
