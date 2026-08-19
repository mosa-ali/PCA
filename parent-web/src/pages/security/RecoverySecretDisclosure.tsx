import type { ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * PCA-FR-144: this is deliberately a local display component. It does not
 * fetch, render, or accept the Recovery Secret. The warning is shown on the
 * reachable Recovery page before the Owner can begin an authenticated flow.
 */
export function RecoverySecretLossDisclosure({
  acknowledged,
  onAcknowledgedChange,
}: {
  acknowledged: boolean;
  onAcknowledgedChange: (event: ChangeEvent<HTMLInputElement>) => void;
}) {
  const { t } = useTranslation();
  return (
    <aside className="card" aria-labelledby="recovery-secret-loss-title">
      <h2 id="recovery-secret-loss-title">{t('recovery.secretDisclosureTitle')}</h2>
      <p>{t('recovery.secretDisclosureBody')}</p>
      <p>{t('recovery.secretDisclosureWarning')}</p>
      <label className="checkbox-row">
        <input type="checkbox" checked={acknowledged} onChange={onAcknowledgedChange} />
        {t('recovery.secretDisclosureAcknowledgement')}
      </label>
    </aside>
  );
}
