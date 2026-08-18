// PCA-FR-113: proves the real Notifications page renders translated labels in Arabic/RTL.
import { afterEach, describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import i18n, { applyDocumentDirection } from '../../src/i18n';
import { renderWithProviders } from '../utils/renderWithProviders';
import Notifications from '../../src/pages/Notifications';

describe('Arabic RTL: Notifications', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en');
    applyDocumentDirection('en');
  });

  it('renders the real Notifications page with Arabic direction and labels', async () => {
    await i18n.changeLanguage('ar');
    applyDocumentDirection('ar');

    renderWithProviders(<Notifications />);

    expect(document.documentElement.getAttribute('dir')).toBe('rtl');
    expect(document.documentElement.getAttribute('lang')).toBe('ar');
    expect(await screen.findByText('الإشعارات')).toBeInTheDocument();
  });
});
