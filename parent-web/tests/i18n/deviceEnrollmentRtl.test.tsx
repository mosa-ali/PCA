import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n, { applyDocumentDirection } from '../../src/i18n';
import { renderWithProviders } from '../utils/renderWithProviders';
import Devices from '../../src/pages/family/Devices';
import { __resetDevDeviceEnrollmentState } from '../../src/api/dev/devDeviceEnrollmentClient';
import { __resetDevChildProfileState, __seedDevChildProfile } from '../../src/api/dev/devChildProfileClient';
import { __resetChildLabelsForTest, setChildLabel } from '../../src/domain/childLabels';

describe('Devices page Arabic/RTL', () => {
  beforeEach(async () => {
    __resetDevDeviceEnrollmentState();
    __resetDevChildProfileState();
    __resetChildLabelsForTest();
    __seedDevChildProfile('dev-family-1', 'child-existing-1');
    setChildLabel('child-existing-1', 'الطفل الحالي (تجريبي)');
    await i18n.changeLanguage('ar');
    applyDocumentDirection('ar');
  });

  afterEach(async () => {
    await i18n.changeLanguage('en');
    applyDocumentDirection('en');
  });

  it('renders the six section tabs translated, with RTL document direction', async () => {
    expect(document.documentElement.getAttribute('dir')).toBe('rtl');
    renderWithProviders(<Devices />, { role: 'OWNER', route: '/family/devices' });

    const tabs = await screen.findAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      'نظرة عامة',
      'إضافة جهاز',
      'إعداد قيد الانتظار',
      'الأجهزة',
      'الحماية والإزالة',
      'متقدّم والأمان',
    ]);
    expect(screen.getByRole('tablist')).toHaveAccessibleName('أقسام الأجهزة');

    // No untranslated English chrome alongside the Arabic UI.
    expect(screen.queryByText('Add device')).not.toBeInTheDocument();
    expect(screen.queryByText('Advanced & security')).not.toBeInTheDocument();
  });

  it('renders every step of the Add-device journey in Arabic', async () => {
    renderWithProviders(<Devices />, { role: 'OWNER', route: '/family/devices?section=add' });

    expect(await screen.findByRole('heading', { level: 3, name: 'لمن هذا الجهاز؟' })).toBeInTheDocument();
    expect(screen.getByText('ملف الطفل')).toBeInTheDocument();
    expect(screen.getByText('فئة واجهة العمر')).toBeInTheDocument();
    expect(screen.getByLabelText('شخص جديد')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'ما نوع الجهاز؟' }));
    expect(await screen.findByRole('heading', { level: 3, name: 'ما نوع الجهاز؟' })).toBeInTheDocument();
    // The Android-only statement is translated, and no iOS control exists.
    expect(
      screen.getByText('يدعم PCA حاليًا هواتف وأجهزة أندرويد اللوحية. لا يدعم iPhone وiPad بعد.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: /iOS/ })).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'ما مستوى الحماية؟' }));
    expect(await screen.findByRole('heading', { level: 3, name: 'ما مستوى الحماية؟' })).toBeInTheDocument();
    expect(screen.getByText('وضع الحماية')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'راجع وأكِّد' }));
    expect(await screen.findByRole('heading', { level: 3, name: 'راجع وأكِّد' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'فهمت، إنشاء الدعوة' })).toBeInTheDocument();
    expect(screen.queryByText('Create invitation')).not.toBeInTheDocument();
  });

  it('renders monitored-family disclosure wording as children copy in Arabic', async () => {
    renderWithProviders(<Devices />, { role: 'OWNER', route: '/family/devices?section=add' });

    await userEvent.click(await screen.findByRole('button', { name: 'ما نوع الجهاز؟' }));
    await userEvent.click(await screen.findByRole('button', { name: 'ما مستوى الحماية؟' }));
    await userEvent.click(await screen.findByRole('button', { name: 'راجع وأكِّد' }));

    expect(await screen.findByText(/فئات استخدام أطفالك للتطبيقات والمواقع/)).toBeInTheDocument();
    expect(screen.getByText(/ميزة منفصلة لأجهزة أطفالك/)).toBeInTheDocument();
    expect(screen.queryByText(/قد ترى العائلة فئات/)).not.toBeInTheDocument();
  });

  it('renders the pending-setup and pairing surfaces in Arabic', async () => {
    renderWithProviders(<Devices />, { role: 'OWNER', route: '/family/devices?section=pending' });
    expect(await screen.findByRole('heading', { name: 'الدعوات' })).toBeInTheDocument();
    expect(screen.queryByText('Confirm device pairing')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: 'متقدّم والأمان' }));
    expect(await screen.findByRole('heading', { name: 'تأكيد إقران الجهاز' })).toBeInTheDocument();
    expect(screen.getByLabelText('معرّف الجهاز')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'البحث عن طلب الإقران' })).toBeInTheDocument();
  });

  it('keeps opaque Latin identifiers in LTR order inside the RTL page', async () => {
    renderWithProviders(<Devices />, { role: 'OWNER', route: '/family/devices?section=advanced' });
    const deviceIdInput = await screen.findByLabelText('معرّف الجهاز');
    // A Latin identifier reorders visually if it inherits the RTL paragraph
    // direction, so the INPUT carries dir="ltr" while its label stays RTL.
    expect(deviceIdInput).toHaveAttribute('dir', 'ltr');
  });
});
