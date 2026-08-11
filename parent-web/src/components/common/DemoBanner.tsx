import { useTranslation } from 'react-i18next';
import { getApiClients } from '../../api/client';

/**
 * Persistent visual indicator that the current screen is backed by
 * DEVELOPMENT_ONLY fixture data, never presented as if it were real
 * production family data.
 */
export function DemoBanner() {
  const { t } = useTranslation();
  const { isFixtureBacked } = getApiClients();
  if (!isFixtureBacked) return null;
  return (
    <div className="demo-banner" role="note">
      {t('demo.banner')}
    </div>
  );
}
