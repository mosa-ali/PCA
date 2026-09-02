// Credential-binding red team with FRESH codes.
//
// The seeded verification/password-reset codes are TTL-bounded, and a long QA
// session outlives them (see PCA_QA_DEFECT_HANDOFF.md QA-B-003), so replaying
// them proves nothing: every attempt fails as `invalid_code` whether the
// single-use control works or not. This script therefore mints codes through
// the SAME real service classes seed-local.mjs and main.ts use, then exercises
// them over real HTTP against the running backend immediately, so single-use
// and account-binding are proven by a call that actually SUCCEEDS first.
//
// TEST-ONLY, disposable-local-DB only (same hostname allowlist as the seed).
process.env.PLATFORM_ADMIN_MFA_ENC_KEY ??= 'ab'.repeat(32);

import { randomUUID } from 'node:crypto';
import { getPool, closePool } from '../dist/db/pool.js';
import { AuthService } from '../dist/auth/AuthService.js';
import { MySqlAuthRepository } from '../dist/auth/MySqlAuthRepository.js';
import { ParentAccountService } from '../dist/parentaccount/ParentAccountService.js';
import { MySqlParentAccountRepository } from '../dist/parentaccount/MySqlParentAccountRepository.js';
import { createTestSandboxEmailSender } from '../dist/parentaccount/TestSandboxEmailSender.js';
import { FamilyOwnerAttestationChainEngine } from '../dist/familycommercial/authority/FamilyOwnerAttestationChainEngine.js';
import { MySqlFamilyAuthorityGenesisStore } from '../dist/familycommercial/authority/MySqlGenesisAnchorStore.js';
import { MySqlFamilyAuthorityAttestationChainStore } from '../dist/familycommercial/authority/MySqlAttestationChainStore.js';
import { createEd25519DeviceSignatureVerifier } from '../dist/parentaccount/genesisDeviceSigner.js';

const connectionString = process.env.PCA_DATABASE_URL;
if (!connectionString) throw new Error('PCA_DATABASE_URL is required.');
if (!['127.0.0.1', 'localhost', 'mysql'].includes(new URL(connectionString).hostname)) {
  throw new Error('Refusing to run: PCA_DATABASE_URL must point to the disposable local database.');
}

const BACKEND = process.env.QA_BACKEND_URL ?? 'http://127.0.0.1:4011';
const PASSWORD = 'Seed-Passw0rd!23';
const ROTATED = 'Rotated-Closure-Pass!9';

getPool();
const authService = new AuthService(new MySqlAuthRepository());
const emailSender = createTestSandboxEmailSender();
const parentAccountService = new ParentAccountService({
  repository: new MySqlParentAccountRepository(),
  authService,
  emailSender,
  familyGenesisEngine: new FamilyOwnerAttestationChainEngine(
    new MySqlFamilyAuthorityGenesisStore(),
    new MySqlFamilyAuthorityAttestationChainStore(),
    createEd25519DeviceSignatureVerifier(),
    () => new Date(),
  ),
});

const findings = [];
const checks = [];
function record(name, passed, detail) {
  checks.push({ name, passed, detail });
  if (!passed) findings.push({ name, detail });
  console.log(`${passed ? 'PASS' : 'FINDING'}  ${name}  -- ${detail}`);
}

async function http(path, body) {
  const res = await fetch(`${BACKEND}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { /* no body */ }
  return { status: res.status, json };
}

const tag = randomUUID().slice(0, 8);
const unverified = `qa-verify-${tag}@pca-seed.test`;
const resettable = `qa-reset-${tag}@pca-seed.test`;
const bystander = `qa-bystander-${tag}@pca-seed.test`;

try {
  // ---- mint a fresh, unverified account + its real verification code ----
  await parentAccountService.register(unverified, PASSWORD, PASSWORD);
  const verifyCode = emailSender.lastCodeFor(unverified);
  await parentAccountService.register(bystander, PASSWORD, PASSWORD);
  const bystanderCode = emailSender.lastCodeFor(bystander);
  if (!verifyCode || !bystanderCode) throw new Error('no verification code recorded');

  // 1. account binding: one account's code must not verify another
  {
    const r = await http('/api/parent/verify-email', { email: bystander, code: verifyCode });
    record("a verification code cannot verify a different account",
      r.status >= 400, `cross-account verify -> ${r.status} ${JSON.stringify(r.json)}`);
  }

  // 2. the fresh code verifies its OWN account, exactly once
  {
    const first = await http('/api/parent/verify-email', { email: unverified, code: verifyCode });
    const replay = await http('/api/parent/verify-email', { email: unverified, code: verifyCode });
    record('verification code is single-use (proven after a real success)',
      first.status === 200 && replay.status >= 400,
      `first=${first.status} replay=${replay.status} ${JSON.stringify(replay.json)}`);
  }

  // ---- mint a fresh verified account + a real password-reset code ----
  await parentAccountService.register(resettable, PASSWORD, PASSWORD);
  const rc = emailSender.lastCodeFor(resettable);
  await parentAccountService.verifyEmail(resettable, rc);
  await parentAccountService.requestPasswordReset(resettable);
  const resetCode = emailSender.lastCodeFor(resettable, 'PASSWORD_RESET');
  if (!resetCode) throw new Error('no password-reset code recorded');

  // 3. account binding on the reset path
  {
    const r = await http('/api/parent/reset-password', {
      email: bystander, code: resetCode, newPassword: ROTATED, newPasswordConfirmation: ROTATED,
    });
    record("a password-reset code cannot reset a different account",
      r.status >= 400, `cross-account reset -> ${r.status} ${JSON.stringify(r.json)}`);
  }

  // 4. single-use on the reset path, proven after a real success
  {
    const first = await http('/api/parent/reset-password', {
      email: resettable, code: resetCode, newPassword: ROTATED, newPasswordConfirmation: ROTATED,
    });
    const replay = await http('/api/parent/reset-password', {
      email: resettable, code: resetCode, newPassword: 'Different-Pass!5', newPasswordConfirmation: 'Different-Pass!5',
    });
    record('password-reset code is single-use (proven after a real success)',
      first.status === 200 && replay.status >= 400,
      `first=${first.status} replay=${replay.status} ${JSON.stringify(replay.json)}`);

    // 5. the rotation is real
    const oldPw = await http('/api/parent/login', { email: resettable, password: PASSWORD });
    const newPw = await http('/api/parent/login', { email: resettable, password: ROTATED });
    record('reset actually rotates the credential',
      oldPw.status >= 400 && newPw.status === 200,
      `oldPassword=${oldPw.status} newPassword=${newPw.status}`);
  }

  // 6. mismatched confirmation is refused
  {
    await parentAccountService.requestPasswordReset(resettable);
    const code2 = emailSender.lastCodeFor(resettable, 'PASSWORD_RESET');
    const r = await http('/api/parent/reset-password', {
      email: resettable, code: code2, newPassword: 'Aaa-Pass!11', newPasswordConfirmation: 'Bbb-Pass!22',
    });
    record('a mismatched password confirmation is refused',
      r.status >= 400, `mismatched confirmation -> ${r.status} ${JSON.stringify(r.json)}`);
  }
} finally {
  await closePool();
}

console.log('');
console.log(`CREDENTIAL_CHECKS_RUN = ${checks.length}`);
console.log(`CREDENTIAL_FINDINGS_OPEN = ${findings.length}`);
for (const f of findings) console.log(`  - ${f.name}: ${f.detail}`);
if (findings.length) process.exitCode = 1;
