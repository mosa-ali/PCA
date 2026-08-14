import { useTranslation } from 'react-i18next';

interface ComingSoonProps {
  titleKey: string;
  /** Short, factual note on exactly which backend endpoint/domain is missing -- shown to operators so this reads as an honest gap, never a bug report. */
  backendGapNote: string;
}

/**
 * Renders in place of any screen whose backend HTTP surface does not exist
 * yet (mission Section 10: "Do not expose screens unsupported by source as
 * fake working features... Future sections may show COMING_SOON only when
 * architecture requires them but backend is intentionally not implemented
 * yet."). Never renders placeholder/sample data.
 */
export function ComingSoon({ titleKey, backendGapNote }: ComingSoonProps) {
  const { t } = useTranslation();
  return (
    <div className="card coming-soon" role="status">
      <h2>{t(titleKey)}</h2>
      <p className="coming-soon-badge">{t('common.comingSoonTitle')}</p>
      <p>{t('common.comingSoonBody')}</p>
      <p className="backend-gap-note">
        <strong>{t('common.backendGapLabel')}</strong> {backendGapNote}
      </p>
    </div>
  );
}
