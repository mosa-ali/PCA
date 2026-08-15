// PCA-ADD-BILL-026 (Writer65) -- runtime/diagnostic-output absence proof,
// the counterpart to schemaPrivacy.test.mjs's DB-schema absence check
// (billingCoreSchemaPrivacy.mysql.test.mjs's PROHIBITED_TERMS list, reused
// here verbatim plus payment/settlement-specific terms). Two layers:
//
// 1. STATIC: no `backend/src/billing/**` (or the settlement subdomain
//    within it, or its platformadmin-facing services) source file contains
//    a console.*/`.log(`-style call that references a forbidden
//    field/variable name (password, secret, providerRef, cardNumber, cvv,
//    pin, token, ...). Comments are stripped first so this only catches
//    real code, mirroring
//    settlement.mysql.test.mjs's SCHEMA PRIVACY (static) test's own
//    comment-stripping discipline.
// 2. RUNTIME: console.log/warn/error/info/debug are monkey-patched while a
//    representative billing flow runs (settlement account creation with a
//    real secret-shaped providerRef, a batch open/attribute/resolve cycle)
//    against an in-memory fake repository -- proving BEHAVIORALLY, not
//    just by absence-of-call-sites, that a known-sensitive value never
//    reaches stdout/stderr through any code path this flow exercises.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readdirSync, statSync } from 'node:fs';
import { SettlementService } from '../../dist/billing/settlement/SettlementService.js';
import { money } from '../../dist/billing/money.js';

// ---------------------------------------------------------------------------
// 1. STATIC: grep every backend/src/billing/** (and platformadmin/settlement,
//    platformadmin/settings -- the sibling PlatformAdmin-facing surfaces
//    this lane added, which also handle secret-shaped values) .ts file for
//    a console/logger call whose arguments reference a forbidden term.
// ---------------------------------------------------------------------------

const FORBIDDEN_LOG_TERMS = [
  'password', 'pin', 'privateKey', 'private_key', 'recoverySecret', 'apiKey', 'apiSecret', 'clientSecret',
  'cardNumber', 'cvv', 'cvc', 'pan', 'accountNumber', 'routingNumber', 'magneticStripe', 'trackData', 'chipData',
  'providerRef', 'rawToken', 'rawValue', 'valueJson',
];

function walkTsFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = `${dir}/${entry}`;
    const stat = statSync(full);
    if (stat.isDirectory()) out.push(...walkTsFiles(full));
    else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) out.push(full);
  }
  return out;
}

function stripComments(source) {
  return source
    .split('\n')
    .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*') && !line.trim().startsWith('/**'))
    .join('\n');
}

const SCAN_ROOTS = [
  fileURLToPath(new URL('../../src/billing/', import.meta.url)),
  fileURLToPath(new URL('../../src/platformadmin/settlement/', import.meta.url)),
  fileURLToPath(new URL('../../src/platformadmin/settings/', import.meta.url)),
];

test('STATIC: no billing/settlement/settings source file logs (console.* or a `.log(` call) a forbidden sensitive-field-shaped argument', () => {
  const consoleCallPattern = /console\.(log|warn|error|info|debug)\s*\(([^;]*)\)/gs;
  let scannedFiles = 0;
  for (const root of SCAN_ROOTS) {
    for (const file of walkTsFiles(root)) {
      scannedFiles += 1;
      const source = stripComments(readFileSync(file, 'utf8'));
      let match;
      while ((match = consoleCallPattern.exec(source)) !== null) {
        const args = match[2];
        for (const term of FORBIDDEN_LOG_TERMS) {
          const identifierPattern = new RegExp(`\\b${term}\\b`, 'i');
          assert.equal(identifierPattern.test(args), false, `${file} logs a forbidden term "${term}" inside a console.* call: ${match[0].slice(0, 200)}`);
        }
      }
    }
  }
  assert.ok(scannedFiles > 10, `expected to scan more than 10 files, scanned ${scannedFiles}`);
});

// ---------------------------------------------------------------------------
// 2. RUNTIME: monkey-patch console.* and run a representative flow carrying
//    a known secret-shaped value; assert it never appears in captured output.
// ---------------------------------------------------------------------------

function fakeConn() {
  return { query: async () => [[]] };
}

class FakeSettlementRepository {
  constructor() {
    this.accounts = new Map();
    this.batches = new Map();
    this.items = [];
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
      received: input.received,
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
  async tryResolveBatch(_conn, id, reason, adminId, now) {
    const existing = this.batches.get(id);
    if (!existing || existing.status !== 'UNDER_INVESTIGATION') return { applied: false, record: null };
    const updated = { ...existing, status: 'RESOLVED', resolutionReason: reason, resolvedByAdminId: adminId, resolvedAt: now, updatedAt: now };
    this.batches.set(id, updated);
    return { applied: true, record: updated };
  }
  async tryAttributeTransaction(_conn, input, itemId, _fxSnapshotId, now) {
    if (this.attributed.has(input.paymentTransactionId)) return { applied: false, item: null };
    this.attributed.add(input.paymentTransactionId);
    const item = { settlementBatchItemId: itemId, settlementBatchId: input.settlementBatchId, paymentTransactionId: input.paymentTransactionId, amount: input.amount, createdAt: now };
    this.items.push(item);
    return { applied: true, item };
  }
  async listItemsForBatch(_conn, batchId) {
    return this.items.filter((i) => i.settlementBatchId === batchId);
  }
  async getFxSnapshotForItem() {
    return null;
  }
  async isTransactionAlreadyAttributed(_conn, id) {
    return this.attributed.has(id);
  }
  async dashboardSummary() {
    return { matchedBatchCount: 0, underInvestigationBatchCount: 0, resolvedBatchCount: 0, byCurrency: [] };
  }
  async accountHealthSummary() {
    return [];
  }
  async tryRecordUsdNormalization() {
    return { applied: false, record: null };
  }
  async usdRollup() {
    return { totalNetUsdMinor: '0', totalReceivedUsdMinor: '0', includedBatchCount: 0, excludedForMissingRateBatchCount: 0 };
  }
}

class FakePaymentRepository {
  async findTransactionById() {
    return null;
  }
}

test('RUNTIME: a real Settlement domain flow carrying a secret-shaped providerRef never reaches console.log/warn/error/info/debug', async () => {
  const originals = { log: console.log, warn: console.warn, error: console.error, info: console.info, debug: console.debug };
  const captured = [];
  const capture = (...args) => captured.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
  console.log = capture;
  console.warn = capture;
  console.error = capture;
  console.info = capture;
  console.debug = capture;

  const secretShapedProviderRef = `secretref:${randomUUID()}-DO-NOT-LOG-ME`;
  try {
    const repository = new FakeSettlementRepository();
    const service = new SettlementService(repository, new FakePaymentRepository(), async (fn) => fn(fakeConn()));
    const actor = { adminId: 'admin-1', role: 'FINANCE_ADMIN' };

    const account = await service.createAccount({ providerRef: secretShapedProviderRef, displayLabel: '****9999', settlementCurrency: 'USD' }, actor, new Date());
    const batch = await service.openBatch(
      {
        settlementAccountRef: account.settlementAccountId,
        settlementCurrency: 'USD',
        periodStart: new Date('2026-01-01T00:00:00Z'),
        periodEnd: new Date('2026-01-08T00:00:00Z'),
        expectedGross: money(1000n, 'USD'),
        fees: money(0n, 'USD'),
        received: money(900n, 'USD'),
        providerRef: secretShapedProviderRef,
        createdByAdminId: 'admin-1',
      },
      actor,
      new Date(),
    );
    assert.equal(batch.status, 'UNDER_INVESTIGATION');
    await service.resolveReconciliation(batch.settlementBatchId, 'investigated and closed', actor, new Date());
    await service.usdRollup();
    await service.dashboardSummary();
  } finally {
    console.log = originals.log;
    console.warn = originals.warn;
    console.error = originals.error;
    console.info = originals.info;
    console.debug = originals.debug;
  }

  assert.equal(captured.length, 0, `expected zero console output from this flow, got: ${JSON.stringify(captured)}`);
  for (const line of captured) {
    assert.equal(line.includes(secretShapedProviderRef), false, 'the secret-shaped providerRef must never appear in any log line');
  }
});
