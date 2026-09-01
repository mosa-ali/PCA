// Guards the "no raw user-facing enum" property for /privacy/permissions.
//
// This page deliberately prints the exact `android.permission.*` strings from
// android/app/src/main/AndroidManifest.xml -- that 1:1 citation is the whole
// point of the page (PCA-NFR-061), so the identifiers must NOT be renamed,
// prettified or dropped. What must hold instead is that no identifier is ever
// the label a parent reads: each one is paired with a real, translated,
// human-readable name in BOTH locales, is announced with an explicit
// screen-reader label rather than sitting there as an unexplained token, and
// is direction-isolated so a Latin identifier is not visually reordered on the
// Arabic page.
import { afterEach, describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import i18n, { applyDocumentDirection } from '../../src/i18n';
import { renderWithProviders } from '../utils/renderWithProviders';
import PermissionsPolicy from '../../src/pages/privacy/PermissionsPolicy';
import en from '../../src/i18n/locales/en.json';
import ar from '../../src/i18n/locales/ar.json';

// Must stay identical to PermissionsPolicy.tsx's MANIFEST_PERMISSION_NAMES,
// which in turn mirrors AndroidManifest.xml. Duplicated deliberately: if the
// page's list drifts from the manifest, this literal is the tripwire.
const MANIFEST_IDENTIFIERS = [
  'android.permission.ACCESS_FINE_LOCATION',
  'android.permission.ACCESS_COARSE_LOCATION',
  'android.permission.ACCESS_BACKGROUND_LOCATION',
  'android.permission.POST_NOTIFICATIONS',
  'android.permission.ACCESS_NETWORK_STATE',
  'android.permission.READ_PHONE_STATE',
  'android.permission.SCHEDULE_EXACT_ALARM',
  'android.permission.FOREGROUND_SERVICE',
  'android.permission.FOREGROUND_SERVICE_SPECIAL_USE',
  'android.permission.CAMERA',
] as const;

const PERMISSION_KEYS = Object.keys(en.permissionsPolicy.permissions);
const ARABIC = /[؀-ۿ]/;

describe('PermissionsPolicy: manifest identifiers are cited, never used as labels', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en');
    applyDocumentDirection('en');
  });

  it('renders every manifest identifier verbatim -- the citation is not altered', () => {
    renderWithProviders(<PermissionsPolicy />);
    for (const identifier of MANIFEST_IDENTIFIERS) {
      expect(screen.getByText(identifier), identifier).toBeInTheDocument();
    }
  });

  it('each identifier is paired with a human-readable name and carries a screen-reader label', () => {
    renderWithProviders(<PermissionsPolicy />);
    for (const identifier of MANIFEST_IDENTIFIERS) {
      const code = screen.getByText(identifier);
      const term = code.closest('.permission-entry-term');
      expect(term, identifier).not.toBeNull();

      // A real human name sits beside the identifier, and is not itself an enum.
      const name = term!.querySelector('.permission-entry-name')?.textContent?.trim() ?? '';
      expect(name.length, identifier).toBeGreaterThan(0);
      expect(name, identifier).not.toContain('android.permission.');
      expect(name, identifier).not.toMatch(/^[A-Z0-9_]+$/);

      // The raw token is announced as what it is, not left unexplained.
      const srLabel = code.querySelector('.sr-only')?.textContent ?? '';
      expect(srLabel.trim().length, identifier).toBeGreaterThan(0);
      expect(code.getAttribute('dir'), identifier).toBe('ltr');
    }
  });

  it('every permission has a genuinely translated Arabic name and purpose', () => {
    for (const key of PERMISSION_KEYS) {
      const enEntry = (en.permissionsPolicy.permissions as Record<string, Record<string, string>>)[key];
      const arEntry = (ar.permissionsPolicy.permissions as Record<string, Record<string, string>>)[key];
      expect(arEntry, key).toBeDefined();
      for (const field of ['name', 'purpose']) {
        expect(arEntry[field], `${key}.${field}`).toBeTruthy();
        expect(ARABIC.test(arEntry[field]), `${key}.${field} must be Arabic`).toBe(true);
        // An untranslated copy-paste of the English string is a silent gap.
        expect(arEntry[field], `${key}.${field}`).not.toBe(enEntry[field]);
      }
    }
  });

  it('the screen-reader label for the identifier exists and is translated in both locales', () => {
    expect(en.permissionsPolicy.manifestIdentifierLabel).toBeTruthy();
    expect(ar.permissionsPolicy.manifestIdentifierLabel).toBeTruthy();
    expect(ARABIC.test(ar.permissionsPolicy.manifestIdentifierLabel)).toBe(true);
    expect(ar.permissionsPolicy.manifestIdentifierLabel).not.toBe(
      en.permissionsPolicy.manifestIdentifierLabel,
    );
  });

  it('under Arabic the names render in Arabic while the identifiers stay verbatim and LTR-isolated', async () => {
    await i18n.changeLanguage('ar');
    applyDocumentDirection('ar');
    renderWithProviders(<PermissionsPolicy />);

    expect(document.documentElement.getAttribute('dir')).toBe('rtl');
    expect(await screen.findByText(ar.permissionsPolicy.title)).toBeInTheDocument();

    for (const identifier of MANIFEST_IDENTIFIERS) {
      const code = screen.getByText(identifier);
      expect(code.getAttribute('dir'), identifier).toBe('ltr');
      const name = code.closest('.permission-entry-term')
        ?.querySelector('.permission-entry-name')?.textContent ?? '';
      expect(ARABIC.test(name), `${identifier} must have an Arabic name`).toBe(true);
    }
  });
});
