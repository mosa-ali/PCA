import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { applyDocumentDirection, hasStoredLanguagePreference } from '../i18n';
import { errorDiagnosticDetail, userFacingErrorKey } from '../i18n/errorMessages';
import { getApiClients } from '../api/client';

export default function Settings() {
  const { t, i18n } = useTranslation();
  const clients = getApiClients();
  const [preferencesError, setPreferencesError] = useState<string | null>(null);

  useEffect(() => {
    void clients.parentPreferences.get().then((preferences) => {
      // The account-level saved preference seeds a browser that has never been
      // given an explicit choice. Once the parent has chosen a language here or
      // in the header, that choice is persisted by i18next (see ../i18n) and
      // survives reloads, so it must not be overwritten on every visit to this
      // page -- otherwise opening Settings would silently undo the choice the
      // parent just made.
      if (hasStoredLanguagePreference()) return;
      void i18n.changeLanguage(preferences.language);
      applyDocumentDirection(preferences.language);
    }).catch((error: unknown) => {
      console.error('[pca] loading parent preferences failed:', errorDiagnosticDetail(error), error);
      setPreferencesError(t('settings.loadPreferencesFailed'));
    });
  }, [clients.parentPreferences, i18n, t]);

  const setLanguage = async (language: 'en' | 'ar') => {
    // changeLanguage also writes the choice to this browser's language cache
    // (i18next `caches: ['localStorage']`, see ../i18n), which is what makes it
    // survive the next page load even if the account-level save below fails.
    void i18n.changeLanguage(language);
    applyDocumentDirection(language);
    try {
      await clients.parentPreferences.update({ language });
      setPreferencesError(null);
    } catch (error) {
      console.error('[pca] saving language preference failed:', errorDiagnosticDetail(error), error);
      // A known, describable failure (untrusted browser endpoint, backend not
      // wired yet) keeps its own honest copy; anything else gets the
      // save-specific sentence rather than a raw `error.message`.
      const knownKey = userFacingErrorKey(error);
      setPreferencesError(knownKey ? t(knownKey) : t('settings.saveLanguageFailed'));
    }
  };
  return (
    <section aria-labelledby="settings-title">
      <h1 id="settings-title">{t('nav.settings')}</h1>
      <div className="field">
        <label htmlFor="lang-select">{t('shell.language')}</label>
        <select
          id="lang-select"
          value={i18n.language.split('-')[0]}
          onChange={(e) => {
            void setLanguage(e.target.value as 'en' | 'ar');
          }}
        >
          <option value="en">English</option>
          <option value="ar">العربية</option>
        </select>
      </div>
      {preferencesError && <p role="alert">{preferencesError}</p>}
    </section>
  );
}
