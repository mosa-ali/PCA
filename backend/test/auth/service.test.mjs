import assert from 'node:assert/strict';
import test from 'node:test';
import { AuthService, AuthError } from '../../dist/auth/AuthService.js';
import { DEFAULT_SESSION_TTL_MS, MAX_SESSION_TTL_MS } from '../../dist/auth/policy.js';
import { createInMemoryAuthRepository } from '../support/inMemoryAuthRepository.mjs';
import { verifyTestOnlyIdentity } from '../support/testOnlyIdentityProvider.mjs';

const BASE_TIME = new Date('2026-01-01T00:00:00.000Z').getTime();

function buildService() {
  const repository = createInMemoryAuthRepository();
  let currentTime = BASE_TIME;
  const clock = { now: () => new Date(currentTime), advance: (ms) => { currentTime += ms; }, set: (ms) => { currentTime = ms; } };
  const service = new AuthService(repository, clock.now);
  return { service, repository, clock };
}

test('issuing a session for a new identity creates an account and returns a raw token once', async () => {
  const { service } = buildService();
  const identity = verifyTestOnlyIdentity('subject-1');
  const { rawToken, session } = await service.issueSession(identity);
  assert.equal(typeof rawToken, 'string');
  assert.notEqual(session.tokenHash, rawToken);
});

test('the same verified identity always resolves to the same account across separate sessions', async () => {
  const { service } = buildService();
  const identity = verifyTestOnlyIdentity('subject-1');
  const first = await service.issueSession(identity);
  const second = await service.issueSession(identity);
  assert.equal(first.session.accountId, second.session.accountId);
  assert.notEqual(first.rawToken, second.rawToken);
});

test('a valid session validates to its account id', async () => {
  const { service } = buildService();
  const { rawToken, session } = await service.issueSession(verifyTestOnlyIdentity('subject-1'));
  const accountId = await service.validateSession(rawToken);
  assert.equal(accountId, session.accountId);
});

test('unknown token is rejected with the single generic error', async () => {
  const { service } = buildService();
  const fakeToken = 'A'.repeat(43);
  const error = await service.validateSession(fakeToken).catch((e) => e);
  assert.ok(error instanceof AuthError);
  assert.equal(error.code, 'UNAUTHORIZED');
});

test('malformed bearer input is rejected with the SAME generic error as an unknown token (no distinguishing detail)', async () => {
  const { service } = buildService();
  const unknownError = await service.validateSession('A'.repeat(43)).catch((e) => e);
  const malformedError = await service.validateSession('not a token').catch((e) => e);
  const emptyError = await service.validateSession('').catch((e) => e);
  const oversizedError = await service.validateSession('A'.repeat(100_000)).catch((e) => e);
  assert.equal(unknownError.code, malformedError.code);
  assert.equal(unknownError.message, malformedError.message);
  assert.equal(emptyError.message, malformedError.message);
  assert.equal(oversizedError.message, malformedError.message);
});

test('exact expiry boundary: a session is rejected exactly at (and after) its expiresAt instant', async () => {
  const { service, clock } = buildService();
  const { rawToken, session } = await service.issueSession(verifyTestOnlyIdentity('subject-1'));
  clock.set(session.expiresAt.getTime());
  const error = await service.validateSession(rawToken).catch((e) => e);
  assert.equal(error.code, 'UNAUTHORIZED');
});

test('a session is valid one millisecond before expiry', async () => {
  const { service, clock } = buildService();
  const { rawToken, session } = await service.issueSession(verifyTestOnlyIdentity('subject-1'));
  clock.set(session.expiresAt.getTime() - 1);
  const accountId = await service.validateSession(rawToken);
  assert.equal(accountId, session.accountId);
});

test('revoked session is rejected with the same generic error, even immediately after issuance', async () => {
  const { service } = buildService();
  const { rawToken } = await service.issueSession(verifyTestOnlyIdentity('subject-1'));
  await service.revokeSession(rawToken);
  const error = await service.validateSession(rawToken).catch((e) => e);
  assert.equal(error.code, 'UNAUTHORIZED');
});

test('revocation is idempotent and safe to call on an unknown token', async () => {
  const { service } = buildService();
  const { rawToken } = await service.issueSession(verifyTestOnlyIdentity('subject-1'));
  await service.revokeSession(rawToken);
  await assert.doesNotReject(() => service.revokeSession(rawToken));
  await assert.doesNotReject(() => service.revokeSession('A'.repeat(43)));
});

test('disabled account: an already-issued session stops validating the moment the account is disabled', async () => {
  const { service, repository } = buildService();
  const { rawToken, session } = await service.issueSession(verifyTestOnlyIdentity('subject-1'));
  await service.validateSession(rawToken); // valid before disable
  repository._disableAccountForTest(session.accountId, new Date());
  const error = await service.validateSession(rawToken).catch((e) => e);
  assert.equal(error.code, 'UNAUTHORIZED');
});

test('issuing a session for an already-disabled account is refused with the same generic error', async () => {
  const { service, repository } = buildService();
  const identity = verifyTestOnlyIdentity('subject-1');
  const { session } = await service.issueSession(identity);
  repository._disableAccountForTest(session.accountId, new Date());
  const error = await service.issueSession(identity).catch((e) => e);
  assert.ok(error instanceof AuthError);
  assert.equal(error.code, 'UNAUTHORIZED');
});

test('TTL policy: omitted ttlMs falls back to the server default', async () => {
  const { service } = buildService();
  const { session } = await service.issueSession(verifyTestOnlyIdentity('subject-1'));
  assert.equal(session.expiresAt.getTime() - session.issuedAt.getTime(), DEFAULT_SESSION_TTL_MS);
});

test('TTL policy: a request above the server maximum is rejected', async () => {
  const { service } = buildService();
  await assert.rejects(
    () => service.issueSession(verifyTestOnlyIdentity('subject-1'), MAX_SESSION_TTL_MS + 1),
    RangeError,
  );
});

test('raw token never appears in a thrown error or in the session record', async () => {
  const { service } = buildService();
  const { rawToken, session } = await service.issueSession(verifyTestOnlyIdentity('subject-1'));
  assert.equal(JSON.stringify(session).includes(rawToken), false);
  const error = await service.validateSession('malformed').catch((e) => e);
  assert.equal(error.message.includes(rawToken), false);
});

test('a service session carries no field resembling family policy/role authority -- ServiceSessionRecord is account-scoped only', async () => {
  const { service } = buildService();
  const { session } = await service.issueSession(verifyTestOnlyIdentity('subject-1'));
  const forbidden = ['role', 'familyRole', 'policy', 'ownerOf', 'isAdmin', 'permissions'];
  for (const field of forbidden) assert.equal(field in session, false);
});
