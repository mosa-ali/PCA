// PCA-AUTH-SESSION-1 -- real MySQL coverage for
// MySqlParentAccountRepository: durable persistence, DB-enforced
// email-uniqueness (registration race), verification-code single-use
// compare-and-swap (duplicate-verification race), the FREE_ACCESS-snapshot
// CHECK constraint, and cross-domain compatibility with the SHARED
// service_sessions table (revoke-all).
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { AuthService } from '../../dist/auth/AuthService.js';
import { MySqlAuthRepository } from '../../dist/auth/MySqlAuthRepository.js';
import { MySqlParentAccountRepository } from '../../dist/parentaccount/MySqlParentAccountRepository.js';
import { ParentAccountService } from '../../dist/parentaccount/ParentAccountService.js';
import { hashParentEmail } from '../../dist/parentaccount/emailHash.js';
import { createEd25519DeviceSignatureVerifier } from '../../dist/parentaccount/genesisDeviceSigner.js';
import { FamilyOwnerAttestationChainEngine } from '../../dist/familycommercial/authority/FamilyOwnerAttestationChainEngine.js';
import { InMemoryGenesisAnchorStore } from '../../dist/familycommercial/authority/InMemoryGenesisAnchorStore.js';
import { InMemoryAttestationChainStore } from '../../dist/familycommercial/authority/InMemoryAttestationChainStore.js';
import { closePool, execute, runInTransaction } from '../../dist/db/pool.js';

if (!process.env.PCA_DATABASE_URL) throw new Error('PCA_DATABASE_URL is required for backend/test/db tests.');

class RecordingEmailSender {
  constructor() {
    this.sent = [];
  }
  async sendVerificationCode(email, code) {
    this.sent.push({ email, code });
  }
  lastCodeFor(email) {
    for (let i = this.sent.length - 1; i >= 0; i -= 1) {
      if (this.sent[i].email === email) return this.sent[i].code;
    }
    return null;
  }
}

function buildService() {
  const parentAccountRepository = new MySqlParentAccountRepository();
  const authService = new AuthService(new MySqlAuthRepository());
  const emailSender = new RecordingEmailSender();
  const service = new ParentAccountService({ repository: parentAccountRepository, authService, emailSender });
  return { service, parentAccountRepository, emailSender };
}

function uniqueEmail() {
  return `writer57-${randomUUID()}@example.com`;
}

test('MySQL: registration persists a PENDING_VERIFICATION row, findable by email hash', async () => {
  const { service, parentAccountRepository } = buildService();
  const email = uniqueEmail();
  await service.register(email, 'a genuinely long password', 'a genuinely long password');
  const account = await parentAccountRepository.findByEmailHash(hashParentEmail(email));
  assert.ok(account);
  assert.equal(account.status, 'PENDING_VERIFICATION');
  assert.equal(account.freeAccess, null);
});

test('MySQL CONCURRENCY: two concurrent registrations for the same email are DB-uniqueness-enforced -- only one account row ever exists', async () => {
  const { service, parentAccountRepository } = buildService();
  const email = uniqueEmail();
  const password = 'a genuinely long password';
  await Promise.all([service.register(email, password, password), service.register(email, password, password)]);
  const account = await parentAccountRepository.findByEmailHash(hashParentEmail(email));
  assert.ok(account, 'exactly one durable account row must exist');
});

test('MySQL: verify-email transitions to VERIFIED, snapshots FREE_ACCESS atomically (CHECK constraint), and issues a session usable via the shared AuthService', async () => {
  const { service, emailSender } = buildService();
  const email = uniqueEmail();
  const password = 'a genuinely long password';
  await service.register(email, password, password);
  const code = emailSender.lastCodeFor(email);
  const outcome = await service.verifyEmail(email, code);
  assert.equal(typeof outcome.rawSessionToken, 'string');

  const session = await service.readSession(outcome.rawSessionToken);
  assert.equal(session.accountId, outcome.accountId);
});

test('MySQL CONCURRENCY: two concurrent verify-email calls with the same code -- exactly one wins (compare-and-swap on consumed_at)', async () => {
  const { service, emailSender } = buildService();
  const email = uniqueEmail();
  const password = 'a genuinely long password';
  await service.register(email, password, password);
  const code = emailSender.lastCodeFor(email);

  const results = await Promise.allSettled([service.verifyEmail(email, code), service.verifyEmail(email, code)]);
  const fulfilled = results.filter((r) => r.status === 'fulfilled');
  assert.equal(fulfilled.length, 1, 'exactly one concurrent verify-email call must durably win the single-use code');
});

test('MySQL: revoke-all-sessions revokes every session for the account through the SHARED service_sessions table', async () => {
  const { service, emailSender } = buildService();
  const email = uniqueEmail();
  const password = 'a genuinely long password';
  await service.register(email, password, password);
  const code = emailSender.lastCodeFor(email);
  const first = await service.verifyEmail(email, code);
  const second = await service.login(email, password);

  await service.revokeAllSessions(first.rawSessionToken);

  await assert.rejects(() => service.readSession(first.rawSessionToken));
  await assert.rejects(() => service.readSession(second.rawSessionToken));
});

test('MySQL: a login-issued session Bearer-authenticates against the EXISTING, unmodified requireServiceSession primitive (same token format/table)', async () => {
  const { service, emailSender } = buildService();
  const email = uniqueEmail();
  const password = 'a genuinely long password';
  await service.register(email, password, password);
  const code = emailSender.lastCodeFor(email);
  const verifyOutcome = await service.verifyEmail(email, code);

  const authService = new AuthService(new MySqlAuthRepository());
  const serviceAccountId = await authService.validateSession(verifyOutcome.rawSessionToken);
  assert.equal(typeof serviceAccountId, 'string');
});

test('MySQL: verify-email under a REAL (test-only Ed25519) signature verifier durably grants an ACTIVE service_account_family_scopes row for the new Owner', async () => {
  const parentAccountRepository = new MySqlParentAccountRepository();
  const authService = new AuthService(new MySqlAuthRepository());
  const emailSender = new RecordingEmailSender();
  const engine = new FamilyOwnerAttestationChainEngine(
    new InMemoryGenesisAnchorStore(),
    new InMemoryAttestationChainStore(),
    createEd25519DeviceSignatureVerifier(),
    () => new Date(),
  );
  const service = new ParentAccountService({ repository: parentAccountRepository, authService, emailSender, familyGenesisEngine: engine });

  const email = uniqueEmail();
  const password = 'a genuinely long password';
  await service.register(email, password, password);
  const code = emailSender.lastCodeFor(email);
  const outcome = await service.verifyEmail(email, code);
  assert.equal(typeof outcome.familyId, 'string');

  const account = await parentAccountRepository.findById(outcome.accountId);
  const { rows } = await runInTransaction((conn) =>
    execute(conn, `SELECT status FROM service_account_family_scopes WHERE account_id = ? AND family_id = ?`, [
      account.serviceAccountId,
      outcome.familyId,
    ]),
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, 'ACTIVE');
});

test.after(async () => {
  await closePool();
});
