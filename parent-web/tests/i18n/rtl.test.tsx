import { describe, expect, it, afterEach } from 'vitest';
import { screen } from '@testing-library/react';
import i18n, { applyDocumentDirection } from '../../src/i18n';
import { renderWithProviders } from '../utils/renderWithProviders';
import Dashboard from '../../src/pages/Dashboard';

describe('Arabic RTL', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en');
    applyDocumentDirection('en');
  });

  it('flips document direction and renders Arabic labels for the Arabic locale', async () => {
    await i18n.changeLanguage('ar');
    applyDocumentDirection('ar');
    expect(document.documentElement.getAttribute('dir')).toBe('rtl');
    expect(document.documentElement.getAttribute('lang')).toBe('ar');

    renderWithProviders(<Dashboard />);
    expect(await screen.findByText('لوحة التحكم')).toBeInTheDocument();
  });

  it('keeps English as LTR', async () => {
    await i18n.changeLanguage('en');
    applyDocumentDirection('en');
    expect(document.documentElement.getAttribute('dir')).toBe('ltr');
    renderWithProviders(<Dashboard />);
    expect(await screen.findByText('Dashboard')).toBeInTheDocument();
  });
});
