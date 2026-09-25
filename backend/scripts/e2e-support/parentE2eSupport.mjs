// TEST-ONLY support for the real-browser Parent specs (parent-web/e2e-real).
// Refuses to run against anything but the disposable local/Compose database
// and refuses NODE_ENV=production, exactly like scripts/provision-e2e-accounts.mjs.
//
// WHY IT EXISTS: emailed codes are delivered through the running backend's
// in-process TestSandboxEmailSender, which a browser test cannot read, and only
// their hashes are stored. The spec performs the real UI action (so the real
// code row exists) and then asks this helper to replace that row's stored hash
// with the hash of a code the spec chose. Every check around the code --
// attempt budget, expiry, single use, what the code unlocks -- runs unmodified.
//
// Commands (JSON on stdout, never secret material):
//   set-verification-code <email> <6 digits>   (latest registration code)
//   set-login-step-up-code <email> <6 digits>  (latest emailed login code)
//   set-mfa-recovery-code <email> <6 digits>   (latest lost-authenticator code)
//   mfa-state <email>  -> { status, graceExpiresAt, enrolled }
//   expire-grace <email>  -> moves this account's grace deadline into the past
import { closePool, execute, runInTransaction } from '../../dist/db/pool.js';
import { hashParentEmail } from '../../dist/parentaccount/emailHash.js';
import { hashVerificationCode } from '../../dist/parentaccount/verificationCode.js';

const DISPOSABLE_DATABASE_HOSTS = ['127.0.0.1', 'localhost', 'mysql'];

function refuse(reason) {
  throw new Error(`Refusing to run the Parent E2E support helper: ${reason}`);
}

const connectionString = process.env.PCA_DATABASE_URL;
if (!connectionString) refuse('PCA_DATABASE_URL is required.');
if (!DISPOSABLE_DATABASE_HOSTS.includes(new URL(connectionString).hostname)) refuse('PCA_DATABASE_URL must point at the disposable local/Compose database.');
if (process.env.NODE_ENV === 'production') refuse('this is a test helper and must never run in production.');

async function accountId(conn, email) {
  const { rows } = await execute(conn, `SELECT account_id FROM parent_accounts WHERE email_hash = ?`, [hashParentEmail(email)]);
  if (!rows[0]) refuse('no parent account for that email.');
  return rows[0].account_id;
}

/** Replaces the hash of the account's LATEST unconsumed code in `table` -- the exact row the service will verify. */
async function setLatestCode(table, email, code) {
  if (!/^\d{6}$/.test(code ?? '')) refuse('code must be 6 digits.');
  return runInTransaction(async (conn) => {
    const id = await accountId(conn, email);
    const { rows } = await execute(conn, `SELECT code_id, consumed_at FROM ${table} WHERE account_id = ? ORDER BY created_at DESC, code_id DESC LIMIT 1 FOR UPDATE`, [id]);
    if (!rows[0] || rows[0].consumed_at !== null) refuse(`no pending code in ${table} -- perform the UI step first.`);
    const updated = await execute(conn, `UPDATE ${table} SET code_hash = ? WHERE code_id = ?`, [hashVerificationCode(code), rows[0].code_id]);
    return { updated: updated.rowCount };
  });
}

const TABLES = {
  'set-verification-code': 'parent_email_verification_codes',
  'set-login-step-up-code': 'parent_login_step_up_codes',
  'set-mfa-recovery-code': 'parent_mfa_recovery_codes',
};

const [command, email, code] = process.argv.slice(2);
try {
  if (TABLES[command]) {
    console.log(JSON.stringify(await setLatestCode(TABLES[command], email, code)));
  } else if (command === 'mfa-state') {
    const result = await runInTransaction(async (conn) => {
      const id = await accountId(conn, email);
      const { rows } = await execute(conn, `SELECT status, grace_expires_at, enrolled_at FROM parent_mfa_state WHERE account_id = ?`, [id]);
      if (!rows[0]) return { status: 'NOT_STARTED', graceExpiresAt: null, enrolled: false };
      return { status: rows[0].status, graceExpiresAt: rows[0].grace_expires_at.toISOString(), enrolled: rows[0].enrolled_at !== null };
    });
    console.log(JSON.stringify(result));
  } else if (command === 'expire-grace') {
    // Simulates the passage of 3 days for the server; the browser clock is irrelevant by design.
    const result = await runInTransaction(async (conn) => {
      const id = await accountId(conn, email);
      const updated = await execute(
        conn,
        `UPDATE parent_mfa_state SET grace_started_at = DATE_SUB(NOW(3), INTERVAL 4 DAY), grace_expires_at = DATE_SUB(NOW(3), INTERVAL 1 DAY) WHERE account_id = ? AND status = 'NOT_ENROLLED'`,
        [id],
      );
      return { updated: updated.rowCount };
    });
    console.log(JSON.stringify(result));
  } else {
    refuse(`unknown command ${JSON.stringify(command)}.`);
  }
} finally {
  await closePool();
}
