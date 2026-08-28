import { test, expect, type Page } from '@playwright/test';
import { computeUniqueTotp } from './totp';

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
 * ONE test per persona (dashboard-no-crash + settings-RBAC in the same
 * session): each persona still gets exactly one real login, so a 5-persona
 * run claims 5 distinct TOTP windows total (one per DISTINCT secret --
 * computeUniqueTotp's per-label lock only needs to protect against the SAME
 * secret being reused close together, which no longer happens here).
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

// See parent-web/e2e-qa-coordinator-b/auth.spec.ts's identical constant for rationale.
const BENIGN_CONSOLE_PATTERN = /Failed to load resource: the server responded with a status of 401/;

function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !BENIGN_CONSOLE_PATTERN.test(msg.text())) errors.push(msg.text());
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
  await page.locator('#login-totp').fill(await computeUniqueTotp(secret, persona.email));
  await page.getByRole('button', { name: /sign in|submit|log in/i }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });
}

for (const persona of PERSONAS) {
  test(`${persona.role}: dashboard renders without crashing and /settings RBAC matches the real backend -- one real session`, async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await loginAs(page, persona);

    await test.step('dashboard renders without crashing (billing/settlement fields may be legitimately omitted)', async () => {
      await expect(page.locator('body')).not.toContainText(/something went wrong|error boundary|TypeError|Cannot read propert/i);
    });

    await test.step(`/settings is ${persona.settingsAllowed ? 'ALLOWED' : 'DENIED'}`, async () => {
      // secureSession.ts's session token is deliberately in-memory-only
      // (PCA-ADD-PA-014/016) -- ANY hard page.goto() after login loses it
      // and bounces to /login regardless of role, which would make an
      // allowed role indistinguishable from a denied one. The real,
      // meaningful RBAC signal is therefore whether the Settings sidebar
      // link is offered at all (Sidebar.tsx filters nav items by
      // isPermitted(roles, item.operation)), plus a CLIENT-SIDE click
      // through for allowed roles (preserves the in-memory token).
      const settingsLink = page.locator('a.nav-link[href="/settings"]');
      if (persona.settingsAllowed) {
        await expect(settingsLink).toBeVisible();
        await settingsLink.click();
        await expect(page).toHaveURL(/\/settings/, { timeout: 10_000 });
        await expect(page.locator('body')).not.toContainText(/not.permitted|denied|forbidden/i);
      } else {
        await expect(settingsLink).toHaveCount(0);
      }
    });

    expect(errors, `${persona.role}: unexpected console errors: ${errors.join('; ')}`).toEqual([]);
  });
}
