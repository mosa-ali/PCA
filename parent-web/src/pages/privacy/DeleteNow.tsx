import { useTranslation } from 'react-i18next';
import { useEffect, useRef, useState } from 'react';
import { PermissionGate } from '../../rbac/PermissionGate';
import { useFamilyAction } from '../../rbac/useFamilyAction';
import { useModalFocusTrap } from '../../hooks/useModalFocusTrap';

export default function DeleteNow() {
  const { t } = useTranslation();
  const runFamilyAction = useFamilyAction();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (confirmOpen) confirmButtonRef.current?.focus();
  }, [confirmOpen]);

  useModalFocusTrap(dialogRef, confirmOpen);

  const confirmDelete = async () => {
    try {
      await runFamilyAction('DELETE_HISTORY', async () => {
        setStatus(t('deleteNow.issuedStatus'));
      });
    } catch (e) {
      setStatus(e instanceof Error ? e.message : t('common.deniedGeneric'));
    } finally {
      setConfirmOpen(false);
    }
  };

  return (
    <section aria-labelledby="delete-title">
      <h1 id="delete-title">{t('nav.deleteNow')}</h1>
      <p>{t('deleteNow.description')}</p>
      {status && <p role="status">{status}</p>}
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
