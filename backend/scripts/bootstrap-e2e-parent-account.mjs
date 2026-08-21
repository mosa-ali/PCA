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
import { getPool, closePool } from '../dist/db/pool.js';
import { AuthService } from '../dist/auth/AuthService.js';
import { MySqlAuthRepository } from '../dist/auth/MySqlAuthRepository.js';
import { ParentAccountService } from '../dist/parentaccount/ParentAccountService.js';
import { MySqlParentAccountRepository } from '../dist/parentaccount/MySqlParentAccountRepository.js';
import { createTestSandboxEmailSender } from '../dist/parentaccount/TestSandboxEmailSender.js';
import { FamilyOwnerAttestationChainEngine } from '../dist/familycommercial/authority/FamilyOwnerAttestationChainEngine.js';
import { MySqlFamilyAuthorityGenesisStore } from '../dist/familycommercial/authority/MySqlGenesisAnchorStore.js';
import { MySqlFamilyAuthorityAttestationChainStore } from '../dist/familycommercial/authority/MySqlAttestationChainStore.js';
// PCA-DEC-020: production wires RejectingDeviceSignatureVerifier (unconditional
// fail-closed, pending human security review of the real CRYPTO_SUITE) --
// this script instead uses the SAME sanctioned test-only substitution
// backend/test/parentaccount/e2e.registrationToOwnerMutation.test.mjs and
// seed-local.mjs already established: a genuinely real Ed25519 verifier, not
// a fake "always allow", just not the one selected for production pending
// that review.
import { createEd25519DeviceSignatureVerifier } from '../dist/parentaccount/genesisDeviceSigner.js';

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

const email = requireEnv('E2E_REAL_PARENT_EMAIL');
const password = requireEnv('E2E_REAL_PARENT_PASSWORD');

const authService = new AuthService(new MySqlAuthRepository());
const emailSender = createTestSandboxEmailSender();
const familyAuthorityChainEngine = new FamilyOwnerAttestationChainEngine(
  new MySqlFamilyAuthorityGenesisStore(),
  new MySqlFamilyAuthorityAttestationChainStore(),
  createEd25519DeviceSignatureVerifier(),
  () => new Date(),
);
const parentAccountService = new ParentAccountService({
  repository: new MySqlParentAccountRepository(),
  authService,
  emailSender,
  familyGenesisEngine: familyAuthorityChainEngine,
});

await parentAccountService.register(email, password, password);
const code = emailSender.lastCodeFor(email);
if (!code) throw new Error(`Bootstrap failed: no verification code recorded for ${email}`);
const outcome = await parentAccountService.verifyEmail(email, code);

console.log('Parent account created and verified.');
console.log(`accountId: ${outcome.accountId}`);
console.log(`familyId: ${outcome.familyId ?? '(none -- family genesis did not complete)'}`);
console.log(`email: ${email}`);

await closePool();
