// PCA-FR-043B / bidi: the night-protection window is two clock times either
// side of a separator. In an RTL paragraph UAX#9 treats each time as a number
// run, resolves the neutral between them to R (rule N1: numbers act as R for
// neighbouring neutrals), and reverses the line -- so the Arabic value
// "{{start}} - {{end}}" put the END time where a parent reads FIRST. The
// Arabic copy now names both explicitly ("from ... to ..."), which no
// reordering can scramble.
import { afterEach, describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import i18n, { applyDocumentDirection } from '../../src/i18n';
import ScreenTimePage from '../../src/pages/children/ScreenTimePage';
import { DEFAULT_NIGHT_PROTECTION } from '../../src/domain/nightProtection';
import { renderWithProviders } from '../utils/renderWithProviders';

function TestApp() {
  return (
    <Routes>
      <Route path="/children/:childId/screen-time" element={<ScreenTimePage />} />
    </Routes>
  );
}

describe('Arabic night-protection window keeps the start time first', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en');
    applyDocumentDirection('en');
  });

  it('renders the window with explicit Arabic from/to wording, start before end', async () => {
    await i18n.changeLanguage('ar');
    applyDocumentDirection('ar');
    expect(document.documentElement.getAttribute('dir')).toBe('rtl');

    renderWithProviders(<TestApp />, { route: '/children/child-amir/screen-time', role: 'OWNER' });

    const windowLine = await screen.findByText(/21:30/);
    const text = windowLine.textContent ?? '';
    expect(text).toContain('من');
    expect(text).toContain('إلى');
    // The bedtime START must precede the END in the string, and the value must
    // no longer be a bare "start - end" pair of adjacent number runs.
    expect(text.indexOf(DEFAULT_NIGHT_PROTECTION.start)).toBeLessThan(
      text.indexOf(DEFAULT_NIGHT_PROTECTION.end),
    );
    expect(text).not.toMatch(/^\s*\d{2}:\d{2}\s*-\s*\d{2}:\d{2}\s*$/);
  });
});
