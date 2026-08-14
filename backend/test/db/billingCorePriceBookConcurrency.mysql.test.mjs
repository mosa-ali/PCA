// Constraint 7/8: effective-period ambiguity is structurally impossible and
// price-book publication concurrency is release-blocking-correct. Two
// independent DB connections attempt to publish conflicting overlapping
// prices for the same commercial key (commercialMarket, currencyCode,
// targetDeviceLimit); the system must end in a deterministic,
// non-ambiguous state -- exactly one open ACTIVE row survives, never two.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { closePool, getPool } from '../../dist/db/pool.js';
import { PriceBookService, PriceBookRepository, PriceBookPublicationConflictError } from '../../dist/billing/priceBook.js';
import { PlatformAdminAccountService } from '../../dist/platformadmin/auth/PlatformAdminAccountService.js';
import { MySqlPlatformAdminAuthRepository } from '../../dist/platformadmin/auth/MySqlAuthRepository.js';
import { PlatformAdminAuditService } from '../../dist/platformadmin/audit/PlatformAdminAuditService.js';
import { MySqlPlatformAdminAuditRepository } from '../../dist/platformadmin/audit/MySqlPlatformAdminAuditRepository.js';
import { hashAdminEmail } from '../../dist/platformadmin/auth/emailHash.js';

if (!process.env.PCA_DATABASE_URL) throw new Error('PCA_DATABASE_URL is required for backend/test/db tests.');

function uniqueEmail(label) {
  return `${label}-${randomUUID()}@example.test`;
}

async function createAdmin(role = 'FINANCE_ADMIN') {
  const accountService = new PlatformAdminAccountService(new MySqlPlatformAdminAuthRepository());
  const account = await accountService.createAccount('DB Test Admin', hashAdminEmail(uniqueEmail('admin')), 'password-value', role, 'BOOTSTRAP');
  return account.adminId;
}

function buildService() {
  const auditService = new PlatformAdminAuditService(new MySqlPlatformAdminAuditRepository());
  return new PriceBookService(new PriceBookRepository(), auditService);
}

test('MySQL CONCURRENCY: two connections racing to publish for the SAME commercial key never both land an open ACTIVE row', async () => {
  const adminId = await createAdmin();
  const actor = { adminId, role: 'FINANCE_ADMIN' };
  const roles = ['FINANCE_ADMIN'];
  const service = buildService();

  const input = { commercialMarket: 'YEMEN', currencyCode: 'YER', targetDeviceLimit: 900 + Math.floor(Math.random() * 100000) };

  const results = await Promise.allSettled([
    service.publishPrice({ ...input, amountMinor: 1000n }, actor, roles),
    service.publishPrice({ ...input, amountMinor: 2000n }, actor, roles),
  ]);

  const fulfilled = results.filter((r) => r.status === 'fulfilled');
  const rejected = results.filter((r) => r.status === 'rejected');

  // Deterministic non-ambiguous outcome: never both silently active.
  assert.ok(fulfilled.length >= 1, 'at least one publication must succeed');
  assert.ok(fulfilled.length + rejected.length === 2);
  if (rejected.length > 0) {
    assert.ok(rejected[0].reason instanceof PriceBookPublicationConflictError, `expected PriceBookPublicationConflictError, got ${rejected[0].reason}`);
  }

  const [rows] = await getPool().query(
    `SELECT COUNT(*) AS n FROM billing_price_books WHERE commercial_market = ? AND currency_code = ? AND target_device_limit = ? AND status = 'ACTIVE' AND effective_to IS NULL`,
    [input.commercialMarket, input.currencyCode, input.targetDeviceLimit],
  );
  assert.equal(Number(rows[0].n), 1, 'exactly one open-ACTIVE price book row must exist for this commercial key after the race');
});

test('MySQL: sequential publication for the same key correctly supersedes the prior version (no ambiguity, versions increment)', async () => {
  const adminId = await createAdmin();
  const actor = { adminId, role: 'FINANCE_ADMIN' };
  const roles = ['FINANCE_ADMIN'];
  const service = buildService();
  const input = { commercialMarket: 'GULF', currencyCode: 'SAR', targetDeviceLimit: 500 + Math.floor(Math.random() * 100000) };

  const v1 = await service.publishPrice({ ...input, amountMinor: 1000n }, actor, roles);
  const v2 = await service.publishPrice({ ...input, amountMinor: 1500n }, actor, roles);

  assert.equal(v2.priceBookVersion, v1.priceBookVersion + 1);

  const history = await service.getHistory(input.commercialMarket, input.currencyCode, input.targetDeviceLimit, roles);
  assert.equal(history.length, 2);
  assert.equal(history[0].status, 'RETIRED');
  assert.equal(history[1].status, 'ACTIVE');
  assert.equal(history[0].effectiveTo !== null, true);
});

test.after(async () => {
  await closePool();
});
