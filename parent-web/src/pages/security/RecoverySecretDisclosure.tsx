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
    // Not <aside>: a complementary landmark nested inside Recovery.tsx's own
    // <section aria-labelledby="recovery-title"> region landmark fails
    // axe's landmark-complementary-is-top-level rule (complementary content
    // must be a sibling of main content, never nested inside another named
    // landmark). This warning genuinely belongs inside the Recovery page's
    // own flow, not as page-level complementary content, so a plain,
    // still-labelled group is the correct fix, not moving the DOM position.
    <div className="card" aria-labelledby="recovery-secret-loss-title">
      <h2 id="recovery-secret-loss-title">{t('recovery.secretDisclosureTitle')}</h2>
      <p>{t('recovery.secretDisclosureBody')}</p>
      <p>{t('recovery.secretDisclosureWarning')}</p>
      <label className="checkbox-row">
        <input type="checkbox" checked={acknowledged} onChange={onAcknowledgedChange} />
        {t('recovery.secretDisclosureAcknowledgement')}
      </label>
    </div>
  );
}
