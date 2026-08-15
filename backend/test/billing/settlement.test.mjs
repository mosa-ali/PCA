// PCA-BILL-3 (Writer62, Round6): non-DB unit tests for the Settlement /
// Reconciliation domain (SETTLEMENT_RECONCILIATION_V1). Exercises
// SettlementService's exact bigint arithmetic, reconciliation state
// machine, double-attribution guard, and currency/FX validation against an
// in-memory fake repository (mirrors ComplimentaryEntitlementService's
// injectable `runTx` pattern) -- no live database required. Real-MySQL
// concurrency/schema-privacy/RBAC-matrix/step-up proofs live in
// test/db/settlement.mysql.test.mjs.
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { SettlementService } from '../../dist/billing/settlement/SettlementService.js';
import { SettlementError } from '../../dist/billing/settlement/types.js';
import { money } from '../../dist/billing/money.js';
import { PlatformAdminSettlementService, PlatformAdminSettlementError } from '../../dist/platformadmin/settlement/PlatformAdminSettlementService.js';

// insertPlatformAdminAuditEventRow (called by SettlementService inside its
// own transaction, mirroring ComplimentaryEntitlementService's pattern)
// issues a raw execute(conn, ...) call that bypasses the fake repository
// entirely -- this stub conn satisfies that INSERT with a no-op success
// response so the audit write inside the transaction doesn't throw.
function fakeConn() {
  return { query: async () => [[]] };
}

function fakeRunTx() {
  const conn = fakeConn();
  return async (fn) => fn(conn);
}

class FakeSettlementRepository {
  constructor() {
    this.accounts = new Map();
    this.batches = new Map();
    this.items = [];
    this.fx = new Map();
    this.attributed = new Set();
  }

  async createAccount(_conn, input, id, now) {
    const rec = { settlementAccountId: id, providerRef: input.providerRef, displayLabel: input.displayLabel, settlementCurrency: input.settlementCurrency, status: 'ACTIVE', createdAt: now, updatedAt: now };
    this.accounts.set(id, rec);
    return rec;
  }
  async getAccountById(_conn, id) {
    return this.accounts.get(id) ?? null;
  }
  async lockAccountById(conn, id) {
    return this.getAccountById(conn, id);
  }
  async listAccounts() {
    return [...this.accounts.values()];
  }
  async setAccountStatus(_conn, id, status, now) {
    const existing = this.accounts.get(id);
    if (!existing) return null;
    const updated = { ...existing, status, updatedAt: now };
    this.accounts.set(id, updated);
    return updated;
  }

  async openBatch(_conn, input, id, receivedMinor, netMinor, differenceMinor, status, now) {
    const rec = {
      settlementBatchId: id,
      settlementAccountRef: input.settlementAccountRef,
      settlementCurrency: input.settlementCurrency,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      expectedGross: input.expectedGross,
      fees: input.fees,
      net: money(netMinor, input.settlementCurrency),
      received: money(receivedMinor, input.settlementCurrency),
      differenceMinor,
      status,
      providerRef: input.providerRef,
      resolutionReason: null,
      resolvedByAdminId: null,
      resolvedAt: null,
      createdByAdminId: input.createdByAdminId,
      createdAt: now,
      updatedAt: now,
    };
    this.batches.set(id, rec);
    return rec;
  }
  async getBatchById(_conn, id) {
    return this.batches.get(id) ?? null;
  }
  async lockBatchById(conn, id) {
    return this.getBatchById(conn, id);
  }
  async listBatchesForAccount(_conn, ref) {
    return [...this.batches.values()].filter((b) => b.settlementAccountRef === ref);
  }
  async listAllBatches() {
    return [...this.batches.values()];
  }
  async tryResolveBatch(_conn, id, reason, resolvedByAdminId, now) {
    const existing = this.batches.get(id);
    if (!existing || existing.status !== 'UNDER_INVESTIGATION') return { applied: false, record: existing ?? null };
    const updated = { ...existing, status: 'RESOLVED', resolutionReason: reason, resolvedByAdminId, resolvedAt: now, updatedAt: now };
    this.batches.set(id, updated);
    return { applied: true, record: updated };
  }

  async tryAttributeTransaction(_conn, input, itemId, fxSnapshotId, now) {
    if (this.attributed.has(input.paymentTransactionId)) return { applied: false, item: null };
    this.attributed.add(input.paymentTransactionId);
    const item = { settlementBatchItemId: itemId, settlementBatchId: input.settlementBatchId, paymentTransactionId: input.paymentTransactionId, amount: input.amount, createdAt: now };
    this.items.push(item);
    if (input.fxSnapshot && fxSnapshotId) {
      this.fx.set(itemId, { settlementFxSnapshotId: fxSnapshotId, settlementBatchItemId: itemId, ...input.fxSnapshot, createdAt: now });
    }
    return { applied: true, item };
  }
  async listItemsForBatch(_conn, batchId) {
    return this.items.filter((i) => i.settlementBatchId === batchId);
  }
  async getFxSnapshotForItem(_conn, itemId) {
    return this.fx.get(itemId) ?? null;
  }
  async isTransactionAlreadyAttributed(_conn, txId) {
    return this.attributed.has(txId);
  }
  async dashboardSummary() {
    const counts = { MATCHED: 0, UNDER_INVESTIGATION: 0, RESOLVED: 0 };
    for (const b of this.batches.values()) counts[b.status]++;
    return { matchedBatchCount: counts.MATCHED, underInvestigationBatchCount: counts.UNDER_INVESTIGATION, resolvedBatchCount: counts.RESOLVED, byCurrency: [] };
  }
}

class FakePaymentRepository {
  constructor() {
    this.transactions = new Map();
  }
  addTransaction(tx) {
    this.transactions.set(tx.paymentTransactionId, tx);
  }
  async findTransactionById(_conn, id) {
    return this.transactions.get(id) ?? null;
  }
}

function makeService() {
  const repo = new FakeSettlementRepository();
  const paymentRepo = new FakePaymentRepository();
  const service = new SettlementService(repo, paymentRepo, fakeRunTx());
  return { repo, paymentRepo, service };
}

function actorOf() {
  return { adminId: 'admin-1', role: 'FINANCE_ADMIN' };
}

async function openAccount(service, currency = 'USD') {
  return service.createAccount({ providerRef: 'ref:acct:1', displayLabel: '****1234', settlementCurrency: currency }, actorOf(), new Date());
}

// ---------------------------------------------------------------------------
// Exact bigint arithmetic / reconciliation classification
// ---------------------------------------------------------------------------

test('net = expectedGross - fees and difference = received - net, exact bigint, MATCHED when difference is zero', async () => {
  const { service } = makeService();
  const account = await openAccount(service);
  const batch = await service.openBatch(
    {
      settlementAccountRef: account.settlementAccountId,
      settlementCurrency: 'USD',
      periodStart: new Date('2026-01-01'),
      periodEnd: new Date('2026-01-08'),
      expectedGross: money(10_000n, 'USD'),
      fees: money(300n, 'USD'),
      received: money(9_700n, 'USD'),
      providerRef: 'ref:batch:1',
      createdByAdminId: 'admin-1',
    },
    actorOf(),
    new Date(),
  );
  assert.equal(batch.net.amountMinor, 9_700n);
  assert.equal(batch.differenceMinor, 0n);
  assert.equal(batch.status, 'MATCHED');
});

test('a nonzero received-net difference produces UNDER_INVESTIGATION, and the difference is exact (can be negative)', async () => {
  const { service } = makeService();
  const account = await openAccount(service);
  const batch = await service.openBatch(
    {
      settlementAccountRef: account.settlementAccountId,
      settlementCurrency: 'USD',
      periodStart: new Date('2026-01-01'),
      periodEnd: new Date('2026-01-08'),
      expectedGross: money(10_000n, 'USD'),
      fees: money(300n, 'USD'),
      received: money(9_600n, 'USD'), // net=9700, received short by 100
      providerRef: 'ref:batch:2',
      createdByAdminId: 'admin-1',
    },
    actorOf(),
    new Date(),
  );
  assert.equal(batch.differenceMinor, -100n);
  assert.equal(batch.status, 'UNDER_INVESTIGATION');
});

test('openBatch rejects a currency mismatch between the batch and its settlement account', async () => {
  const { service } = makeService();
  const account = await openAccount(service, 'USD');
  await assert.rejects(
    () =>
      service.openBatch(
        {
          settlementAccountRef: account.settlementAccountId,
          settlementCurrency: 'SAR',
          periodStart: new Date('2026-01-01'),
          periodEnd: new Date('2026-01-08'),
          expectedGross: money(1000n, 'SAR'),
          fees: money(0n, 'SAR'),
          received: money(1000n, 'SAR'),
          providerRef: 'ref:batch:3',
          createdByAdminId: 'admin-1',
        },
        actorOf(),
        new Date(),
      ),
    (err) => err instanceof SettlementError && err.code === 'CURRENCY_MISMATCH',
  );
});

test('openBatch rejects an INACTIVE settlement account', async () => {
  const { service } = makeService();
  const account = await openAccount(service);
  await service.setAccountStatus(account.settlementAccountId, 'INACTIVE', actorOf(), new Date());
  await assert.rejects(
    () =>
      service.openBatch(
        {
          settlementAccountRef: account.settlementAccountId,
          settlementCurrency: 'USD',
          periodStart: new Date('2026-01-01'),
          periodEnd: new Date('2026-01-08'),
          expectedGross: money(1000n, 'USD'),
          fees: money(0n, 'USD'),
          received: money(1000n, 'USD'),
          providerRef: 'ref:batch:4',
          createdByAdminId: 'admin-1',
        },
        actorOf(),
        new Date(),
      ),
    (err) => err instanceof SettlementError && err.code === 'ACCOUNT_INACTIVE',
  );
});

// ---------------------------------------------------------------------------
// Attribution / double-attribution / FX
// ---------------------------------------------------------------------------

async function openBasicBatch(service, account) {
  return service.openBatch(
    {
      settlementAccountRef: account.settlementAccountId,
      settlementCurrency: 'USD',
      periodStart: new Date('2026-01-01'),
      periodEnd: new Date('2026-01-08'),
      expectedGross: money(0n, 'USD'),
      fees: money(0n, 'USD'),
      received: money(0n, 'USD'),
      providerRef: 'ref:batch',
      createdByAdminId: 'admin-1',
    },
    actorOf(),
    new Date(),
  );
}

test('attributeTransaction snapshots the PaymentTransaction amount and never allows a second attribution of the same transaction', async () => {
  const { service, paymentRepo } = makeService();
  const account = await openAccount(service);
  const batch = await openBasicBatch(service, account);
  const txId = randomUUID();
  paymentRepo.addTransaction({ paymentTransactionId: txId, price: money(500n, 'USD'), provider: 'TEST_SANDBOX', providerTransactionRef: 'tx-ref' });

  const item = await service.attributeTransaction({ settlementBatchId: batch.settlementBatchId, paymentTransactionId: txId, fx: null }, actorOf(), new Date());
  assert.equal(item.amount.amountMinor, 500n);

  await assert.rejects(
    () => service.attributeTransaction({ settlementBatchId: batch.settlementBatchId, paymentTransactionId: txId, fx: null }, actorOf(), new Date()),
    (err) => err instanceof SettlementError && err.code === 'ALREADY_ATTRIBUTED',
  );
});

test('cross-currency attribution requires an FX snapshot; same-currency attribution forbids one', async () => {
  const { service, paymentRepo } = makeService();
  const account = await openAccount(service, 'USD');
  const batch = await openBasicBatch(service, account);

  const sarTxId = randomUUID();
  paymentRepo.addTransaction({ paymentTransactionId: sarTxId, price: money(1000n, 'SAR'), provider: 'TEST_SANDBOX', providerTransactionRef: 'tx-sar' });
  await assert.rejects(
    () => service.attributeTransaction({ settlementBatchId: batch.settlementBatchId, paymentTransactionId: sarTxId, fx: null }, actorOf(), new Date()),
    (err) => err instanceof SettlementError && err.code === 'FX_SNAPSHOT_REQUIRED',
  );
  const item = await service.attributeTransaction(
    { settlementBatchId: batch.settlementBatchId, paymentTransactionId: sarTxId, fx: { recordedRate: '3.7500000000', effectiveTimestamp: new Date(), providerRef: 'ref:fx:1' } },
    actorOf(),
    new Date(),
  );
  assert.equal(item.amount.currencyCode, 'SAR');

  const usdTxId = randomUUID();
  paymentRepo.addTransaction({ paymentTransactionId: usdTxId, price: money(200n, 'USD'), provider: 'TEST_SANDBOX', providerTransactionRef: 'tx-usd' });
  await assert.rejects(
    () =>
      service.attributeTransaction(
        { settlementBatchId: batch.settlementBatchId, paymentTransactionId: usdTxId, fx: { recordedRate: '1.0', effectiveTimestamp: new Date(), providerRef: 'ref:fx:2' } },
        actorOf(),
        new Date(),
      ),
    (err) => err instanceof SettlementError && err.code === 'FX_SNAPSHOT_NOT_ALLOWED',
  );
});

test('attributeTransaction rejects an unknown PaymentTransactionId', async () => {
  const { service } = makeService();
  const account = await openAccount(service);
  const batch = await openBasicBatch(service, account);
  await assert.rejects(
    () => service.attributeTransaction({ settlementBatchId: batch.settlementBatchId, paymentTransactionId: randomUUID(), fx: null }, actorOf(), new Date()),
    (err) => err instanceof SettlementError && err.code === 'NOT_FOUND',
  );
});

// ---------------------------------------------------------------------------
// Reconciliation state machine
// ---------------------------------------------------------------------------

test('resolveReconciliation rejects a MATCHED batch (nothing to resolve) and succeeds only from UNDER_INVESTIGATION', async () => {
  const { service } = makeService();
  const account = await openAccount(service);
  const matched = await service.openBatch(
    {
      settlementAccountRef: account.settlementAccountId,
      settlementCurrency: 'USD',
      periodStart: new Date('2026-01-01'),
      periodEnd: new Date('2026-01-08'),
      expectedGross: money(500n, 'USD'),
      fees: money(0n, 'USD'),
      received: money(500n, 'USD'),
      providerRef: 'ref:matched',
      createdByAdminId: 'admin-1',
    },
    actorOf(),
    new Date(),
  );
  assert.equal(matched.status, 'MATCHED');
  await assert.rejects(
    () => service.resolveReconciliation(matched.settlementBatchId, 'investigated', actorOf(), new Date()),
    (err) => err instanceof SettlementError && err.code === 'NOT_UNDER_INVESTIGATION',
  );

  const investigated = await service.openBatch(
    {
      settlementAccountRef: account.settlementAccountId,
      settlementCurrency: 'USD',
      periodStart: new Date('2026-02-01'),
      periodEnd: new Date('2026-02-08'),
      expectedGross: money(500n, 'USD'),
      fees: money(0n, 'USD'),
      received: money(450n, 'USD'),
      providerRef: 'ref:investigated',
      createdByAdminId: 'admin-1',
    },
    actorOf(),
    new Date(),
  );
  assert.equal(investigated.status, 'UNDER_INVESTIGATION');
  const resolved = await service.resolveReconciliation(investigated.settlementBatchId, 'provider fee adjustment confirmed', actorOf(), new Date());
  assert.equal(resolved.status, 'RESOLVED');
  assert.equal(resolved.resolutionReason, 'provider fee adjustment confirmed');
  assert.equal(resolved.resolvedByAdminId, 'admin-1');
  assert.ok(resolved.resolvedAt instanceof Date);

  // A batch already RESOLVED can never be resolved again.
  await assert.rejects(
    () => service.resolveReconciliation(investigated.settlementBatchId, 'again', actorOf(), new Date()),
    (err) => err instanceof SettlementError && err.code === 'NOT_UNDER_INVESTIGATION',
  );
});

// ---------------------------------------------------------------------------
// Platform Admin masking + RBAC composition (fakes PlatformAdminAuthService)
// ---------------------------------------------------------------------------

function fakeAuthService() {
  return { consumeStepUp: async () => {} };
}

test('SettlementAccountView never carries providerRef -- masked-only read at the Platform Admin layer', async () => {
  const { service } = makeService();
  const adminSettlement = new PlatformAdminSettlementService(fakeAuthService(), service, () => new Date());
  const actor = { adminId: 'admin-1', roles: ['FINANCE_ADMIN'], sessionId: 'session-1' };
  const view = await adminSettlement.createAccount(actor, { providerRef: 'super-secret-bank-ref', displayLabel: '****9999', settlementCurrency: 'USD', stepUpId: 'step-up-1' });
  assert.equal(view.displayLabel, '****9999');
  assert.equal(Object.prototype.hasOwnProperty.call(view, 'providerRef'), false, 'providerRef must never appear on a Settlement Account view');
});

test('PLATFORM_ADMIN and SUPPORT_ADMIN are denied on every settlement operation, including read, at the composed Platform Admin service', async () => {
  const { service } = makeService();
  const adminSettlement = new PlatformAdminSettlementService(fakeAuthService(), service, () => new Date());
  for (const role of ['PLATFORM_ADMIN', 'SUPPORT_ADMIN']) {
    const actor = { adminId: 'admin-x', roles: [role], sessionId: 'session-x' };
    await assert.rejects(() => adminSettlement.listAccounts(actor), (err) => err instanceof PlatformAdminSettlementError && err.code === 'FORBIDDEN');
    await assert.rejects(
      () => adminSettlement.createAccount(actor, { providerRef: 'ref', displayLabel: '****0000', settlementCurrency: 'USD', stepUpId: 'x' }),
      (err) => err instanceof PlatformAdminSettlementError && err.code === 'FORBIDDEN',
    );
  }
});

test('AUDITOR_READ_ONLY can read settlement records but cannot mutate them', async () => {
  const { service } = makeService();
  const adminSettlement = new PlatformAdminSettlementService(fakeAuthService(), service, () => new Date());
  const readActor = { adminId: 'auditor-1', roles: ['AUDITOR_READ_ONLY'], sessionId: 'session-a' };
  await assert.doesNotReject(() => adminSettlement.listAccounts(readActor));
  await assert.rejects(
    () => adminSettlement.createAccount(readActor, { providerRef: 'ref', displayLabel: '****0000', settlementCurrency: 'USD', stepUpId: 'x' }),
    (err) => err instanceof PlatformAdminSettlementError && err.code === 'FORBIDDEN',
  );
});
