// PCA-FR-093: genuinely calls clients.retention.requestExport
// (backend/src/http/routes/retentionRoutes.ts's POST
// /v1/families/:familyId/export-requests) instead of only flipping local
// UI state. The status always reflects the backend's real 202-intake
// disposition (PENDING_CRYPTO_REVIEW) and disclosure text, never a
// fabricated completed export -- see that route's EXPORT_CREATION_DISCLOSURE
// doc comment for why an export is never claimed "generated" here.
import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { PermissionGate } from '../../rbac/PermissionGate';
import { useFamilyAction } from '../../rbac/useFamilyAction';
import { getApiClients } from '../../api/client';

export default function Export() {
  const { t } = useTranslation();
  const clients = getApiClients();
  const runFamilyAction = useFamilyAction();
  const [status, setStatus] = useState<string | null>(null);

  const doExport = async () => {
    try {
      await runFamilyAction('EXPORT_DATA', async () => {
        const result = await clients.retention.requestExport();
        setStatus(t('export.generatedStatus', { exportId: result.exportId }));
      });
    } catch (e) {
      setStatus(e instanceof Error ? e.message : t('common.deniedGeneric'));
    }
  };

  return (
    <section aria-labelledby="export-title">
      <h1 id="export-title">{t('nav.export')}</h1>
      <p>{t('export.description')}</p>
      <p style={{ color: 'var(--color-text-muted)' }}>{t('export.scopeNotice')}</p>
      <p style={{ color: 'var(--color-text-muted)' }}>{t('export.externalCopyNotice')}</p>
      {status && <p role="status">{status}</p>}
      <PermissionGate action="EXPORT_DATA" showDisabledFallback>
        <button type="button" className="btn btn-primary" onClick={doExport}>
          {t('nav.export')}
        </button>
      </PermissionGate>
    </section>
  );
}
