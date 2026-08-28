// PCA-FR-111: a parent who selected Arabic got English back on the next page
// load. i18next was configured with `caches: []` and a detection order of
// ['querystring', 'navigator'], and Settings.tsx applied the saved
// parentPreferences.language only inside its own mount effect -- so nothing
// carried the choice across a reload. The choice is now cached for this
// browser and sits between querystring and navigator in the SAME order.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n, {
  LANGUAGE_STORAGE_KEY,
  applyDocumentDirection,
  hasStoredLanguagePreference,
} from '../../src/i18n';
import Settings from '../../src/pages/Settings';
import { renderWithProviders } from '../utils/renderWithProviders';
import { getApiClients } from '../../src/api/client';

describe('language preference survives a reload', () => {
  beforeEach(() => {
    localStorage.removeItem(LANGUAGE_STORAGE_KEY);
  });

  afterEach(async () => {
    await i18n.changeLanguage('en');
    applyDocumentDirection('en');
    localStorage.removeItem(LANGUAGE_STORAGE_KEY);
  });

  it('keeps the documented detection precedence, with the stored choice between querystring and navigator', () => {
    const order = (i18n.options.detection?.order ?? []) as string[];
    expect(order[0]).toBe('querystring');
    expect(order[order.length - 1]).toBe('navigator');
    expect(order).toContain('localStorage');
    expect(i18n.options.detection?.caches).toEqual(['localStorage']);
  });

  it('persists the chosen language, which is what a fresh page load reads before React renders', async () => {
    expect(hasStoredLanguagePreference()).toBe(false);

    await i18n.changeLanguage('ar');

    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('ar');
    expect(hasStoredLanguagePreference()).toBe(true);
  });

  it('choosing Arabic in the real Settings control stores it for the next load', async () => {
    await i18n.changeLanguage('en');
    localStorage.removeItem(LANGUAGE_STORAGE_KEY);
    renderWithProviders(<Settings />);
    await screen.findByText('Settings');

    await userEvent.selectOptions(screen.getByLabelText('Language'), 'ar');

    expect(i18n.language).toBe('ar');
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('ar');
    expect(document.documentElement.getAttribute('dir')).toBe('rtl');
  });

  it('does not let the account-level default overwrite the choice this browser already has', async () => {
    // The account-level preference says English while this browser's own
    // explicit choice is Arabic. Before this guard existed, simply opening
    // Settings snapped the UI back to English on every visit.
    await getApiClients().parentPreferences.update({ language: 'en' });
    await expect(getApiClients().parentPreferences.get()).resolves.toMatchObject({ language: 'en' });

    await i18n.changeLanguage('ar');
    applyDocumentDirection('ar');
    localStorage.setItem(LANGUAGE_STORAGE_KEY, 'ar');

    renderWithProviders(<Settings />);
    await screen.findByText('الإعدادات');

    expect(i18n.language).toBe('ar');
    expect(document.documentElement.getAttribute('dir')).toBe('rtl');
  });
});
