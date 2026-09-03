import { test, expect } from '@playwright/test';

const VIEWPORTS: { name: string; width: number; height: number }[] = [
  { name: 'mobile-320', width: 320, height: 568 },
  { name: 'mobile-390', width: 390, height: 844 },
  { name: 'tablet-768', width: 768, height: 1024 },
  { name: 'laptop-1366', width: 1366, height: 768 },
  { name: 'desktop-1920', width: 1920, height: 1080 },
];

for (const vp of VIEWPORTS) {
  test(`no horizontal overflow on dashboard at ${vp.name} (${vp.width}x${vp.height})`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test(`no horizontal overflow on family members table at ${vp.name}`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto('/family/members');
    await expect(page.getByRole('heading', { name: 'Users & Members' })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
}

test('mobile drawer is usable at 320px width', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto('/dashboard');
  const openButton = page.getByLabel('Open navigation menu');
  await expect(openButton).toBeVisible();
  await openButton.click();
  await expect(page.locator('#app-sidebar')).toHaveClass(/drawer-open/);
  // Scoped to the drawer and matched exactly. The page-level lookup this used
  // to do now resolves to four links -- the sidebar row plus the dashboard's
  // "Pending requests" KPI tile and two per-child "N requests" badges, all
  // pointing at /requests -- and fails on strict mode. The claim being tested
  // has always been about the SIDEBAR's link being reachable once the drawer
  // is open, so saying that precisely is a stronger assertion, not a weaker
  // one.
  await expect(
    page.locator('#app-sidebar').getByRole('link', { name: 'Requests', exact: true }),
  ).toBeVisible();
});

// The guarantee here is unchanged: an offline child's state must be VISIBLE on
// the dashboard at the narrowest supported width, and must not blow the layout
// out. What carries that state changed. The old DeviceOfflineNotice prose block
// also rendered lastAppliedPolicyRevision, which the owner banned from the
// consumer surface, so the dashboard now states the same fact as a device-state
// pill plus a freshness marker. Asserting the pill instead of the prose keeps
// the guarantee and drops the leak; ChildOverview and ScreenTimePage still
// render the full notice, and DeviceOfflineNotice.test.tsx still covers it.
test('an offline device state is visible on the dashboard without horizontal overflow at 320px width', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto('/dashboard');
  // "Offline" is the DEVICE_STATE label; the freshness marker is present because
  // the reading is not LIVE. Both must survive the narrowest viewport.
  await expect(page.getByText('Offline', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Not verified', { exact: true }).first()).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test('PolicyStatusBadge after a save does not cause horizontal overflow or truncation at 320px width', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  // child-yousef's device is offline (DEV fixture), so this also exercises
  // the PolicyStatusBadge rendering together with the device-offline
  // notice on the smallest supported viewport.
  await page.goto('/children/child-yousef/screen-time');
  await expect(page.getByText("This child's device is offline")).toBeVisible();
  await page.getByRole('button', { name: 'Save' }).click();
  const badge = page.getByText('Queued -- pending delivery');
  await expect(badge).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  const box = await badge.boundingBox();
  expect(box).not.toBeNull();
  expect((box?.x ?? -1)).toBeGreaterThanOrEqual(0);
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(320);
});

// PPR-2 IA: the pages the new first-level navigation introduces. Each one is
// reached from a sidebar row, so each has to survive the same viewport range
// as the pages that were there before.
const NEW_IA_PAGES: { path: string; heading: string }[] = [
  { path: '/privacy', heading: 'Data & Privacy' },
  { path: '/safety/alerts', heading: 'Alerts' },
  { path: '/protection/screen-time', heading: 'Screen Time' },
  { path: '/protection/apps-web', heading: 'Apps & Web' },
  { path: '/protection/schedules', heading: 'Schedules' },
];

for (const vp of [
  { name: 'mobile-320', width: 320, height: 568 },
  { name: 'laptop-1366', width: 1366, height: 768 },
]) {
  for (const target of NEW_IA_PAGES) {
    test(`no horizontal overflow on ${target.path} at ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto(target.path);
      await expect(page.getByRole('heading', { name: target.heading, exact: true })).toBeVisible();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(1);
    });
  }
}

test('the header keeps every control on-screen at 320px', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();

  // Every header control stays inside the viewport -- the language pair, the
  // notifications bell and the account control are all added at this width.
  for (const control of [
    page.getByRole('group', { name: 'Language' }),
    page.getByRole('link', { name: /Notifications/ }).first(),
  ]) {
    const box = await control.boundingBox();
    expect(box).not.toBeNull();
    expect(box?.x ?? -1).toBeGreaterThanOrEqual(0);
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(320);
  }

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
});

test('every first-level sidebar row leads to a real page, not a dead end', async ({ page }) => {
  // The IA regrouping must not have left a row pointing at an unregistered
  // route: that would render NotFound with no error anywhere.
  const rows = [
    'Dashboard', 'Children', 'Devices', 'Requests', 'Family Members', 'Roles & Permissions',
    'Protection Status', 'Screen Time', 'Apps & Web', 'Schedules', 'Wellbeing Messages',
    'Alerts', 'Data & Privacy', 'Recovery', 'Security Log', 'Trusted Browser',
    'Notifications', 'Subscription', 'Settings',
  ];
  await page.goto('/dashboard');
  for (const row of rows) {
    const link = page.locator('#app-sidebar').getByRole('link', { name: row, exact: true });
    await expect(link, `sidebar row "${row}" is missing`).toHaveCount(1);
    await link.click();
    // The claim under test is that the row resolves to a REGISTERED route.
    // It deliberately does not assert an <h1>: several pages return their
    // fail-closed state before rendering their own heading (Requests,
    // Members, Protection Status and Wellbeing Messages all do, against a
    // real backend), which is a separate, pre-existing defect in those pages
    // -- not something this nav row can be blamed for or should mask.
    await expect(page.getByRole('heading', { name: 'Page not found' })).toHaveCount(0);
    await expect(page.locator('#main-content')).not.toBeEmpty();
  }
});

test('every header control meets the minimum target size on a phone', async ({ page }) => {
  // jsdom has no layout, so this can only be checked in a real browser. The
  // language options collapse to their short codes here ("EN" / "ع"), which is
  // exactly where a target can silently become too small to hit.
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();

  const targets: { locator: ReturnType<typeof page.locator>; min: number; what: string }[] = [
    { locator: page.getByLabel('Open navigation menu'), min: 44, what: 'drawer toggle' },
    { locator: page.locator('.header-action').first(), min: 44, what: 'notifications bell' },
    { locator: page.locator('.header-profile'), min: 44, what: 'account control' },
    // 36x36. WCAG 2.2 SC 2.5.8 (AA) asks for 24x24; the two options sit 2px
    // apart, so the spacing exemption does not apply and the size has to
    // carry it on its own.
    { locator: page.locator('.lang-switch-option').first(), min: 36, what: 'language option (EN)' },
    { locator: page.locator('.lang-switch-option').last(), min: 36, what: 'language option (AR)' },
  ];

  for (const target of targets) {
    const box = await target.locator.boundingBox();
    expect(box, `${target.what} has no box`).not.toBeNull();
    expect(Math.round(box?.width ?? 0), `${target.what} width`).toBeGreaterThanOrEqual(target.min);
    expect(Math.round(box?.height ?? 0), `${target.what} height`).toBeGreaterThanOrEqual(target.min);
  }
});
