import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { PermissionGate } from '../../rbac/PermissionGate';
import { RecoverySecretLossDisclosure } from './RecoverySecretDisclosure';

export default function Recovery() {
  const { t } = useTranslation();
  const [lossDisclosureAcknowledged, setLossDisclosureAcknowledged] = useState(false);
  return (
    <section aria-labelledby="recovery-title">
      <h1 id="recovery-title">{t('nav.recovery')}</h1>
      <p>{t('recovery.description')}</p>
      <RecoverySecretLossDisclosure
        acknowledged={lossDisclosureAcknowledged}
        onAcknowledgedChange={(event) => setLossDisclosureAcknowledged(event.target.checked)}
      />
      <PermissionGate action="REVEAL_RECOVERY_MATERIAL" showDisabledFallback>
        <button type="button" className="btn btn-primary" disabled={!lossDisclosureAcknowledged}>
          {t('recovery.startTransaction')}
        </button>
      </PermissionGate>
    </section>
  );
}
