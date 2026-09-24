// TEST-ONLY support for parent-web/e2e-real/genesis.spec.ts. Refuses to run
// against anything but the disposable local/Compose database and refuses
// NODE_ENV=production, exactly like scripts/provision-e2e-accounts.mjs.
//
// WHY IT EXISTS: the genesis step-up code is emailed through the running
// backend's in-process TestSandboxEmailSender, which a browser test cannot
// read, and only its HMAC is stored. The spec therefore performs the real UI
// step-up request (so the real authorization row exists, bound to the real
// browser session) and then asks this helper to replace that row's stored
// code hash with the hash of a code the spec chose. Everything else in the
// ceremony -- session binding, challenge, signatures, verification, the atomic
// commit -- runs unmodified in the real backend.
//
// Commands (all output is JSON on stdout, no secret material):
//   set-step-up-code <email> <6-digit code>
//   genesis-device <email>   -> { familyId, deviceId, keyId, publicKey, status }
import { closePool, execute, runInTransaction } from '../../dist/db/pool.js';
import { hashParentEmail } from '../../dist/parentaccount/emailHash.js';
import { hashVerificationCode } from '../../dist/parentaccount/verificationCode.js';

const DISPOSABLE_DATABASE_HOSTS = ['127.0.0.1', 'localhost', 'mysql'];

function refuse(reason) {
  throw new Error(`Refusing to run the genesis E2E support helper: ${reason}`);
}

const connectionString = process.env.PCA_DATABASE_URL;
if (!connectionString) refuse('PCA_DATABASE_URL is required.');
if (!DISPOSABLE_DATABASE_HOSTS.includes(new URL(connectionString).hostname)) refuse('PCA_DATABASE_URL must point at the disposable local/Compose database.');
if (process.env.NODE_ENV === 'production') refuse('this is a test helper and must never run in production.');

async function accountByEmail(conn, email) {
  const { rows } = await execute(conn, `SELECT account_id, service_account_id, family_id FROM parent_accounts WHERE email_hash = ?`, [hashParentEmail(email)]);
  if (!rows[0]) refuse('no parent account for that email.');
  return rows[0];
}

const [command, email, code] = process.argv.slice(2);
try {
  if (command === 'set-step-up-code') {
    if (!/^\d{6}$/.test(code ?? '')) refuse('code must be 6 digits.');
    const result = await runInTransaction(async (conn) => {
      const account = await accountByEmail(conn, email);
      const { rows } = await execute(
        conn,
        `SELECT authorization_id FROM parent_genesis_step_up_authorizations
          WHERE account_id = ? AND verified_at IS NULL AND consumed_at IS NULL
          ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
        [account.account_id],
      );
      if (!rows[0]) refuse('no pending genesis step-up authorization -- request the step-up in the browser first.');
      const updated = await execute(conn, `UPDATE parent_genesis_step_up_authorizations SET code_hash = ? WHERE authorization_id = ?`, [
        hashVerificationCode(code),
        rows[0].authorization_id,
      ]);
      return { updated: updated.rowCount };
    });
    console.log(JSON.stringify(result));
  } else if (command === 'genesis-device') {
    const result = await runInTransaction(async (conn) => {
      const account = await accountByEmail(conn, email);
      if (!account.family_id) return { familyId: null };
      const { rows } = await execute(
        conn,
        `SELECT d.device_id, d.status, k.key_id, k.public_key
           FROM devices d JOIN device_public_keys k ON k.device_id = d.device_id AND k.key_purpose = 'DSK'
          WHERE d.family_id = ? AND d.registered_by_account_id = ?`,
        [account.family_id, account.service_account_id],
      );
      if (rows.length !== 1) refuse(`expected exactly one genesis device, found ${rows.length}.`);
      return { familyId: account.family_id, deviceId: rows[0].device_id, keyId: rows[0].key_id, publicKey: rows[0].public_key, status: rows[0].status };
    });
    console.log(JSON.stringify(result));
  } else {
    refuse(`unknown command ${JSON.stringify(command)}.`);
  }
} finally {
  await closePool();
}
