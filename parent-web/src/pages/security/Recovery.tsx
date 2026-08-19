import { useTranslation } from 'react-i18next';
import { PermissionGate } from '../../rbac/PermissionGate';
import { RecoverySecretLossDisclosure } from './RecoverySecretDisclosure';

export default function Recovery() {
  const { t } = useTranslation();
  return (
    <section aria-labelledby="recovery-title">
      <h1 id="recovery-title">{t('nav.recovery')}</h1>
      <p>{t('recovery.description')}</p>
      <RecoverySecretLossDisclosure />
      <PermissionGate action="REVEAL_RECOVERY_MATERIAL" showDisabledFallback>
        <button type="button" className="btn btn-primary">
          {t('recovery.startTransaction')}
        </button>
      </PermissionGate>
    </section>
  );
}
