// Real-backend E2E bootstrap for parent-web's e2e-real suite (mirrors
// bootstrap-platform-owner.mjs's role for platform-admin-web). Creates and
// email-verifies exactly one real parent account, through the SAME real
// ParentAccountService/MySqlParentAccountRepository/AuthService classes
// backend/src/main.ts wires in production -- never hand-crafted SQL rows.
//
// WHY THIS SCRIPT EXISTS AT ALL (rather than having Playwright drive
// registration through the browser): the verification code is delivered
// via EmailSenderPort, and this environment's only non-production sender
// (TestSandboxEmailSender) exposes the "sent" code through an in-process
// accessor (lastCodeFor), never through HTTP -- there is deliberately no
// email inbox or verification-code-read route for a separate browser
// process to reach. See TestSandboxEmailSender.ts's own header. This
// mirrors seed-local.mjs's exact precedent for the same reason.
//
// Requires NODE_ENV=test or development (TestSandboxEmailSender's own
// production gate) and PCA_DATABASE_URL pointing at the disposable local
// database (verify-mysql.mjs's own hostname allowlist reasoning applies
// here too).
import { closePool } from '../dist/db/pool.js';
import { createTestSandboxEmailSender } from '../dist/parentaccount/TestSandboxEmailSender.js';
import { createDisposableParentAccountService, provisionSignedInParent } from './lib/provisionParentAccount.mjs';

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required to run bootstrap-e2e-parent-account.mjs.`);
  return value;
}

const connectionString = requireEnv('PCA_DATABASE_URL');
const url = new URL(connectionString);
if (!['127.0.0.1', 'localhost', 'mysql'].includes(url.hostname)) {
  throw new Error('Refusing to bootstrap: PCA_DATABASE_URL must point to the disposable local/Compose database.');
}
requireEnv('PCA_PARENT_MFA_ENC_KEY');

const email = requireEnv('E2E_REAL_PARENT_EMAIL');
const password = requireEnv('E2E_REAL_PARENT_PASSWORD');

// PCA-DEC-037: register -> verify -> first login (family provisioned, MFA grace started).
const emailSender = createTestSandboxEmailSender();
const service = createDisposableParentAccountService({ emailSender });
await provisionSignedInParent({ service, emailSender, email, password });

console.log('Parent account created, verified and signed in for the configured E2E_REAL_PARENT_EMAIL.');
console.log('Disposable Parent family provisioning completed.');

await closePool();
