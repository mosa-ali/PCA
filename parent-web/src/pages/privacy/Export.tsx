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
        setStatus(t('export.generatedStatus'));
      });
    } catch (e) {
      setStatus(e instanceof Error ? e.message : t('common.deniedGeneric'));
    }
  };

  return (
    <section aria-labelledby="export-title">
      <h1 id="export-title">{t('nav.export')}</h1>
      <p>{t('export.description')}</p>
      {status && <p role="status">{status}</p>}
      <PermissionGate action="EXPORT_DATA" showDisabledFallback>
        <button type="button" className="btn btn-primary" onClick={doExport}>
          {t('nav.export')}
        </button>
      </PermissionGate>
    </section>
  );
}
