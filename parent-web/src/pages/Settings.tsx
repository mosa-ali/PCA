import { useTranslation } from 'react-i18next';
import { applyDocumentDirection } from '../i18n';

export default function Settings() {
  const { t, i18n } = useTranslation();
  return (
    <section aria-labelledby="settings-title">
      <h1 id="settings-title">{t('nav.settings')}</h1>
      <div className="field">
        <label htmlFor="lang-select">{t('shell.language')}</label>
        <select
          id="lang-select"
          value={i18n.language.split('-')[0]}
          onChange={(e) => {
            void i18n.changeLanguage(e.target.value);
            applyDocumentDirection(e.target.value);
          }}
        >
          <option value="en">English</option>
          <option value="ar">العربية</option>
        </select>
      </div>
    </section>
  );
}
