import { afterEach, describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import i18n, { applyDocumentDirection } from '../../src/i18n';
import { renderWithProviders } from '../utils/renderWithProviders';
import { ProtectionAlertPanel } from '../../src/pages/security/ProtectionAlertPanel';

describe('ProtectionAlertPanel Arabic/RTL', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en');
    applyDocumentDirection('en');
  });

  it('renders the panel title, pending-decryption notice, and a trigger label in Arabic, not hardcoded English', async () => {
    await i18n.changeLanguage('ar');
    applyDocumentDirection('ar');

    renderWithProviders(<ProtectionAlertPanel alerts={[]} feedState="PENDING_TRUSTED_DECRYPTION" />);

    expect(await screen.findByText('تنبيهات الأمان والحماية')).toBeInTheDocument();
    expect(screen.getByText('التنبيهات بانتظار فك التشفير بواسطة جهاز والد موثوق.')).toBeInTheDocument();
    expect(screen.queryByText('Security and protection alerts')).not.toBeInTheDocument();
  });

  it('renders a real alert trigger label in Arabic, not the raw enum key', async () => {
    await i18n.changeLanguage('ar');
    applyDocumentDirection('ar');

    renderWithProviders(
      <ProtectionAlertPanel
        alerts={[{ alertId: 'a1', deviceId: 'device-1', trigger: 'PROTECTION_DEGRADED', generatedAtUtc: '2026-01-01T00:00:00.000Z' }]}
        feedState="READY"
      />,
    );

    expect(await screen.findByText('تدهورت الحماية')).toBeInTheDocument();
    expect(screen.queryByText('Protection degraded')).not.toBeInTheDocument();
    expect(screen.queryByText('PROTECTION_DEGRADED')).not.toBeInTheDocument();
  });
});
