// NO HORIZONTAL OVERFLOW AT 375x812, IN EITHER DIRECTION.
//
// This repo has a hard-won discipline here: the last overflow found in a real
// 375x812 sweep was a 49-character Android permission identifier on
// /privacy/permissions, and it was caused by an element being an unstyled flex
// item with `min-width: auto` (see tests/responsive/permissionsPolicyLayout.test.tsx).
//
// jsdom performs no CSS layout, so -- following this codebase's existing
// convention -- the assertions here are structural PLUS direct contract checks
// on the stylesheet the fix depends on. The real 375x812 no-overflow proof is
// a browser check, recorded separately.
//
// The second half of this file is the direction contract: nothing in the
// dashboard may be laid out with a physical side, and nothing may be mirrored
// with `scaleX(-1)` (which would flip numerals as well as geometry).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { waitFor } from '@testing-library/react';
import { axe } from 'vitest-axe';
import i18n, { applyDocumentDirection } from '../../src/i18n';
import Dashboard from '../../src/pages/Dashboard';
import { renderWithProviders } from '../utils/renderWithProviders';

const HERE = dirname(fileURLToPath(import.meta.url));
const GLOBAL_CSS = readFileSync(resolve(HERE, '../../src/styles/global.css'), 'utf8');

/** The rules block for a single selector, or null when the selector is absent. */
function ruleBlock(selector: string): string | null {
  const at = GLOBAL_CSS.indexOf(`${selector} {`);
  if (at < 0) return null;
  return GLOBAL_CSS.slice(at, GLOBAL_CSS.indexOf('}', at));
}

/** Physical sides are a review failure: every dashboard offset must be logical. */
const PHYSICAL_STYLE_PROPERTIES = ['left', 'right', 'margin-left', 'margin-right', 'padding-left', 'padding-right', 'border-left', 'border-right', 'text-align: left', 'text-align: right'];

/** Waits on structure, not copy: this file runs under both locales. */
async function renderSettled() {
  const view = renderWithProviders(<Dashboard />);
  await waitFor(() => {
    expect(view.container.querySelectorAll('.child-card')).toHaveLength(3);
  });
  return view;
}

describe('Dashboard narrow-width layout safety', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en');
    applyDocumentDirection('en');
  });

  it('wraps the KPI row instead of scrolling it horizontally', () => {
    const row = ruleBlock('.kpi-row');
    expect(row, '.kpi-row must be styled').not.toBeNull();
    expect(row).toMatch(/display:\s*grid/);
    // Two columns at the narrowest width, three at 640px, six at 1200px --
    // rows, never a scroller.
    expect(row).toMatch(/grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
    expect(row).not.toMatch(/overflow-x/);
  });

  it('floors every grid item at min-width 0 so long content can wrap', () => {
    // A grid item's default `min-width: auto` pins it to its longest
    // unbreakable token, which is what pushes a page wider than the viewport.
    for (const selector of ['.kpi-row > *', '.dashboard-grid > *', '.children-grid > *']) {
      expect(ruleBlock(selector), `${selector} must be styled`).not.toBeNull();
      expect(ruleBlock(selector), selector).toMatch(/min-width:\s*0/);
    }
  });

  it('stacks the dashboard grid and the children grid to one column at the narrowest width', () => {
    expect(ruleBlock('.dashboard-grid')).toMatch(/grid-template-columns:\s*minmax\(0, 1fr\)/);
    expect(ruleBlock('.children-grid')).toMatch(/grid-template-columns:\s*minmax\(0, 1fr\)/);
  });

  it('uses only logical offsets in its own inline styles', async () => {
    const { container } = await renderSettled();

    for (const element of Array.from(container.querySelectorAll<HTMLElement>('[style]'))) {
      const style = element.getAttribute('style') ?? '';
      for (const physical of PHYSICAL_STYLE_PROPERTIES) {
        expect(style, `${element.className}: ${style}`).not.toContain(`${physical}:`);
      }
    }
  });

  it('never mirrors anything with a scale transform', async () => {
    await i18n.changeLanguage('ar');
    applyDocumentDirection('ar');
    const { container } = await renderSettled();

    expect(document.documentElement.getAttribute('dir')).toBe('rtl');
    expect(container.innerHTML).not.toContain('scaleX');
    expect(container.innerHTML).not.toContain('scale(-1');
  });

  it('renders the whole page under rtl -- same six KPIs, same three child cards', async () => {
    await i18n.changeLanguage('ar');
    applyDocumentDirection('ar');
    const { container } = await renderSettled();

    expect(container.querySelectorAll('.kpi-tile')).toHaveLength(6);
    expect(container.querySelectorAll('.child-card')).toHaveLength(3);
    // The KPI accent bar is `border-inline-start`, which mirrors on its own.
    expect(ruleBlock('.kpi-tile')).toMatch(/border-inline-start:\s*3px solid var\(--kpi-accent/);
    // The declaration, not the word: the rule block carries a comment naming
    // `border-left` as the thing not to use.
    expect(ruleBlock('.kpi-tile')).not.toMatch(/^\s*border-left\s*:/m);
  });

  it('has no axe violations under ltr', async () => {
    const { container } = await renderSettled();
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('has no axe violations under rtl', async () => {
    await i18n.changeLanguage('ar');
    applyDocumentDirection('ar');
    const { container } = await renderSettled();
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
