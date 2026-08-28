import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import en from './locales/en.json';
import ar from './locales/ar.json';

export const RTL_LANGUAGES = new Set(['ar']);

export function isRtl(language: string): boolean {
  return RTL_LANGUAGES.has(language.split('-')[0]);
}

/**
 * Where the parent's explicit language choice is remembered for THIS browser.
 *
 * Before this existed, `caches: []` meant nothing persisted a chosen language:
 * Settings.tsx applied the saved `parentPreferences.language` only inside its
 * own mount effect, so a parent who picked Arabic anywhere in the app was back
 * in English on the next page load (detection fell straight through to
 * `navigator`). Caching it here makes the choice take effect app-wide at
 * startup -- before React renders and before main.tsx's
 * applyDocumentDirection(i18n.language) call -- so `dir="rtl"` is correct on
 * the very first paint too.
 *
 * This is a UI display preference, never secret material: the
 * `no-restricted-properties` lint rule this file deliberately stays clear of
 * (see .eslintrc.cjs) exists to keep *secrets* out of Web Storage, and family
 * key material still belongs only in src/security/secureStorage.ts.
 */
export const LANGUAGE_STORAGE_KEY = 'pca.parent-web.language';

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      ar: { translation: ar },
    },
    fallbackLng: 'en',
    supportedLngs: ['en', 'ar'],
    interpolation: { escapeValue: false },
    detection: {
      // The existing precedence is preserved: an explicit `?lng=` querystring
      // still wins over everything, and `navigator` remains the last resort
      // for a browser that has never been given a choice. The stored choice
      // only fills the gap between them.
      order: ['querystring', 'localStorage', 'navigator'],
      lookupQuerystring: 'lng',
      lookupLocalStorage: LANGUAGE_STORAGE_KEY,
      caches: ['localStorage'],
    },
  });

/**
 * Whether this browser has a language the parent explicitly chose (via the
 * header switcher or Settings). Settings.tsx uses this so the account-level
 * saved preference is applied on a browser that has no choice of its own,
 * without overriding a choice the parent just made here.
 */
export function hasStoredLanguagePreference(): boolean {
  try {
    return localStorage.getItem(LANGUAGE_STORAGE_KEY) !== null;
  } catch {
    // Storage can be unavailable (private mode / blocked cookies). Treat that
    // as "no stored choice" rather than failing the caller.
    return false;
  }
}

export function applyDocumentDirection(language: string): void {
  const dir = isRtl(language) ? 'rtl' : 'ltr';
  document.documentElement.setAttribute('dir', dir);
  document.documentElement.setAttribute('lang', language.split('-')[0]);
}

export default i18n;
