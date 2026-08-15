import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import i18n, { applyDocumentDirection } from '../../src/i18n';
import { FreeAccessReminderBannerView } from '../../src/components/freeaccess/FreeAccessReminderBannerView';
import type { FreeAccessStatus } from '../../src/domain/freeAccess';

const ACTIVE_7: FreeAccessStatus = {
  mode: 'TIME_LIMITED',
  grantedAt: '2026-07-16T00:00:00.000Z',
  expiresAt: '2026-08-15T00:00:00.000Z',
  remainingDays: 7,
  status: 'ACTIVE',
};

function renderInArabic(status: FreeAccessStatus) {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>
        <FreeAccessReminderBannerView status={status} onDismiss={vi.fn()} />
      </MemoryRouter>
    </I18nextProvider>,
  );
}

describe('FREE_ACCESS reminder: Arabic RTL', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en');
    applyDocumentDirection('en');
  });

  it('renders the Arabic remaining-days headline under document dir=rtl', async () => {
    await i18n.changeLanguage('ar');
    applyDocumentDirection('ar');
    expect(document.documentElement.getAttribute('dir')).toBe('rtl');

    renderInArabic(ACTIVE_7);
    expect(await screen.findByText('يتبقى 7 أيام في فترة الوصول المجاني')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'عرض خيارات الفوترة' })).toHaveAttribute('href', '/subscription');
  });

  it('renders the Arabic EXPIRED headline without implying protection was disabled', async () => {
    await i18n.changeLanguage('ar');
    applyDocumentDirection('ar');
    renderInArabic({ ...ACTIVE_7, remainingDays: null, status: 'EXPIRED' });
    expect(await screen.findByText('انتهت فترة الوصول المجاني')).toBeInTheDocument();
  });
});
