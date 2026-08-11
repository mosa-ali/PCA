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
        setStatus('Retention updated (dev stub -- no real backend yet).');
      });
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'Denied');
    }
  };

  return (
    <section aria-labelledby="retention-title">
      <h1 id="retention-title">{t('nav.retention')}</h1>
      <p>Retention/deletion of family activity is enforced locally by the device holding the plaintext; this screen only sets the family-level policy value that devices honor.</p>
      {status && <p role="status">{status}</p>}
      <PermissionGate action="CHANGE_RETENTION" showDisabledFallback>
        <button type="button" className="btn btn-primary" onClick={save}>
          {t('common.save')}
        </button>
      </PermissionGate>
    </section>
  );
}
