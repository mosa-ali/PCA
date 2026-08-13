import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { PermissionGate } from '../../rbac/PermissionGate';
import { useFamilyAction } from '../../rbac/useFamilyAction';

export default function Retention() {
  const { t } = useTranslation();
  const runFamilyAction = useFamilyAction();
  const [status, setStatus] = useState<string | null>(null);

  const save = async () => {
    try {
      await runFamilyAction('CHANGE_RETENTION', async () => {
        setStatus(t('retention.updatedStatus'));
      });
    } catch (e) {
      setStatus(e instanceof Error ? e.message : t('common.deniedGeneric'));
    }
  };

  return (
    <section aria-labelledby="retention-title">
      <h1 id="retention-title">{t('nav.retention')}</h1>
      <p>{t('retention.description')}</p>
      {status && <p role="status">{status}</p>}
      <PermissionGate action="CHANGE_RETENTION" showDisabledFallback>
        <button type="button" className="btn btn-primary" onClick={save}>
          {t('common.save')}
        </button>
      </PermissionGate>
    </section>
  );
}
