// Disposable-database fixture helpers for the PCA-DEC-030 Parent journey
// (register -> verify -> first login -> optional authenticator enrollment).
// Replaces the retired ./completeFamilyGenesis.mjs. Every step runs through
// the SAME ParentAccountService methods the production HTTP routes drive; the
// only fixture privilege is reading emailed codes back from the in-process
// TestSandboxEmailSender, which refuses to construct outside test/development.
import { randomUUID } from 'node:crypto';
import { AuthService } from '../../dist/auth/AuthService.js';
import { MySqlAuthRepository } from '../../dist/auth/MySqlAuthRepository.js';
import { MySqlParentAccountRepository } from '../../dist/parentaccount/MySqlParentAccountRepository.js';
import { MySqlFamilyMembershipRepository } from '../../dist/familymembers/MySqlFamilyMembershipRepository.js';
import { ParentAccountService } from '../../dist/parentaccount/ParentAccountService.js';
import { ParentMfaService } from '../../dist/parentaccount/mfa/ParentMfaService.js';
import { MySqlParentMfaRepository } from '../../dist/parentaccount/mfa/MySqlParentMfaRepository.js';
import { loadParentMfaKeyring } from '../../dist/parentaccount/mfa/parentTotp.js';
import { generateDailyLoginGrant } from '../../dist/parentaccount/dailyLoginGrant.js';
import { DAILY_LOGIN_GRANT_TTL_MS } from '../../dist/parentaccount/policy.js';
import { base32Decode, computeTotp } from '../../dist/platformadmin/auth/totp.js';

/** Composes ParentAccountService exactly as main.ts does. PCA_PARENT_MFA_ENC_KEY must be set (and must match the backend under test). */
export function createDisposableParentAccountService({ emailSender, now = () => new Date() }) {
  loadParentMfaKeyring(process.env);
  return new ParentAccountService({
    repository: new MySqlParentAccountRepository(),
    authService: new AuthService(new MySqlAuthRepository(), now),
    emailSender,
    mfaService: new ParentMfaService({ repository: new MySqlParentMfaRepository(), keyring: () => loadParentMfaKeyring(process.env), now }),
    familyMembershipRepository: new MySqlFamilyMembershipRepository(),
    now,
  });
}

/**
 * register -> verify -> login -> emailed login code. Returns the provisioned
 * family, the ADMINISTRATOR role, the grace deadline, a live session token and
 * this "browser's" daily grant (valid 24 h, inside grace only).
 */
export async function provisionSignedInParent({ service, emailSender, email, password }) {
  await service.register(email, password, password);
  const verificationCode = emailSender.lastCodeFor(email);
  if (!verificationCode) throw new Error('Fixture failed: no verification code was recorded.');
  await service.verifyEmail(email, verificationCode);
  const login = await service.login(email, password);
  if (login.status !== 'STEP_UP_REQUIRED') throw new Error(`Fixture failed: expected STEP_UP_REQUIRED, got ${login.status}.`);
  const completed = await service.completeLoginStepUp(email, emailSender.lastCodeFor(email, 'LOGIN_STEP_UP'));
  if (completed.status !== 'AUTHENTICATED' || !completed.familyId || completed.role !== 'ADMINISTRATOR') {
    throw new Error('Fixture failed: first login did not provision an ADMINISTRATOR family.');
  }
  return {
    accountId: completed.accountId,
    familyId: completed.familyId,
    role: completed.role,
    graceExpiresAt: completed.mfa.graceExpiresAt?.toISOString() ?? null,
    sessionToken: completed.rawSessionToken,
    dailyLoginGrant: completed.rawDailyLoginGrantToken,
  };
}

/** Enrolls an authenticator through the real session-path endpoints and returns the base32 secret a test authenticator app would hold. */
export async function enrollParentAuthenticator({ service, sessionToken, email, password, nowMs = Date.now() }) {
  const credential = { kind: 'SESSION', rawSessionToken: sessionToken };
  const { secretBase32 } = await service.beginMfaEnrollment(credential, email, password);
  await service.confirmMfaEnrollment(credential, email, computeTotp(base32Decode(secretBase32), nowMs));
  return secretBase32;
}

/** Issues one extra browser grant through the production repository method (hash-only at rest, 24 h). */
export async function issueDailyLoginGrant({ repository, accountId, now = new Date(), ttlMs = DAILY_LOGIN_GRANT_TTL_MS }) {
  const grant = generateDailyLoginGrant();
  await repository.insertDailyLoginGrant({
    grantId: randomUUID(),
    accountId,
    tokenHash: grant.tokenHash,
    purpose: 'PARENT_DAILY_LOGIN',
    createdAt: now,
    expiresAt: new Date(now.getTime() + ttlMs),
  });
  return grant.rawToken;
}
