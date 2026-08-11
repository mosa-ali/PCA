import { useTranslation } from 'react-i18next';
import { PermissionGate } from '../../rbac/PermissionGate';

export default function Recovery() {
  const { t } = useTranslation();
  return (
    <section aria-labelledby="recovery-title">
      <h1 id="recovery-title">{t('nav.recovery')}</h1>
      <p>
        Recovery material (the Recovery Secret) is never displayed by PCA infrastructure and is never shown here in
        readable form. This screen only lets the Owner start an authenticated recovery transaction.
      </p>
      <PermissionGate action="REVEAL_RECOVERY_MATERIAL" showDisabledFallback>
        <button type="button" className="btn btn-primary">
          Start recovery transaction (dev stub)
        </button>
      </PermissionGate>
    </section>
  );
}
