import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { PermissionGate } from '../../rbac/PermissionGate';
import { useFamilyAction } from '../../rbac/useFamilyAction';

export default function Export() {
  const { t } = useTranslation();
  const runFamilyAction = useFamilyAction();
  const [status, setStatus] = useState<string | null>(null);

  const doExport = async () => {
    try {
      await runFamilyAction('EXPORT_DATA', async () => {
        setStatus('Export generated locally in this browser (dev stub) -- never proxied through a server.');
      });
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'Denied');
    }
  };

  return (
    <section aria-labelledby="export-title">
      <h1 id="export-title">{t('nav.export')}</h1>
      <p>An export is generated and encrypted entirely on this device; only the family&rsquo;s own key material can open it.</p>
      {status && <p role="status">{status}</p>}
      <PermissionGate action="EXPORT_DATA" showDisabledFallback>
        <button type="button" className="btn btn-primary" onClick={doExport}>
          {t('nav.export')}
        </button>
      </PermissionGate>
    </section>
  );
}
