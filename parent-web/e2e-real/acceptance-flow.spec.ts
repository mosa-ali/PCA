import { test, expect } from '@playwright/test';

/**
 * PPR-2 Step 5: the owner's exact acceptance flow, against the REAL local
 * backend (fresh MySQL, migrated from zero, seeded) -- not demo fixtures.
 * See playwright.real.config.ts for why this is a separate config/testDir
 * from the existing fixture-mode e2e suite.
 *
 * Consolidated into as few logins as the flow honestly allows: this
 * backend's LOGIN_EMAIL_RATE_LIMIT/LOGIN_IP_RATE_LIMIT
 * (backend/src/parentaccount/policy.ts) are real, intentional anti-abuse
 * controls, not a test-only annoyance to route around -- so this file signs
 * in ONCE per describe block and reuses that page across steps, exactly as
 * a real parent's continuous session would, rather than a fresh login per
 * assertion.
 */
test.use({ serviceWorkers: 'block' });

const SEED_PASSWORD = 'Correct Horse Battery Staple 2026!';
// owner-a/owner-b are pre-seeded with an existing enrollment_invitations row
// each (for OTHER, unrelated billing/device-management specs) -- a real
// managed-device-slot reservation under the FREE_STARTER 1-device limit, so
// this flow's own invitation-creation step would see a genuine, correct
// MANAGED_DEVICE_LIMIT_REACHED for either of them, unrelated to the license
// decision this file exists to prove. owner-login-ok has no such fixture.
const PRIMARY_EMAIL = 'owner-login-ok@pca-seed.test';
const SECOND_EMAIL = 'owner-cp-dashboard@pca-seed.test';

async function login(page: import('@playwright/test').Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/dashboard/);
}

test.describe('PPR-2 owner acceptance flow -- real backend, one continuous session', () => {
  test('login -> new family/zero children -> add first child -> child selectable -> Download App -> invitation attempt -> Arabic/RTL -> reload', async ({ page }) => {
    // 1. login
    await login(page, PRIMARY_EMAIL, SEED_PASSWORD);

    // 8. Download App action visible -- on every page's header.
    await expect(page.getByRole('link', { name: 'Download App' })).toBeVisible();

    await page.goto('/family/devices?section=add');

    // 2. new family / zero children
    await expect(page.getByRole('heading', { name: 'Add your first child' })).toBeVisible();
    await expect(page.getByText('No child profiles available')).toHaveCount(0);

    // 3. Add first child
    await page.getByRole('button', { name: 'Someone new' }).click();
    const nameInput = page.getByLabel("Child's name");
    await expect(nameInput).toBeVisible();
    await expect(page.getByText('This name stays on your device. PCA never sends it to our servers.')).toBeVisible();
    await nameInput.fill('Ahmed');

    // 4. create opaque child profile (real backend call on advancing)
    const createChildResponse = page.waitForResponse(
      (res) => res.url().includes('/children') && res.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'What kind of device?' }).click();
    const createRes = await createChildResponse;
    expect(createRes.status()).toBe(201);
    const createdBody = await createRes.json();
    expect(Object.keys(createdBody).sort()).toEqual(['childProfileId', 'createdAt']);
    const childProfileId: string = createdBody.childProfileId;

    // 5. readable child label shown locally (session-local, not server-sourced)
    await expect(page.getByRole('heading', { level: 3, name: 'What kind of device?' })).toBeVisible();

    // 6. Add Device -- continue through platform/protection/review
    await page.getByRole('button', { name: 'How much protection?' }).click();
    await page.getByRole('button', { name: 'Review and confirm' }).click();
    await expect(page.getByText('Ahmed', { exact: true })).toBeVisible();
    // 15. no raw UUID as primary UI -- never rendered as page text.
    await expect(page.getByText(childProfileId)).toHaveCount(0);

    // 9. create invitation -- record the REAL outcome, whichever it is.
    // Owner decision (docs/pre-production/PCA_PPR2_OWNER_DECISIONS.md Part
    // M): basic/free V1 device enrollment must not require an active paid
    // license row. CREATE_INVITATION's requiresLicense is now false, so a
    // real 201 is the required outcome here, not merely an accepted one --
    // a regression back to 403 would be a real defect this test must catch.
    const invitationResponse = page.waitForResponse(
      (res) => res.url().includes('/invitations') && res.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'I understand, create invitation' }).click();
    const invRes = await invitationResponse;
    const invBody = await invRes.json().catch(() => null);
    expect(invRes.status(), `expected 201 (basic/free V1, no license required), got ${invRes.status()}: ${JSON.stringify(invBody)}`).toBe(201);
    await expect(page.getByTestId('raw-invitation-token')).toBeVisible();

    // 7. child selectable -- step 0 still shows Ahmed as a real, selectable,
    // checked radio (not the "add new" flow still active). Navigates via
    // in-app state (Back), NOT page.goto/reload: a hard navigation would
    // wipe the session-local label store by design (H2) -- that is Section
    // 14's own, separate check, not this one's. The wizard is on the
    // setup-code step (invitation created above); step back through
    // code -> review -> protection -> platform -> child.
    // exact: true -- the setup-code step's own "Copy fallback code" button
    // is otherwise also matched by a non-exact/case-insensitive name lookup
    // for "Back" (it contains "fallback"), a real ambiguity only reachable
    // now that item 9 above genuinely reaches this step (a real 201, not the
    // pre-Part-M 403 this spec never got past before).
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await expect(page.getByLabel('Ahmed')).toBeChecked();
    await expect(page.getByRole('heading', { name: 'Add your first child' })).toHaveCount(0);

    // 10/11. Arabic switch + RTL -- same session, label still resolved.
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    await page.getByRole('button', { name: 'العربية' }).click();
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { name: 'لمن هذا الجهاز؟' })).toBeVisible();
    await expect(page.getByText('Ahmed', { exact: true })).toBeVisible();
    // back to English for the remaining steps' English selectors.
    await page.getByRole('button', { name: 'English' }).click();
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');

    // 12. responsive/mobile widths -- same session, no extra login.
    await page.setViewportSize({ width: 375, height: 812 });
    await expect(page.getByRole('heading', { name: 'Who is this device for?' })).toBeVisible();
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth, 'page must not scroll horizontally at 375px width').toBeLessThanOrEqual(clientWidth + 1);
    await page.setViewportSize({ width: 1280, height: 800 });

    // 14. reload -> setup-required expected (trusted-browser gate, unrelated
    // to the child registry, must never be weakened by this session's edits).
    await page.goto('/dashboard');
    await expect(page.getByText('Finish setting up this browser')).toBeVisible();
    await page.reload();
    await expect(page.getByText('Finish setting up this browser')).toBeVisible();
    await expect(page.getByText("This browser is not trusted with your family's data yet.")).toBeVisible();
  });
});

// 13. unauthorized/cross-family negative check -- a second, independent
// account must never read or write against the first account's family. The
// real, server-enforced boundary (PPR-2 Step 4's security report); the
// client-side role heuristic is documented as non-authoritative and is not
// re-tested here. Its own describe block/login is unavoidable -- this is
// genuinely a second identity, not reusable session state.
test.describe('PPR-2 cross-family isolation -- real backend', () => {
  test("a second family's session cannot read or create against the first family's id", async ({ page }) => {
    await login(page, PRIMARY_EMAIL, SEED_PASSWORD);
    const meRes = await page.request.get('/api/parent/session');
    expect(meRes.status()).toBe(200);
    const ownFamilyId = (await meRes.json()).familyId as string;

    await login(page, SECOND_EMAIL, SEED_PASSWORD);
    const crossList = await page.request.get(`/v1/families/${ownFamilyId}/children`);
    expect(crossList.status(), "cross-family LIST must be 403, not 200 with someone else's rows").toBe(403);

    const crossCreate = await page.request.post(`/v1/families/${ownFamilyId}/children`, { data: {} });
    expect(crossCreate.status(), 'cross-family CREATE must be 403').toBe(403);
  });
});
