// Regression coverage for the one horizontal overflow left in the Round-2
// mobile (375x812) real-browser sweep: /privacy/permissions.
//
// Root cause: `.permission-entry` was referenced by the markup but had NO
// rules at all in global.css, and each entry printed its Android manifest
// identifier as a bare <code>. The longest of those,
// `android.permission.FOREGROUND_SERVICE_SPECIAL_USE`, is a single 49-character
// token with no break opportunity, so it set the element's minimum width and
// pushed the document wider than the viewport.
//
// jsdom performs no CSS layout, so -- following this codebase's existing
// responsive-test convention (see deviceEnrollmentLayout.test.tsx) -- the
// assertions here are structural, PLUS a direct contract check on the
// stylesheet itself so the rules the fix depends on cannot silently regress.
// The real 375x812 no-overflow proof is a browser check, recorded separately.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import i18n, { applyDocumentDirection } from '../../src/i18n';
import { renderWithProviders } from '../utils/renderWithProviders';
import PermissionsPolicy from '../../src/pages/privacy/PermissionsPolicy';

const HERE = dirname(fileURLToPath(import.meta.url));
const GLOBAL_CSS = readFileSync(resolve(HERE, '../../src/styles/global.css'), 'utf8');

/** The rules block for a single selector, or null when the selector is absent. */
function ruleBlock(selector: string): string | null {
  const at = GLOBAL_CSS.indexOf(`${selector} {`);
  if (at < 0) return null;
  return GLOBAL_CSS.slice(at, GLOBAL_CSS.indexOf('}', at));
}

const LONGEST_IDENTIFIER = 'android.permission.FOREGROUND_SERVICE_SPECIAL_USE';

describe('PermissionsPolicy narrow-width layout safety', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en');
    applyDocumentDirection('en');
  });

  it('the longest manifest identifier renders inside the wrap-safe class, not as a bare <code>', () => {
    renderWithProviders(<PermissionsPolicy />);
    const longest = screen.getByText(LONGEST_IDENTIFIER);
    expect(longest.tagName).toBe('CODE');
    expect(longest.classList.contains('permission-entry-id')).toBe(true);
    expect(longest.closest('.permission-entry')).not.toBeNull();
  });

  it('every manifest identifier on the page uses the wrap-safe class', () => {
    renderWithProviders(<PermissionsPolicy />);
    const codes = Array.from(document.querySelectorAll('code'));
    expect(codes.length).toBe(10);
    for (const code of codes) {
      expect(code.textContent, code.textContent ?? '').toContain('android.permission.');
      expect(code.classList.contains('permission-entry-id'), code.textContent ?? '').toBe(true);
    }
  });

  it('global.css declares the break rules the long token depends on', () => {
    const id = ruleBlock('.permission-entry-id');
    expect(id, '.permission-entry-id must be styled').not.toBeNull();
    // Both are required: `anywhere` lets the line box shrink below the token's
    // width, `break-all` permits the break inside the token itself.
    expect(id).toMatch(/overflow-wrap:\s*anywhere/);
    expect(id).toMatch(/word-break:\s*break-all/);
    expect(id).toMatch(/max-width:\s*100%/);
  });

  it('global.css floors the entry and term at min-width 0 so wrapping can take effect', () => {
    // A flex/grid item's default `min-width: auto` pins it to its longest
    // unbreakable token, which defeats the break rules above.
    expect(ruleBlock('.permission-entry'), '.permission-entry must be styled').not.toBeNull();
    expect(ruleBlock('.permission-entry')).toMatch(/min-width:\s*0/);
    expect(ruleBlock('.permission-entry-term')).toMatch(/min-width:\s*0/);
  });

  it('the identifier is stacked under the name, not laid out inline beside it', () => {
    const term = ruleBlock('.permission-entry-term');
    expect(term).toMatch(/display:\s*flex/);
    expect(term).toMatch(/flex-direction:\s*column/);
  });
});
