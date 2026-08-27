import { afterEach, describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import i18n, { applyDocumentDirection } from '../../src/i18n';
import { renderWithProviders } from '../utils/renderWithProviders';
import ProtectionAdministrationPanel from '../../src/pages/family/ProtectionAdministrationPanel';

describe('ProtectionAdministrationPanel Arabic/RTL', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en');
    applyDocumentDirection('en');
  });

  it('renders the ~40 previously-orphaned strings translated in Arabic, not the English defaultValue fallback', async () => {
    await i18n.changeLanguage('ar');
    applyDocumentDirection('ar');
    expect(document.documentElement.getAttribute('dir')).toBe('rtl');

    renderWithProviders(<ProtectionAdministrationPanel targets={[]} />, { role: 'OWNER' });

    expect(await screen.findByText('إدارة الحماية')).toBeInTheDocument();
    expect(screen.getByText(/سلطة الحماية/)).toBeInTheDocument();
    expect(screen.getAllByText('رمز الإدارة').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'حفظ رمز الإدارة' })).toBeInTheDocument();
    expect(screen.getByText('طلب قرار من الوالد')).toBeInTheDocument();
    expect(screen.getByText('الطلبات المعلَّقة والمقرَّرة')).toBeInTheDocument();
    expect(screen.getByText('لا توجد طلبات موافقة متاحة.')).toBeInTheDocument();

    // No untranslated English fallback chrome should appear alongside the Arabic UI.
    expect(screen.queryByText('Protection administration')).not.toBeInTheDocument();
    expect(screen.queryByText('Administration PIN')).not.toBeInTheDocument();
    expect(screen.queryByText('No approval requests are available.')).not.toBeInTheDocument();
  });
});
