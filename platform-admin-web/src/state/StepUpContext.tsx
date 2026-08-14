/* eslint-disable react-refresh/only-export-components -- context module intentionally exports a hook alongside the provider */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { platformAdminAuthClient, PlatformAdminApiError } from '../api/platformAdminAuthClient';
import type { PlatformAdminStepUpScope } from '../domain/stepUpScopes';
import { useModalFocusTrap } from '../hooks/useModalFocusTrap';

interface PendingStepUp {
  scope: PlatformAdminStepUpScope;
  resolve: (stepUpId: string | null) => void;
}

interface StepUpContextValue {
  /** Resolves to a fresh stepUpId on success, or null if the operator cancelled / re-verification failed. Never assumes login MFA satisfies this -- always re-prompts for a live TOTP code (PCA-ADD-PA-017). */
  requestStepUp: (scope: PlatformAdminStepUpScope) => Promise<string | null>;
}

const StepUpContext = createContext<StepUpContextValue | undefined>(undefined);

export function StepUpProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [pending, setPending] = useState<PendingStepUp | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const codeInputRef = useRef<HTMLInputElement>(null);

  useModalFocusTrap(dialogRef, !!pending);

  useEffect(() => {
    if (pending) codeInputRef.current?.focus();
  }, [pending]);

  const requestStepUp = useCallback((scope: PlatformAdminStepUpScope) => {
    setCode('');
    setError(null);
    return new Promise<string | null>((resolve) => {
      setPending({ scope, resolve });
    });
  }, []);

  const handleCancel = useCallback(() => {
    if (!pending) return;
    pending.resolve(null);
    setPending(null);
  }, [pending]);

  const handleSubmit = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      if (!pending) return;
      setSubmitting(true);
      setError(null);
      try {
        const result = await platformAdminAuthClient.stepUp(pending.scope, code);
        pending.resolve(result.stepUpId);
        setPending(null);
      } catch (err) {
        if (err instanceof PlatformAdminApiError) {
          setError(t('stepUp.invalidCode'));
        } else {
          setError(t('common.unexpectedError'));
        }
      } finally {
        setSubmitting(false);
      }
    },
    [pending, code, t],
  );

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
            <p id="step-up-body">{t('stepUp.body', { scope: t(`stepUp.scopes.${pending.scope}`) })}</p>
            <form onSubmit={handleSubmit}>
              <label htmlFor="step-up-code">{t('stepUp.codeLabel')}</label>
              <input
                ref={codeInputRef}
                id="step-up-code"
                name="totpCode"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                required
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                aria-invalid={!!error}
                aria-describedby={error ? 'step-up-error' : undefined}
              />
              {error && (
                <p id="step-up-error" role="alert" className="field-error">
                  {error}
                </p>
              )}
              <div className="modal-actions">
                <button type="button" className="btn" onClick={handleCancel} disabled={submitting}>
                  {t('common.cancel')}
                </button>
                <button type="submit" className="btn btn-primary" disabled={submitting || code.length !== 6}>
                  {t('stepUp.confirm')}
                </button>
              </div>
            </form>
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
