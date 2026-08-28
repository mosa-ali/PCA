import { test, expect } from '@playwright/test';
import { computeUniqueTotp } from './totp';
import { adminAccount, seedPassword } from './qaManifest';

/**
 * Coordinator B (QA/runtime) explicit security test: proves
 * backend/src/platformadmin/auth/PlatformAdminAuthService.ts's
 * TOTP-REPLAY-1 counter-claim actually rejects a SECOND login attempt that
 * reuses the exact same (still-valid, same 30s window) TOTP code, against
 * the real backend/MySQL QA stack -- not just asserted from reading the
 * source. Uses a dedicated account (app_owner_replay_test) never used by
 * any other test, and drives the real /platform-admin/auth/login endpoint
 * directly (page.request, real HTTP round trip, real cookies/session
 * context) rather than through the login form, so both requests land
 * reliably inside the SAME 30-second window back-to-back.
 */

const SEED_PASSWORD = seedPassword();

test('APP_OWNER: a TOTP code cannot be replayed for a second login (TOTP-REPLAY-1)', async ({ page }) => {
  const account = adminAccount('app_owner_replay_test');
  await page.goto('/login');
  const code = await computeUniqueTotp(account.totpSecretBase32, account.email);

  const first = await page.request.post('/platform-admin/auth/login', {
    headers: { 'Content-Type': 'application/json' },
    data: { email: account.email, password: SEED_PASSWORD, totpCode: code },
  });
  expect(first.status(), 'first login with a fresh TOTP code must succeed').toBe(200);

  const replay = await page.request.post('/platform-admin/auth/login', {
    headers: { 'Content-Type': 'application/json' },
    data: { email: account.email, password: SEED_PASSWORD, totpCode: code },
  });
  expect(replay.status(), 'replaying the SAME TOTP code for a second login must be rejected').toBe(401);
  const replayBody = await replay.json();
  // The backend deliberately gives a generic, non-enumerating error for
  // every MFA-stage failure (wrong code, expired code, or a replayed one) --
  // asserting the specific error string would assert a distinguishing
  // oracle the backend intentionally does not provide.
  expect(replayBody).toHaveProperty('error');
});
