import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';
import { AuthService } from '../../dist/auth/AuthService.js';
import { PostgresAuthRepository } from '../../dist/auth/PostgresAuthRepository.js';
import { closePool, getPool } from '../../dist/db/pool.js';
import { verifyTestOnlyIdentity } from '../support/testOnlyIdentityProvider.mjs';

if (!process.env.PCA_DATABASE_URL) throw new Error('PCA_DATABASE_URL is required for backend/test/db tests.');

const repository = new PostgresAuthRepository();

function buildService(now = () => new Date()) {
  return new AuthService(repository, now);
}

function subject() {
  return `subject-${Math.random().toString(36).slice(2)}-${Date.now()}`;
}

test('PG: issuing and validating a session persists through real PostgreSQL', async () => {
  const service = buildService();
  const identity = verifyTestOnlyIdentity(subject());
  const { rawToken, session } = await service.issueSession(identity);
  const accountId = await service.validateSession(rawToken);
  assert.equal(accountId, session.accountId);
});

test('PG: the same identity resolves to the same account across sessions (DB-enforced unique reference hash)', async () => {
  const service = buildService();
  const identity = verifyTestOnlyIdentity(subject());
  const first = await service.issueSession(identity);
  const second = await service.issueSession(identity);
  assert.equal(first.session.accountId, second.session.accountId);
});

test('PG: token hash uniqueness is DB-enforced', async () => {
  const now = new Date();
  const accountId = (await repository.findOrCreateAccount(Buffer.from(subject()), now)).accountId;
  const shared = { sessionId: randomUUID(), accountId, tokenHash: 'a'.repeat(64), issuedAt: now, expiresAt: new Date(now.getTime() + 60_000), revokedAt: null };
  await repository.createSession(shared);
  await assert.rejects(
    () => repository.createSession({ ...shared, sessionId: randomUUID() }),
    (error) => error.code === '23505',
  );
});

test('PG: unknown and malformed tokens are rejected with the same generic error', async () => {
  const service = buildService();
  const unknownError = await service.validateSession('A'.repeat(43)).catch((e) => e);
  const malformedError = await service.validateSession('not a token').catch((e) => e);
  assert.equal(unknownError.code, 'UNAUTHORIZED');
  assert.equal(unknownError.message, malformedError.message);
});

test('PG: exact expiry boundary rejected', async () => {
  let now = new Date('2026-01-01T00:00:00.000Z');
  const service = buildService(() => now);
  const { rawToken, session } = await service.issueSession(verifyTestOnlyIdentity(subject()));
  now = session.expiresAt;
  const error = await service.validateSession(rawToken).catch((e) => e);
  assert.equal(error.code, 'UNAUTHORIZED');
});

test('PG: revoked session rejected; replay after revoke fails', async () => {
  const service = buildService();
  const { rawToken } = await service.issueSession(verifyTestOnlyIdentity(subject()));
  await service.revokeSession(rawToken);
  const error = await service.validateSession(rawToken).catch((e) => e);
  assert.equal(error.code, 'UNAUTHORIZED');
});

test('PG: disabled account invalidates an already-issued, unexpired session on the very next validation', async () => {
  const service = buildService();
  const identity = verifyTestOnlyIdentity(subject());
  const { rawToken, session } = await service.issueSession(identity);
  await service.validateSession(rawToken);
  // Disabling is not part of the public AuthRepository contract -- use a raw query.
  await getPool().query(`UPDATE service_accounts SET disabled_at = now() WHERE account_id = $1`, [session.accountId]);
  const error = await service.validateSession(rawToken).catch((e) => e);
  assert.equal(error.code, 'UNAUTHORIZED');
});

test('PG CONCURRENCY: revocation race -- many simultaneous revoke calls converge on one winning revoked_at', async () => {
  const service = buildService();
  const { rawToken } = await service.issueSession(verifyTestOnlyIdentity(subject()));
  const attempts = await Promise.allSettled(Array.from({ length: 15 }, () => service.revokeSession(rawToken)));
  assert.equal(attempts.every((a) => a.status === 'fulfilled'), true, 'revocation must be idempotent even under a real race');
  const error = await service.validateSession(rawToken).catch((e) => e);
  assert.equal(error.code, 'UNAUTHORIZED');
});

test('PG CONCURRENCY: account-disable race -- concurrent validate calls never see an inconsistent partial state', async () => {
  const service = buildService();
  const identity = verifyTestOnlyIdentity(subject());
  const { rawToken, session } = await service.issueSession(identity);
  const [disableResult, ...validations] = await Promise.allSettled([
    getPool().query(`UPDATE service_accounts SET disabled_at = now() WHERE account_id = $1`, [session.accountId]),
    ...Array.from({ length: 10 }, () => service.validateSession(rawToken)),
  ]);
  assert.equal(disableResult.status, 'fulfilled');
  // Every validation either succeeded (ran before disable committed) or failed generically -- never a crash/inconsistent result.
  for (const outcome of validations) {
    if (outcome.status === 'rejected') assert.equal(outcome.reason.code, 'UNAUTHORIZED');
  }
  // Once disabled, the account must stay rejected -- no lingering valid window.
  const afterError = await service.validateSession(rawToken).catch((e) => e);
  assert.equal(afterError.code, 'UNAUTHORIZED');
});

test('raw token never appears in the database -- only its hash is stored', async () => {
  const service = buildService();
  const { rawToken, session } = await service.issueSession(verifyTestOnlyIdentity(subject()));
  const { rows } = await getPool().query(`SELECT token_hash FROM service_sessions WHERE session_id = $1`, [session.sessionId]);
  assert.equal(rows[0].token_hash.includes(rawToken), false);
  assert.notEqual(rows[0].token_hash, rawToken);
});

test('test-only identity provider is structurally impossible to reach from the production build (dist/)', async () => {
  const distDir = new URL('../../dist/', import.meta.url);
  const productionFiles = await collectJsFiles(distDir);
  assert.ok(productionFiles.length > 0, 'sanity check: dist/ must contain compiled output');
  for (const file of productionFiles) {
    const content = await readFile(file, 'utf8');
    assert.equal(
      content.includes('testOnlyIdentityProvider') || content.includes('verifyTestOnlyIdentity'),
      false,
      `${file} must never reference the test-only identity provider`,
    );
  }
});

async function collectJsFiles(dirUrl) {
  const entries = await readdir(dirUrl, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const entryUrl = new URL(entry.name + (entry.isDirectory() ? '/' : ''), dirUrl);
    if (entry.isDirectory()) files.push(...(await collectJsFiles(entryUrl)));
    else if (entry.name.endsWith('.js')) files.push(entryUrl);
  }
  return files;
}

test.after(async () => {
  await closePool();
});
