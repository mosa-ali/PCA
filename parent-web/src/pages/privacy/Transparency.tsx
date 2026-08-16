// PCA-FR-096/PCA-FR-121: "What parents can see" page. Pure content page
// (no backend calls) enumerating, in plain language, exactly what data
// categories are visible to a parent in this console and which are never
// collected/shown to anyone (including PCA itself) -- normative source is
// docs/architecture/03_FUNCTIONAL_REQUIREMENTS.md's PCA-FR-121 entry, kept
// aligned with docs/architecture/09_SECURITY_PRIVACY_E2EE.md Section 5.1/
// 5.2 (the canonical server-knowledge-boundary table) and doc 10 Section 4
// (the canonical activity-entity inventory). Per PCA-NFR-060/064, this page
// is also where any third-party SDK's specific data access is disclosed.
import { useTranslation } from 'react-i18next';

const VISIBLE_KEYS = ['appUsage', 'webBrowsing', 'contentBlocks', 'location', 'screenTime', 'eyeProtection', 'prayerReminders', 'deviceStatus', 'policyChanges'] as const;
const NOT_VISIBLE_KEYS = ['messages', 'screenshots', 'biometrics', 'preciseWithoutConsent', 'fullBrowsing', 'thirdParty'] as const;

export default function Transparency() {
  const { t } = useTranslation();

  return (
    <section aria-labelledby="transparency-title">
      <h1 id="transparency-title">{t('transparency.title')}</h1>
      <p>{t('transparency.intro')}</p>

      <div className="card">
        <h2>{t('transparency.visibleTitle')}</h2>
        <ul>
          {VISIBLE_KEYS.map((key) => (
            <li key={key}>{t(`transparency.visible.${key}`)}</li>
          ))}
        </ul>
      </div>

      <div className="card">
        <h2>{t('transparency.notVisibleTitle')}</h2>
        <ul>
          {NOT_VISIBLE_KEYS.map((key) => (
            <li key={key}>{t(`transparency.notVisible.${key}`)}</li>
          ))}
        </ul>
      </div>

      <p>{t('transparency.encryptionNote')}</p>
      <p>{t('transparency.sdkNote')}</p>
    </section>
  );
}
