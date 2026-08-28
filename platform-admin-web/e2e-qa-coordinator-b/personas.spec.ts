import { test, expect, type Page } from '@playwright/test';
import { computeTotp, ensureComfortablyInsideTotpWindow } from './totp';

/**
 * Coordinator B (QA/runtime) real-browser persona sweep: logs in as each of
 * the 5 platform-admin roles seeded by backend/scripts/seed-local.mjs
 * against the real backend/MySQL QA stack, confirms the dashboard renders
 * without crashing for every role (this repo's own recent real regression:
 * Dashboard crashing when billing/settlement fields are omitted for
 * restricted roles), and confirms the /settings RBAC matrix (APP_OWNER,
 * PLATFORM_ADMIN allowed; SUPPORT_ADMIN, FINANCE_ADMIN, AUDITOR_READ_ONLY
 * denied) holds against the real backend, not just route-guard config.
 *
 * TOTP secrets are supplied via environment variables (QA_TOTP_<ROLE>),
 * copied from THIS session's most recent seed-local.mjs run output -- they
 * are freshly random every reseed, so they cannot be hardcoded here.
 */

const SEED_PASSWORD = 'Correct Horse Battery Staple 2026!';

interface Persona {
  role: string;
  email: string;
  secretEnvVar: string;
  settingsAllowed: boolean;
}

const PERSONAS: Persona[] = [
  { role: 'APP_OWNER', email: 'app_owner@pca-seed.test', secretEnvVar: 'QA_TOTP_APP_OWNER', settingsAllowed: true },
  { role: 'PLATFORM_ADMIN', email: 'platform_admin@pca-seed.test', secretEnvVar: 'QA_TOTP_PLATFORM_ADMIN', settingsAllowed: true },
  { role: 'FINANCE_ADMIN', email: 'finance_admin@pca-seed.test', secretEnvVar: 'QA_TOTP_FINANCE_ADMIN', settingsAllowed: false },
  { role: 'SUPPORT_ADMIN', email: 'support_admin@pca-seed.test', secretEnvVar: 'QA_TOTP_SUPPORT_ADMIN', settingsAllowed: false },
  { role: 'AUDITOR_READ_ONLY', email: 'auditor_read_only@pca-seed.test', secretEnvVar: 'QA_TOTP_AUDITOR_READ_ONLY', settingsAllowed: false },
];

function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  return errors;
}

async function loginAs(page: Page, persona: Persona) {
  const secret = process.env[persona.secretEnvVar];
  if (!secret) throw new Error(`${persona.secretEnvVar} not set -- copy the base32 secret from this run's seed-local.mjs output.`);
  await page.goto('/login');
  await page.locator('#login-email').fill(persona.email);
  await page.locator('#login-password').fill(SEED_PASSWORD);
  await ensureComfortablyInsideTotpWindow();
  await page.locator('#login-totp').fill(computeTotp(secret));
  await page.getByRole('button', { name: /sign in|submit|log in/i }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });
}

for (const persona of PERSONAS) {
  test(`${persona.role}: signs in and the dashboard renders without crashing (billing/settlement fields may be legitimately omitted)`, async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await loginAs(page, persona);
    await expect(page.locator('body')).not.toContainText(/something went wrong|error boundary|TypeError|Cannot read propert/i);
    expect(errors, `${persona.role} dashboard: unexpected console errors: ${errors.join('; ')}`).toEqual([]);
  });

  test(`${persona.role}: /settings is ${persona.settingsAllowed ? 'ALLOWED' : 'DENIED'} against the real backend`, async ({ page }) => {
    await loginAs(page, persona);
    await page.goto('/settings');
    if (persona.settingsAllowed) {
      await expect(page).toHaveURL(/\/settings/);
      await expect(page.locator('body')).not.toContainText(/not.permitted|denied|forbidden/i);
    } else {
      await expect(page).toHaveURL(/\/not-permitted/, { timeout: 10_000 });
    }
  });
}
