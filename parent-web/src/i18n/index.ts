import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import en from './locales/en.json';
import ar from './locales/ar.json';

export const RTL_LANGUAGES = new Set(['ar']);

export function isRtl(language: string): boolean {
  return RTL_LANGUAGES.has(language.split('-')[0]);
}

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
      order: ['querystring', 'navigator'],
      lookupQuerystring: 'lng',
      caches: [],
    },
  });

export function applyDocumentDirection(language: string): void {
  const dir = isRtl(language) ? 'rtl' : 'ltr';
  document.documentElement.setAttribute('dir', dir);
  document.documentElement.setAttribute('lang', language.split('-')[0]);
}

export default i18n;
