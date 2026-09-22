// Focused tests for the operator-only Platform Admin credential recovery path
// (scripts/recover-platform-admin-activation.mjs) and the pure refusal rules it
// delegates to (scripts/lib/platformAdminRecoveryVerdict.mjs).
//
// WHY THIS FILE HAS TWO HALVES, AND WHY BOTH ARE NEEDED:
//   * The BEHAVIOURAL half drives the real decision function with real state
//     shapes, including one case per refusal reason. A test that only proved
//     the happy path would be indistinguishable from a function that always
//     says yes -- the doctrine this repository already applies elsewhere
//     ("a success-path-only test cannot distinguish a working guard from an
//     absent one").
//   * The STATIC half asserts properties of the script itself that no pure
//     function can express: that the three durable writes share ONE
//     transaction, that the network delivery attempt is outside it, that the
//     script contains no direct UPDATE against the credential/MFA tables, and
//     that nothing it can print is derived from a token, a URL, or a secret.
//
// Every negative (doesNotMatch) assertion below runs against COMMENT-STRIPPED
// source. The script's own header deliberately names the things it must never
// touch ("does not read PLATFORM_ADMIN_MFA_ENC_KEY", "never touches
// password_credential", "no otpauth:// URI"), so asserting against the raw
// file would be asserting about prose. These checks are about code.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  RECOVERY_CONFIRMATION_VALUE,
  RECOVERY_REFUSAL_REASONS,
  RecoveryRefusalError,
  evaluateRecoveryTarget,
} from '../../scripts/lib/platformAdminRecoveryVerdict.mjs';
import { ACTIVATION_RECOVERY_LOCK_NAME } from '../../scripts/recover-platform-admin-activation.mjs';

const script = readFileSync(new URL('../../scripts/recover-platform-admin-activation.mjs', import.meta.url), 'utf8');
const verdictModule = readFileSync(new URL('../../scripts/lib/platformAdminRecoveryVerdict.mjs', import.meta.url), 'utf8');
const activationRepository = readFileSync(new URL('../../src/platformadmin/auth/MySqlPlatformAdminActivationRepository.ts', import.meta.url), 'utf8');

// Comment-stripped code only. Trailing comments survive this, which is fine:
// no trailing comment in the script names a forbidden identifier.
const codeLines = script.split('\n').filter((line) => !line.trim().startsWith('//')).join('\n');
const importLines = script.split('\n').filter((line) => line.includes('import ')).join('\n');
// The CLI reporting block is the only place in the script that produces output.
const cliBlock = script.slice(script.indexOf('if (invokedDirectly) {'));
const cliCode = cliBlock.split('\n').filter((line) => !line.trim().startsWith('//')).join('\n');

const ADMIN_ID = '1b395927-b07b-11f1-970a-70a8a51e7786';

function state(overrides = {}) {
  return {
    accounts: [{ adminId: ADMIN_ID, status: 'ACTIVE' }],
    activeRoles: ['APP_OWNER', 'PLATFORM_ADMIN'],
    mfa: { status: 'PENDING_SETUP', totpMaterialPresent: false },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Behaviour: the refusal rules
// ---------------------------------------------------------------------------

test('recovery is allowed for exactly the shape it is for: one ACTIVE account holding both PLATFORM_ADMIN and APP_OWNER with a never-completed enrollment', () => {
  const verdict = evaluateRecoveryTarget(state());
  assert.equal(verdict.allowed, true);
  assert.equal(verdict.adminId, ADMIN_ID);
  assert.deepEqual(verdict.roles, ['APP_OWNER', 'PLATFORM_ADMIN']);
  assert.equal(verdict.clearedPendingTotpMaterial, false);
});

test('every refusal reason is reachable, and the exported reason list is exhaustive', () => {
  const cases = [
    ['ACCOUNT_NOT_FOUND', state({ accounts: [] })],
    ['MULTIPLE_ACCOUNTS_MATCHED', state({ accounts: [{ adminId: 'a', status: 'ACTIVE' }, { adminId: 'b', status: 'ACTIVE' }] })],
    ['ACCOUNT_NOT_ACTIVE', state({ accounts: [{ adminId: ADMIN_ID, status: 'DISABLED' }] })],
    ['NO_ACTIVE_ROLE', state({ activeRoles: [] })],
    ['PLATFORM_ADMIN_ROLE_MISSING', state({ activeRoles: ['APP_OWNER'] })],
    ['APP_OWNER_ROLE_MISSING', state({ activeRoles: ['PLATFORM_ADMIN'] })],
    ['MFA_STATE_MISSING', state({ mfa: null })],
    ['MFA_NOT_PENDING_SETUP', state({ mfa: { status: 'ACTIVE', totpMaterialPresent: true } })],
    ['PENDING_TOTP_MATERIAL_PRESENT', state({ mfa: { status: 'PENDING_SETUP', totpMaterialPresent: true } })],
  ];

  const observed = [];
  for (const [expectedReason, defective] of cases) {
    const verdict = evaluateRecoveryTarget(defective);
    assert.equal(verdict.allowed, false, `${expectedReason} must be refused`);
    assert.equal(verdict.reason, expectedReason);
    observed.push(verdict.reason);
  }

  // Exhaustiveness: the list the script documents is exactly the set the
  // function can return. A new branch added without updating the list (or a
  // reason in the list that no input can trigger) fails here rather than
  // shipping as a documented-but-unreachable refusal.
  assert.deepEqual([...observed].sort(), [...RECOVERY_REFUSAL_REASONS].sort());
});

test('GATE SELF-TEST: the decision function is demonstrably able to refuse, not merely able to allow', () => {
  // The permanent principle in this repository: a gate must be provably able
  // to fail. If evaluateRecoveryTarget had a bug that always returned
  // { allowed: true }, every hostile case above would silently pass as
  // "allowed" -- so assert the negative direction directly as well.
  const defectiveStates = [
    state({ accounts: [] }),
    state({ accounts: [{ adminId: ADMIN_ID, status: 'DISABLED' }] }),
    state({ activeRoles: ['PLATFORM_ADMIN'] }),
    state({ mfa: { status: 'ACTIVE', totpMaterialPresent: true } }),
  ];
  for (const defective of defectiveStates) {
    assert.equal(evaluateRecoveryTarget(defective).allowed, false);
  }
});

test('an already-ACTIVE MFA is refused even with a fully valid role set -- recovery is not a credential reset', () => {
  const verdict = evaluateRecoveryTarget(state({ mfa: { status: 'ACTIVE', totpMaterialPresent: true } }));
  assert.equal(verdict.allowed, false);
  assert.equal(verdict.reason, 'MFA_NOT_PENDING_SETUP');
});

test('pending enrollment material is refused by default and only cleared under the explicit review escape hatch', () => {
  const materialPresent = state({ mfa: { status: 'PENDING_SETUP', totpMaterialPresent: true } });
  assert.equal(evaluateRecoveryTarget(materialPresent).reason, 'PENDING_TOTP_MATERIAL_PRESENT');

  const reviewed = evaluateRecoveryTarget(materialPresent, { allowPendingMaterial: true });
  assert.equal(reviewed.allowed, true);
  // Reported truthfully, so the audit metadata records that material was
  // destroyed rather than implying a clean no-op reissue.
  assert.equal(reviewed.clearedPendingTotpMaterial, true);
});

test('missing or unknown state is refused rather than assumed valid', () => {
  assert.equal(evaluateRecoveryTarget(undefined).reason, 'ACCOUNT_NOT_FOUND');
  assert.equal(evaluateRecoveryTarget({}).reason, 'ACCOUNT_NOT_FOUND');
  assert.equal(evaluateRecoveryTarget({ accounts: [{ adminId: 'x', status: 'ACTIVE' }] }).reason, 'NO_ACTIVE_ROLE');
});

test('RecoveryRefusalError carries its reason as data, so the CLI reports it without parsing a message', () => {
  const error = new RecoveryRefusalError('ACCOUNT_NOT_FOUND');
  assert.equal(error.reason, 'ACCOUNT_NOT_FOUND');
  assert.equal(error.name, 'RecoveryRefusalError');
  assert.ok(error instanceof Error);
});

test('the pure refusal module imports nothing from dist, so its rules are testable without a build or a database', () => {
  assert.doesNotMatch(verdictModule, /from '\.\.\/dist\//);
  assert.doesNotMatch(verdictModule, /from '\.\.\/\.\.\/dist\//);
});

// ---------------------------------------------------------------------------
// Static: properties of the operator script itself
// ---------------------------------------------------------------------------

test('the script refuses before writing anything: a read-only preflight runs before the write transaction opens', () => {
  const preflightIndex = script.indexOf('const preflightVerdict = evaluateRecoveryTarget(preflight');
  const transactionIndex = script.indexOf('committed = await runInTransaction(');
  assert.ok(preflightIndex >= 0, 'the preflight verdict must exist');
  assert.ok(transactionIndex >= 0, 'the write transaction must exist');
  assert.ok(preflightIndex < transactionIndex, 'the preflight must run before the write transaction opens');
  assert.match(script, /if \(!preflightVerdict\.allowed\) throw new RecoveryRefusalError\(preflightVerdict\.reason\);/);
});

test('the decision is re-taken inside the transaction, so an account state change cannot slip past the preflight', () => {
  const transactionBody = script.slice(script.indexOf('committed = await runInTransaction('));
  assert.match(transactionBody, /const reread = await readTargetState\(conn, emailHash\);/);
  assert.match(transactionBody, /const verdict = evaluateRecoveryTarget\(reread, \{ allowPendingMaterial \}\);/);
  assert.match(transactionBody, /if \(!verdict\.allowed\) throw new RecoveryRefusalError\(verdict\.reason\);/);
  // The in-transaction re-check is the safety boundary and must exist
  // independently, not reuse the preflight's earlier result.
  assert.doesNotMatch(transactionBody, /evaluateRecoveryTarget\(preflight/);
});

test('the account row is read before roles and MFA, so a refusal never costs more than the read it needs', () => {
  const readBody = script.slice(script.indexOf('async function readTargetState'));
  const accountSelect = readBody.indexOf('FROM platform_admin_accounts WHERE email_hash = ?');
  const roleSelect = readBody.indexOf('FROM platform_admin_role_assignments');
  const mfaSelect = readBody.indexOf('FROM platform_admin_mfa_state');
  assert.ok(accountSelect >= 0 && roleSelect >= 0 && mfaSelect >= 0);
  assert.ok(accountSelect < roleSelect && roleSelect < mfaSelect, 'accounts, then roles, then MFA');
});

test('SECURITY: the script takes NO row lock, because locking the account or MFA row would invert the lock order the activation lifecycle depends on', () => {
  // Comment-stripped: the header deliberately names `FOR UPDATE` in order to
  // explain why it is NOT used here.
  assert.doesNotMatch(codeLines, /FOR UPDATE/);

  // The ordering this script must not contradict, read from the repository
  // itself rather than restated: complete() locks activation_tokens, then
  // mfa_state, then accounts.
  const completeBody = activationRepository.slice(activationRepository.indexOf('async complete('));
  const tokenLock = completeBody.indexOf('FROM platform_admin_activation_tokens');
  const mfaLock = completeBody.indexOf('FROM platform_admin_mfa_state');
  const accountLock = completeBody.indexOf('FROM platform_admin_accounts');
  assert.ok(tokenLock >= 0 && mfaLock > tokenLock && accountLock > mfaLock);
  // A reissue that locked accounts FIRST and then waited on mfa_state would
  // form a cycle against that sequence. The only locking statement this script
  // can reach is the repository's own, whose order is a prefix of complete()'s.
  assert.match(script, /await issueActivationTokenOnConnection\(conn, \{/);
});

test('the operator invariant is serialized by a dedicated advisory lock, held from before the preflight until after the transaction settles', () => {
  assert.equal(ACTIVATION_RECOVERY_LOCK_NAME, 'pca:platform-admin-activation-recovery');
  // Dedicated, NOT the shared bootstrap lock: this script does not mutate the
  // "does an active APP_OWNER exist yet" invariant those scripts serialize,
  // so sharing their lock would block an unrelated operation.
  assert.doesNotMatch(script, /FIRST_OWNER_BOOTSTRAP_LOCK_NAME/);
  assert.match(codeLines, /SELECT GET_LOCK\(\?, \?\) AS acquired/);
  assert.match(codeLines, /SELECT RELEASE_LOCK\(\?\) AS released/);

  const tryIdx = script.indexOf('try {', script.indexOf('const lock = await acquireRecoveryLock(pool);'));
  const acquireIdx = script.indexOf('const lock = await acquireRecoveryLock(pool);');
  const preflightIdx = script.indexOf('const preflight = await readTargetState(lock, emailHash);');
  const transactionIdx = script.indexOf('committed = await runInTransaction(');
  const releaseIdx = script.indexOf('await releaseRecoveryLock(lock);');
  const deliveryIdx = script.indexOf('const deliveryOutcome = await attemptDeliveryAndRecordOutcome(');
  assert.ok(acquireIdx >= 0 && preflightIdx >= 0 && transactionIdx >= 0 && releaseIdx >= 0 && deliveryIdx >= 0);
  assert.ok(acquireIdx < tryIdx, 'the lock is taken before the guarded block opens');
  assert.ok(tryIdx < preflightIdx, 'the precondition is read while the lock is held');
  assert.ok(preflightIdx < transactionIdx, 'the preflight precedes the write transaction');
  assert.ok(transactionIdx < releaseIdx, 'the lock is released only after the transaction settles');
  assert.ok(releaseIdx < deliveryIdx, 'the lock is never held across the network delivery attempt');
  // Released in a finally{}, so a refusal or a thrown error cannot leak it.
  assert.match(script, /\} finally \{\s*\/\/[^\n]*\n\s*\/\/[^\n]*\n\s*await releaseRecoveryLock\(lock\);/);
});

test('token, outbox row and audit event are written by THREE writes on ONE transaction connection, and the network send is outside it', () => {
  const transactionIndex = script.indexOf('committed = await runInTransaction(');
  const issueIndex = script.indexOf('await issueActivationTokenOnConnection(conn, {');
  const outboxIndex = script.indexOf('await insertEmailOutboxRowOnConnection(conn, {');
  const auditIndex = script.indexOf('await insertPlatformAdminAuditEventRow(conn, {');
  const deliveryIndex = script.indexOf('const deliveryOutcome = await attemptDeliveryAndRecordOutcome(');

  assert.ok(transactionIndex >= 0 && issueIndex >= 0 && outboxIndex >= 0 && auditIndex >= 0 && deliveryIndex >= 0);
  assert.ok(transactionIndex < issueIndex, 'the transaction must open before the token is issued');
  assert.ok(issueIndex < outboxIndex && outboxIndex < auditIndex, 'all three writes belong to the same transaction body');
  assert.ok(auditIndex < deliveryIndex, 'the network delivery attempt must come after the durable writes');

  // Every write is issued on the transaction's own `conn`, never on the
  // pool: a pool call would silently escape the transaction and reintroduce
  // the stranding defect this shape exists to prevent.
  for (const call of ['issueActivationTokenOnConnection(conn, {', 'insertEmailOutboxRowOnConnection(conn, {', 'insertPlatformAdminAuditEventRow(conn, {']) {
    assert.ok(script.includes(call), `${call} must be issued on the transaction connection`);
  }
});

test('the script uses the application repositories the activation lifecycle already uses, never raw SQL against credential or MFA state', () => {
  assert.match(importLines, /from '\.\.\/dist\/platformadmin\/auth\/MySqlPlatformAdminActivationRepository\.js';/);
  assert.match(importLines, /from '\.\.\/dist\/platformadmin\/audit\/MySqlPlatformAdminAuditRepository\.js';/);
  assert.match(importLines, /from '\.\.\/dist\/email\/MySqlEmailOutboxRepository\.js';/);
  assert.match(importLines, /from '\.\.\/dist\/platformadmin\/auth\/PlatformAdminActivationService\.js';/);
  assert.match(importLines, /from '\.\.\/dist\/db\/pool\.js';/);

  // The only SQL in the script is SELECT (the two reads in readTargetState).
  assert.doesNotMatch(codeLines, /UPDATE\s+platform_admin_accounts/i);
  assert.doesNotMatch(codeLines, /UPDATE\s+platform_admin_mfa_state/i);
  assert.doesNotMatch(codeLines, /UPDATE\s+platform_admin_role_assignments/i);
  assert.doesNotMatch(codeLines, /INSERT\s+INTO\s+platform_admin_/i);
  assert.doesNotMatch(codeLines, /DELETE\s+FROM\s+platform_admin_/i);

  // It also never substitutes a placeholder credential, hashes a password, or
  // touches TOTP key material -- those belong to the activation flow alone.
  assert.doesNotMatch(codeLines, /PENDING_ACTIVATION_CREDENTIAL/);
  assert.doesNotMatch(codeLines, /hashPassword|scrypt/);
  assert.doesNotMatch(codeLines, /PLATFORM_ADMIN_MFA_ENC_KEY|loadMfaEncryptionKey|encryptTotpSecret|generateTotpSecret|buildOtpauthUri/);
});

test('the audit event reuses an existing closed-vocabulary type and records the non-changes explicitly', () => {
  assert.match(codeLines, /eventType: 'SETTING_CHANGED'/);
  assert.doesNotMatch(codeLines, /eventType: '[A-Z_]+_REISSUED'/);
  assert.match(codeLines, /actorAdminId: null/);
  assert.match(codeLines, /targetRef: `admin:\$\{verdict\.adminId\}`/);
  assert.match(codeLines, /change: 'PLATFORM_ADMIN_ACTIVATION_REISSUED'/);
  assert.match(codeLines, /passwordCredentialChanged: false/);
  assert.match(codeLines, /mfaStatusBefore: 'PENDING_SETUP'/);
  assert.match(codeLines, /clearedPendingTotpMaterial: verdict\.clearedPendingTotpMaterial/);
});

test('the mutation cannot be reached without the explicit confirmation value, and the target is named only by env var', () => {
  assert.equal(RECOVERY_CONFIRMATION_VALUE, 'REISSUE_ACTIVATION');
  assert.match(codeLines, /requireEnv\(env, 'PLATFORM_ADMIN_RECOVERY_CONFIRM'\)/);
  assert.match(codeLines, /!== RECOVERY_CONFIRMATION_VALUE/);
  assert.match(codeLines, /PLATFORM_ADMIN_RECOVERY_ALLOW_PENDING_MATERIAL === 'YES'/);
  assert.match(codeLines, /requireEnv\(env, 'PLATFORM_ADMIN_RECOVERY_EMAIL'\)/);
  // No positional argument is consumed, so the target cannot be varied by a
  // stray CLI argument.
  assert.doesNotMatch(script, /process\.argv\[2\]/);
});

test('every value the script can print is on a closed allowlist -- no token, URL, code, email, or secret can reach stdout', () => {
  const interpolations = [...cliCode.matchAll(/\$\{([^}]*)\}/g)].map((match) => match[1].trim());
  assert.ok(interpolations.length > 0, 'the CLI block must report something');

  const allowed = new Set([
    'result.adminId',
    'result.outboxOutcome',
    'result.deliveryOutcome',
    'result.providerName',
    'result.activationExpiresAt.toISOString()',
    'error.reason',
    "error instanceof Error ? error.message : 'Platform Admin activation recovery failed.'",
  ]);
  for (const expression of interpolations) {
    assert.ok(allowed.has(expression), `unexpected interpolation in CLI output: ${expression}`);
  }

  // The success line reports only the opaque admin id and delivery facts. The
  // recipient address is deliberately absent, because the owner already knows
  // which mailbox they own.
  assert.match(codeLines, /PLATFORM_ADMIN_ACTIVATION_REISSUED=YES TARGET_REF=admin:\$\{result\.adminId\}/);
  assert.match(codeLines, /NEXT_STEP=OWNER_OPENS_EMAILED_LINK/);
  assert.doesNotMatch(codeLines, /console\.\w+\([^)]*email/i);
});

test('the script is inert unless invoked directly, so importing it can never mutate anything', () => {
  assert.match(script, /const invokedDirectly = process\.argv\[1\] && fileURLToPath\(import\.meta\.url\) === resolve\(process\.argv\[1\]\);/);
  const guardIndex = script.indexOf('if (invokedDirectly) {');
  const runIndex = script.indexOf('runRecovery()', guardIndex);
  assert.ok(guardIndex >= 0 && runIndex > guardIndex);
});

test('the reissue revokes old tokens and clears pending enrollment material in ONE transaction -- the property that makes a replacement link safe', () => {
  // Asserted against the repository itself, not a copy of its SQL: the
  // script's safety depends on the SAME function the ordinary reissue route
  // calls, so this pins the shared source of truth instead of restating it.
  const issueBody = activationRepository.slice(activationRepository.indexOf('export async function issueActivationTokenOnConnection'));
  assert.match(issueBody, /UPDATE platform_admin_activation_tokens SET revoked_at = \? WHERE admin_id = \? AND purpose = \? AND used_at IS NULL AND revoked_at IS NULL/);
  assert.match(issueBody, /UPDATE platform_admin_mfa_state SET totp_secret_ciphertext = NULL, totp_secret_nonce = NULL, activated_at = NULL, last_accepted_totp_counter = NULL WHERE admin_id = \? AND status = 'PENDING_SETUP'/);
  const revokeIndex = issueBody.indexOf('SET revoked_at');
  const wipeIndex = issueBody.indexOf('UPDATE platform_admin_mfa_state');
  const insertIndex = issueBody.indexOf('INSERT INTO platform_admin_activation_tokens');
  assert.ok(revokeIndex >= 0 && wipeIndex > revokeIndex && insertIndex > wipeIndex, 'revoke, then wipe pending material, then insert the replacement token');
});
