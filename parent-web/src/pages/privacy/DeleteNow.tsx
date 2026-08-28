// PCA-FR-093: the confirm action genuinely calls
// clients.retention.deleteNow (backend/src/http/routes/retentionRoutes.ts's
// POST /v1/families/:familyId/delete-now) instead of only flipping local
// UI state. actionId is a fresh client-generated id per confirm so a
// retried submit is idempotent server-side (see that route's own
// scoped-actionId doc comment). The status message always reflects the
// backend's real disclosed disposition (DELETE_PENDING_REMOTE_DEVICE),
// never a fabricated "done".
import { useTranslation } from 'react-i18next';
import { useEffect, useRef, useState } from 'react';
import { PermissionGate } from '../../rbac/PermissionGate';
import { useFamilyAction } from '../../rbac/useFamilyAction';
import { useModalFocusTrap } from '../../hooks/useModalFocusTrap';
import { getApiClients } from '../../api/client';
import type { DeleteNowResult } from '../../domain/retention';

export default function DeleteNow() {
  const { t } = useTranslation();
  const clients = getApiClients();
  const runFamilyAction = useFamilyAction();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [plan, setPlan] = useState<DeleteNowResult['plan'] | null>(null);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (confirmOpen) confirmButtonRef.current?.focus();
  }, [confirmOpen]);

  useModalFocusTrap(dialogRef, confirmOpen);

  const confirmDelete = async () => {
    try {
      await runFamilyAction('DELETE_HISTORY', async () => {
        const actionId = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `delete-now-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const result = await clients.retention.deleteNow(actionId);
        // The backend's literal enum (DELETE_PENDING_REMOTE_DEVICE) used to be
        // interpolated straight into the sentence a parent reads. The
        // disposition itself is unchanged -- still always "pending", never
        // "done" -- only its presentation is now a translated label.
        setStatus(
          t('deleteNow.issuedStatus', {
            status: t(`deleteNow.deliveryStatusValue.${result.deliveryStatus}`, {
              defaultValue: result.deliveryStatus,
            }),
          }),
        );
        setPlan(result.plan);
      });
    } catch (e) {
      setStatus(e instanceof Error ? e.message : t('common.deniedGeneric'));
      setPlan(null);
    } finally {
      setConfirmOpen(false);
    }
  };

  return (
    <section aria-labelledby="delete-title">
      <h1 id="delete-title">{t('nav.deleteNow')}</h1>
      <p>{t('deleteNow.description')}</p>
      {status && <p role="status">{status}</p>}
      {plan && (
        <p role="status">{t('deleteNow.planSummary', { count: plan.toDelete.length, retained: plan.retainedCount })}</p>
      )}
      <PermissionGate action="DELETE_HISTORY" showDisabledFallback>
        <button type="button" className="btn" onClick={() => setConfirmOpen(true)}>
          {t('nav.deleteNow')}
        </button>
      </PermissionGate>
      {confirmOpen && (
        <div className="modal-overlay" role="presentation" onKeyDown={(e) => e.key === 'Escape' && setConfirmOpen(false)}>
          <div ref={dialogRef} className="modal" role="dialog" aria-modal="true" aria-labelledby="delete-confirm-title">
            <h2 id="delete-confirm-title">{t('common.confirm')}</h2>
            <p>{t('deleteNow.confirmBody')}</p>
            <p>{t('deleteNow.scopeNotice')}</p>
            <p>{t('deleteNow.offlineNotice')}</p>
            <p>{t('deleteNow.externalCopyNotice')}</p>
            <p>{t('deleteNow.secureEraseNotice')}</p>
            <div className="modal-actions">
              <button type="button" className="btn" onClick={() => setConfirmOpen(false)}>
                {t('common.cancel')}
              </button>
              <button ref={confirmButtonRef} type="button" className="btn btn-primary" onClick={confirmDelete}>
                {t('common.confirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
