import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n, { applyDocumentDirection } from '../../src/i18n';
import { renderWithProviders } from '../utils/renderWithProviders';
import DeviceEnrollmentPanel from '../../src/pages/family/DeviceEnrollmentPanel';
import { __resetDevDeviceEnrollmentState } from '../../src/api/dev/devDeviceEnrollmentClient';

describe('DeviceEnrollmentPanel Arabic/RTL', () => {
  beforeEach(() => {
    __resetDevDeviceEnrollmentState();
  });

  afterEach(async () => {
    await i18n.changeLanguage('en');
    applyDocumentDirection('en');
  });

  it('renders every new UI string translated in Arabic, with RTL document direction', async () => {
    await i18n.changeLanguage('ar');
    applyDocumentDirection('ar');
    expect(document.documentElement.getAttribute('dir')).toBe('rtl');

    renderWithProviders(<DeviceEnrollmentPanel />, { role: 'OWNER' });

    expect(await screen.findByText('إضافة جهاز للطفل')).toBeInTheDocument();
    expect(screen.getByText('المنصة')).toBeInTheDocument();
    expect(screen.getByText('وضع الحماية')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'إنشاء دعوة' })).toBeInTheDocument();
    expect(screen.getByText('الدعوات')).toBeInTheDocument();
    expect(screen.getByText('تأكيد إقران الجهاز')).toBeInTheDocument();
    expect(screen.getByLabelText('معرّف الجهاز')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'البحث عن طلب الإقران' })).toBeInTheDocument();

    // No untranslated English chrome strings should appear alongside the Arabic UI.
    expect(screen.queryByText('Create invitation')).not.toBeInTheDocument();
    expect(screen.queryByText('Confirm device pairing')).not.toBeInTheDocument();
  });

  it('renders monitored-family disclosure wording as children copy in Arabic', async () => {
    await i18n.changeLanguage('ar');
    applyDocumentDirection('ar');
    renderWithProviders(<DeviceEnrollmentPanel />, { role: 'OWNER' });

    const createInvitationButton = await screen.findByRole('button', { name: 'إنشاء دعوة' });
    await waitFor(() => expect(createInvitationButton).toBeEnabled());
    await userEvent.click(createInvitationButton);

    expect(await screen.findByText(/فئات استخدام أطفالك للتطبيقات والمواقع/)).toBeInTheDocument();
    expect(screen.getByText(/ميزة منفصلة لأجهزة أطفالك/)).toBeInTheDocument();
    expect(screen.queryByText(/قد ترى العائلة فئات/)).not.toBeInTheDocument();
  });
});
