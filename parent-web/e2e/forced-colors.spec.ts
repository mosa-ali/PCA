import { test, expect } from '@playwright/test';

// PCA-16 / PCA-NFR-041 (2026-09-08): forced colours (Windows High Contrast), increased contrast
// and reduced motion, proven in a real layout engine under emulated media rather than asserted
// from stylesheet text. Under `forced-colors: active` the browser strips author backgrounds, so
// any state carried by background alone disappears; the stylesheet answers with system-colour
// borders and outlines, and these specs measure the computed result.

test.describe('forced colours, increased contrast and reduced motion (real browser)', () => {
  test('status pills, the status dot and KPI tiles keep a visible border under forced colours', async ({ page }) => {
    await page.emulateMedia({ forcedColors: 'active' });
    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible();

    const badge = page.locator('.status-badge').first();
    await expect(badge).toBeVisible();
    const badgeBorder = await badge.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { width: parseFloat(cs.borderTopWidth), style: cs.borderTopStyle };
    });
    expect(badgeBorder.width, 'status pill border width').toBeGreaterThanOrEqual(1);
    expect(badgeBorder.style).toBe('solid');

    const dot = page.locator('.status-badge .dot').first();
    if ((await dot.count()) > 0) {
      const outline = await dot.evaluate((el) => parseFloat(getComputedStyle(el).outlineWidth));
      expect(outline, 'status dot outline').toBeGreaterThanOrEqual(1);
    }

    const tile = page.locator('.kpi-tile').first();
    await expect(tile).toBeVisible();
    expect(await tile.evaluate((el) => parseFloat(getComputedStyle(el).borderTopWidth)), 'KPI tile border').toBeGreaterThanOrEqual(1);
  });

  test('keyboard focus is a thick system-colour ring under forced colours', async ({ page }) => {
    await page.emulateMedia({ forcedColors: 'active' });
    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible();
    const link = page.getByRole('link', { name: 'Skip to main content' });
    await link.focus();
    const outline = await link.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { width: parseFloat(cs.outlineWidth), style: cs.outlineStyle };
    });
    expect(outline.width).toBeGreaterThanOrEqual(3);
    expect(outline.style).toBe('solid');
  });

  test('reduced motion collapses every transition and animation', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible();
    const durations = await page.evaluate(() => {
      const probe = [document.body, ...Array.from(document.querySelectorAll('.kpi-tile, .status-badge, a')).slice(0, 10)];
      return probe.map((el) => {
        const cs = getComputedStyle(el);
        return { t: cs.transitionDuration, a: cs.animationDuration };
      });
    });
    for (const d of durations) {
      for (const v of [...d.t.split(','), ...d.a.split(',')]) expect(parseFloat(v)).toBeLessThanOrEqual(0.001);
    }
  });

  test('prefers-contrast: more collapses secondary text onto the primary text colour', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible();
    // The KPI row renders after its data resolves; the heading alone is not enough.
    await expect(page.locator('.kpi-label').first()).toBeVisible();
    await expect(page.locator('.kpi-value').first()).toBeVisible();
    const read = () =>
      page.evaluate(() => {
        const label = document.querySelector('.kpi-label');
        const value = document.querySelector('.kpi-value');
        if (!label || !value) throw new Error('KPI label/value not rendered');
        return { label: getComputedStyle(label).color, value: getComputedStyle(value).color };
      });
    const normal = await read();
    expect(normal.label).not.toBe(normal.value);

    await page.emulateMedia({ contrast: 'more' });
    const more = await read();
    expect(more.label).toBe(more.value);
  });
});
