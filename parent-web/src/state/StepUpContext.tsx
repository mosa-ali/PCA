/* eslint-disable react-refresh/only-export-components -- context module intentionally exports a hook alongside the provider */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { getApiClients } from '../api/client';

interface PendingStepUp {
  actionId: string;
  resolve: (granted: boolean) => void;
}

interface StepUpContextValue {
  requestStepUp: (actionId: string) => Promise<boolean>;
}

const StepUpContext = createContext<StepUpContextValue | undefined>(undefined);

export function StepUpProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const clients = getApiClients();
  const [pending, setPending] = useState<PendingStepUp | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (pending) confirmButtonRef.current?.focus();
  }, [pending]);

  const requestStepUp = useCallback((actionId: string) => {
    return new Promise<boolean>((resolve) => {
      setPending({ actionId, resolve });
    });
  }, []);

  const handleConfirm = useCallback(async () => {
    if (!pending) return;
    const result = await clients.serviceAuth.stepUp(pending.actionId);
    pending.resolve(result.granted);
    setPending(null);
  }, [pending, clients]);

  const handleCancel = useCallback(() => {
    if (!pending) return;
    pending.resolve(false);
    setPending(null);
  }, [pending]);

  return (
    <StepUpContext.Provider value={{ requestStepUp }}>
      {children}
      {pending && (
        <div className="modal-overlay" role="presentation" onKeyDown={(e) => e.key === 'Escape' && handleCancel()}>
          <div
            ref={dialogRef}
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="step-up-title"
            aria-describedby="step-up-body"
          >
            <h2 id="step-up-title">{t('stepUp.title')}</h2>
            <p id="step-up-body">{t('stepUp.body')}</p>
            <div className="modal-actions">
              <button type="button" className="btn" onClick={handleCancel}>
                {t('common.cancel')}
              </button>
              <button ref={confirmButtonRef} type="button" className="btn btn-primary" onClick={handleConfirm}>
                {t('stepUp.confirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </StepUpContext.Provider>
  );
}

export function useStepUp(): StepUpContextValue {
  const ctx = useContext(StepUpContext);
  if (!ctx) throw new Error('useStepUp must be used within StepUpProvider');
  return ctx;
}
