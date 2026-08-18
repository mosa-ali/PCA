import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { applyDocumentDirection } from '../i18n';
import { getApiClients } from '../api/client';

export default function Settings() {
  const { t, i18n } = useTranslation();
  const clients = getApiClients();
  const [preferencesError, setPreferencesError] = useState<string | null>(null);

  useEffect(() => {
    void clients.parentPreferences.get().then((preferences) => {
      void i18n.changeLanguage(preferences.language);
      applyDocumentDirection(preferences.language);
    }).catch((error: unknown) => {
      setPreferencesError(error instanceof Error ? error.message : 'Unable to load settings.');
    });
  }, [clients.parentPreferences, i18n]);

  const setLanguage = async (language: 'en' | 'ar') => {
    void i18n.changeLanguage(language);
    applyDocumentDirection(language);
    try {
      await clients.parentPreferences.update({ language });
      setPreferencesError(null);
    } catch (error) {
      setPreferencesError(error instanceof Error ? error.message : 'Unable to save language preference.');
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
