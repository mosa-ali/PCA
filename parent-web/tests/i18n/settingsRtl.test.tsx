// PCA-FR-111/PCA-NFR-043: proves the real, wired RTL mechanism actually
// works for two more surfaces beyond the existing rtl.test.tsx (Dashboard)
// and freeAccessRtl.test.tsx (the free-access banner) coverage --
// Settings.tsx's own live language switcher (the actual control a parent
// uses to flip languages, applyDocumentDirection wired directly to its
// onChange) and a policy/permissions page (RolesMatrix) rendered under
// Arabic/RTL. Both assertions would fail if the RTL wiring broke: the
// Settings test flips language via the real UI control (not a direct
// i18n.changeLanguage() call) and checks document.dir actually flips as a
// side effect, and the RolesMatrix test asserts real Arabic strings that
// only exist in ar.json (a stale/missing translation key would surface as
// English text or a raw key, failing the assertion).
import { afterEach, describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n, { applyDocumentDirection } from '../../src/i18n';
import { renderWithProviders } from '../utils/renderWithProviders';
import Settings from '../../src/pages/Settings';
import RolesMatrix from '../../src/pages/family/RolesMatrix';

describe('Arabic RTL: Settings language switcher + RolesMatrix policy page', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en');
    applyDocumentDirection('en');
  });

  it('selecting Arabic in the real Settings language control flips document dir to rtl and re-renders the page in Arabic', async () => {
    await i18n.changeLanguage('en');
    applyDocumentDirection('en');
    expect(document.documentElement.getAttribute('dir')).toBe('ltr');

    renderWithProviders(<Settings />);
    expect(await screen.findByText('Settings')).toBeInTheDocument();

    const select = screen.getByLabelText('Language');
    await userEvent.selectOptions(select, 'ar');

    expect(document.documentElement.getAttribute('dir')).toBe('rtl');
    expect(document.documentElement.getAttribute('lang')).toBe('ar');
    expect(await screen.findByText('الإعدادات')).toBeInTheDocument();
  });

  it('RolesMatrix (a policy/permissions page) renders real Arabic labels under document dir=rtl', async () => {
    await i18n.changeLanguage('ar');
    applyDocumentDirection('ar');
    expect(document.documentElement.getAttribute('dir')).toBe('rtl');

    renderWithProviders(<RolesMatrix />);
    expect(await screen.findByText('مصفوفة الأدوار والصلاحيات')).toBeInTheDocument();
  });
});
