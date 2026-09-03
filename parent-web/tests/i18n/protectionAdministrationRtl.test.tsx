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

  it('renders the parent-decision half translated in Arabic, not the English defaultValue fallback', async () => {
    await i18n.changeLanguage('ar');
    applyDocumentDirection('ar');
    expect(document.documentElement.getAttribute('dir')).toBe('rtl');

    renderWithProviders(<ProtectionAdministrationPanel section="protection" targets={[]} />, { role: 'OWNER' });

    expect(await screen.findByText('إدارة الحماية')).toBeInTheDocument();
    expect(screen.getByText(/سلطة الحماية/)).toBeInTheDocument();
    expect(screen.getByText('طلب قرار من الوالد')).toBeInTheDocument();
    expect(screen.getByText('الطلبات المعلَّقة والمقرَّرة')).toBeInTheDocument();
    expect(screen.getByText('لا توجد طلبات موافقة متاحة.')).toBeInTheDocument();

    // No untranslated English fallback chrome should appear alongside the Arabic UI.
    expect(screen.queryByText('Protection administration')).not.toBeInTheDocument();
    expect(screen.queryByText('No approval requests are available.')).not.toBeInTheDocument();

    // The Administration PIN is NOT on this half at all.
    expect(screen.queryByLabelText('رمز الإدارة')).toBeNull();
  });

  it('renders the Administration PIN half translated in Arabic, with its explanation demoted to a disclosure', async () => {
    await i18n.changeLanguage('ar');
    applyDocumentDirection('ar');

    renderWithProviders(<ProtectionAdministrationPanel section="advanced" targets={[]} />, { role: 'OWNER' });

    expect(await screen.findByRole('heading', { name: 'رمز الإدارة' })).toBeInTheDocument();
    expect(screen.getAllByLabelText('رمز الإدارة').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'حفظ رمز الإدارة' })).toBeInTheDocument();

    // The parent-readable summary is the VISIBLE line; the precise security
    // wording is one click away, and its previously hardcoded English fallback
    // is now translated.
    expect(
      screen.getByText('رمز احتياطي محلي، يُستخدم فقط عندما يتعذّر وصول قرار الوالد إلى الجهاز.'),
    ).toBeInTheDocument();
    const disclosure = screen.getByText('كيف يُحمى رقم التعريف الشخصي هذا').closest('details');
    expect(disclosure).not.toBeNull();
    expect(disclosure).not.toHaveAttribute('open');
    expect(
      screen.queryByText(/Use this local PIN only as an offline fallback/),
    ).not.toBeInTheDocument();

    expect(screen.queryByText('Administration PIN')).not.toBeInTheDocument();
    expect(screen.queryByText('Request a parent decision')).not.toBeInTheDocument();
  });
});
