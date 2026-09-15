import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const script = readFileSync(new URL('../../scripts/bootstrap-platform-owner.mjs', import.meta.url), 'utf8');
const authRepository = readFileSync(new URL('../../src/platformadmin/auth/MySqlAuthRepository.ts', import.meta.url), 'utf8');
const activationRepository = readFileSync(new URL('../../src/platformadmin/auth/MySqlPlatformAdminActivationRepository.ts', import.meta.url), 'utf8');
const outboxRepository = readFileSync(new URL('../../src/email/MySqlEmailOutboxRepository.ts', import.meta.url), 'utf8');
const bootstrapRepository = readFileSync(new URL('../../src/platformadmin/auth/MySqlFirstOwnerBootstrapRepository.ts', import.meta.url), 'utf8');

test('first-owner bootstrap is lock-serialized and has a zero-owner precondition', () => {
  assert.match(script, /GET_LOCK\(\?, \?\)/);
  assert.match(script, /RELEASE_LOCK\(\?\)/);
  assert.match(script, /await assertNoExistingAppOwner\(lock\)/);
  assert.match(script, /finally \{\s*\/\/[^\n]*\n\s*\/\/[^\n]*\n\s*\/\/[^\n]*\n\s*await releaseBootstrapLock\(lock\)/s);
  assert.match(script, /role: 'APP_OWNER'/);
});

test('advisory lock is released only after the atomic bootstrap transaction resolves, never held across the email delivery attempt', () => {
  const lockAcquireIndex = script.indexOf('const lock = await acquireBootstrapLock(pool);');
  const releaseIndex = script.indexOf('await releaseBootstrapLock(lock);');
  const deliveryIndex = script.indexOf('await attemptDeliveryAndRecordOutcome(');
  assert.ok(lockAcquireIndex >= 0 && releaseIndex >= 0 && deliveryIndex >= 0);
  // Lock acquired, then released, then (only afterward) the delivery attempt -- never the other order.
  assert.ok(lockAcquireIndex < releaseIndex, 'lock must be acquired before it is released');
  assert.ok(releaseIndex < deliveryIndex, 'lock must be released before the email delivery attempt, never held across it');
  // The release call sits inside a finally{} that wraps createFirstOwnerBootstrap -- i.e. release happens after the atomic transaction settles, not before.
  const tryIndex = script.indexOf('try {');
  const createCallIndex = script.indexOf('await createFirstOwnerBootstrap(');
  assert.ok(tryIndex >= 0 && createCallIndex >= 0);
  assert.ok(tryIndex < createCallIndex && createCallIndex < releaseIndex, 'createFirstOwnerBootstrap must run inside the try{} that the lock-releasing finally{} wraps');
});

test('first-owner bootstrap starts with a non-login credential and pending MFA', () => {
  assert.match(script, /PENDING_ACTIVATION_CREDENTIAL/);
  assert.match(script, /status: 'PENDING_SETUP'/);
  assert.doesNotMatch(script, /generateRandomPassword|Generated password|otpauthUri|MFA enrollment URI/);
  assert.doesNotMatch(script, /console\.log\([^\n]*(rawToken|token|password|secret|uri)/i);
});

test('first-owner bootstrap durably persists account, role, MFA, activation token, and email outbox in ONE atomic transaction', () => {
  // The script itself no longer calls createAccount/issue/insert as separate
  // operations -- it calls the single atomic entry point.
  assert.match(script, /import \{ createFirstOwnerBootstrap \} from '\.\.\/dist\/platformadmin\/auth\/MySqlFirstOwnerBootstrapRepository\.js';/);
  assert.match(script, /await createFirstOwnerBootstrap\(\{/);
  assert.doesNotMatch(script, /MySqlPlatformAdminAuthRepository|MySqlPlatformAdminActivationRepository\.issue|new EmailService\(/);

  // createFirstOwnerBootstrap itself wraps everything in one runInTransaction call.
  assert.match(bootstrapRepository, /export async function createFirstOwnerBootstrap/);
  const body = bootstrapRepository.slice(bootstrapRepository.indexOf('export async function createFirstOwnerBootstrap'));
  assert.match(body, /return runInTransaction\(async \(conn\)/);
  assert.match(body, /insertPlatformAdminAccountOnConnection\(conn, input\.account\)/);
  assert.match(body, /issueActivationTokenOnConnection\(conn, \{/);
  assert.match(body, /insertEmailOutboxRowOnConnection\(conn, input\.outboxEmail\)/);

  // The connection-scoped helpers it calls are the SAME ones each repository's
  // own single-operation entry point (createAccount/issue/insert) uses --
  // one source of truth for each insert group, not a duplicate copy.
  assert.match(authRepository, /export async function insertPlatformAdminAccountOnConnection/);
  assert.match(authRepository, /return runInTransaction\(\(conn\) => insertPlatformAdminAccountOnConnection\(conn, input\)\);/);
  assert.match(activationRepository, /export async function issueActivationTokenOnConnection/);
  assert.match(activationRepository, /await runInTransaction\(\(conn\) => issueActivationTokenOnConnection\(conn, input\)\);/);
  assert.match(outboxRepository, /export async function insertEmailOutboxRowOnConnection/);
  assert.match(outboxRepository, /return runInTransaction\(\(conn\) => insertEmailOutboxRowOnConnection\(conn, input\)\);/);
});

test('the durable outbox row is enqueued INSIDE the atomic transaction; provider delivery happens OUTSIDE it, after commit', () => {
  // No provider adapter / network client is ever passed into or used by
  // createFirstOwnerBootstrap or its transaction body -- only encryption and
  // SQL. The actual send happens via attemptDeliveryAndRecordOutcome, called
  // by the script AFTER createFirstOwnerBootstrap has already resolved.
  assert.doesNotMatch(bootstrapRepository, /providerAdapter|\.send\(|sendPlatformAdminActivationLink/);
  const createCallIndex = script.indexOf('bootstrapResult = await createFirstOwnerBootstrap(');
  const deliveryIndex = script.indexOf('await attemptDeliveryAndRecordOutcome(');
  assert.ok(createCallIndex >= 0 && deliveryIndex >= 0 && createCallIndex < deliveryIndex);
});

test('activation uses the existing hash-only token and encrypted MFA lifecycle', () => {
  const activation = readFileSync(new URL('../../src/platformadmin/auth/PlatformAdminActivationService.ts', import.meta.url), 'utf8');
  const repo = readFileSync(new URL('../../src/platformadmin/auth/MySqlPlatformAdminActivationRepository.ts', import.meta.url), 'utf8');
  assert.match(activation, /generateActivationToken/);
  assert.match(activation, /activationRepository\.issue/);
  assert.match(activation, /encryptTotpSecret/);
  assert.match(activation, /activationRepository\.complete/);
  assert.match(repo, /token_hash/);
  assert.match(repo, /used_at IS NULL/);
  assert.match(repo, /revoked_at IS NULL/);
});
