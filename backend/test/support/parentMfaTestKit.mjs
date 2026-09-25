// Shared test kit for PCA-DEC-030 Parent MFA. Test-only key material; never a
// production value. Every test that composes ParentAccountService should use
// createParentAccountTestKit so the MFA dependency is always the real
// ParentMfaService over the in-memory repository double.
import { computeTotp, base32Decode } from '../../dist/platformadmin/auth/totp.js';
import { ParentAccountService } from '../../dist/parentaccount/ParentAccountService.js';
import { ParentMfaService } from '../../dist/parentaccount/mfa/ParentMfaService.js';
import { ParentCommercialStepUpAuthority } from '../../dist/parentaccount/mfa/ParentCommercialStepUpAuthority.js';
import { loadParentMfaKeyring } from '../../dist/parentaccount/mfa/parentTotp.js';
import { createInMemoryParentMfaRepository } from './inMemoryParentMfaRepository.mjs';

export const PARENT_MFA_TEST_KEY = 'e7'.repeat(32);
if (!process.env.PCA_PARENT_MFA_ENC_KEY) process.env.PCA_PARENT_MFA_ENC_KEY = PARENT_MFA_TEST_KEY;

export function createParentMfaService({ now, repository = createInMemoryParentMfaRepository() } = {}) {
  const mfaService = new ParentMfaService({ repository, keyring: () => loadParentMfaKeyring(process.env), now });
  return { mfaService, mfaRepository: repository };
}

/**
 * Composes ParentAccountService exactly as main.ts does (real MFA service),
 * over whatever account repository/auth service/email sender the test owns.
 */
export function createParentAccountTestKit({ repository, authService, emailSender, familyMembershipRepository, now, mfaRepository } = {}) {
  const { mfaService, mfaRepository: mfaRepo } = createParentMfaService({ now, repository: mfaRepository });
  const service = new ParentAccountService({ repository, authService, emailSender, mfaService, familyMembershipRepository, now });
  const commercialOwnerAuthority = new ParentCommercialStepUpAuthority({
    accounts: repository,
    memberships: familyMembershipRepository ?? repository,
    mfa: mfaService,
  });
  return { service, mfaService, mfaRepository: mfaRepo, commercialOwnerAuthority };
}

/** The 6-digit code an authenticator app would show for `secretBase32` at `timeMs`, `stepOffset` 30-second steps away. */
export function totpFor(secretBase32, timeMs = Date.now(), stepOffset = 0) {
  return computeTotp(base32Decode(secretBase32), timeMs, stepOffset);
}

/**
 * A controllable clock. `advance(ms)` moves it forward. TOTP codes are
 * derived from the same clock so replay (same 30 s step) and freshness (a
 * later step) can be driven deterministically.
 */
export function createTestClock(startIso = '2026-09-25T08:00:00.000Z') {
  let current = new Date(startIso).getTime();
  return {
    now: () => new Date(current),
    ms: () => current,
    advance(ms) {
      current += ms;
    },
  };
}
