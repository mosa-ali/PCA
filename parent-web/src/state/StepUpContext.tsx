/* eslint-disable react-refresh/only-export-components -- context module intentionally exports a hook alongside the provider */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { getApiClients } from '../api/client';
import type { CommercialStepUpOperation } from '../api/interfaces';
import { ServiceAuthError } from '../api/real/realServiceAuthClient';
import { useModalFocusTrap } from '../hooks/useModalFocusTrap';
import { useOptionalAuth } from './AuthContext';

interface PendingStepUp {
  actionId: string;
  resolve: (granted: boolean) => void;
}

interface PendingCommercialStepUp {
  operation: CommercialStepUpOperation;
  resolve: (stepUpToken: string | null) => void;
}

interface StepUpContextValue {
  /** Generic (non-commercial) family-action re-authentication. */
  requestStepUp: (actionId: string) => Promise<boolean>;
  /**
   * PCA-DEC-037 commercial step-up: asks for a FRESH 6-digit authenticator
   * code, mints a single-use grant for exactly `operation`, and resolves to
   * its token -- or `null` when the parent cancels or cannot proceed. The
   * token is handed straight to the one mutation that needs it and is never
   * stored anywhere.
   */
  requestCommercialStepUp: (operation: CommercialStepUpOperation) => Promise<string | null>;
}

const StepUpContext = createContext<StepUpContextValue | undefined>(undefined);

/** Roles the server's COMMERCIAL_OWNER_AUTHORITY can ever accept (OWNER is the fixture-only internal trust owner). */
const COMMERCIAL_ROLES = new Set(['ADMINISTRATOR', 'OWNER']);

function CommercialStepUpDialog({ pending, onDone }: { pending: PendingCommercialStepUp; onDone: (token: string | null) => void }) {
  const { t } = useTranslation();
  const clients = getApiClients();
  const auth = useOptionalAuth();
  const session = auth?.session ?? null;
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [codeInvalid, setCodeInvalid] = useState(false);

  useModalFocusTrap(dialogRef, true);

  // UI guidance only -- the server enforces both rules. While the session is
  // still loading (or absent) the code form is shown and the server decides.
  const permitted = session === null || COMMERCIAL_ROLES.has(session.role);
  const hasAuthenticator = session === null || session.mfa.status === 'ACTIVE';

  useEffect(() => {
    if (permitted && hasAuthenticator) inputRef.current?.focus();
    else cancelRef.current?.focus();
  }, [permitted, hasAuthenticator]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setCodeInvalid(false);
    if (!/^\d{6}$/.test(code)) {
      setError(t('mfa.codeFormat'));
      setCodeInvalid(true);
      return;
    }
    setSubmitting(true);
    try {
      const grant = await clients.serviceAuth.issueCommercialStepUp(pending.operation, code);
      setCode('');
      onDone(grant.stepUpToken);
    } catch (err) {
      setCode('');
      if (err instanceof ServiceAuthError) {
        if (err.code === 'INVALID_MFA_CODE') {
          setError(t('mfa.invalidCode'));
          setCodeInvalid(true);
        } else if (err.code === 'MFA_LOCKED') setError(t('mfa.locked'));
        else if (err.code === 'RATE_LIMITED') setError(t('auth.rateLimited'));
        else if (err.code === 'FORBIDDEN') setError(t('stepUp.commercial.notPermitted'));
        else if (err.code === 'SESSION_EXPIRED') setError(t('mfa.sessionExpired'));
        else setError(t('auth.genericError'));
      } else {
        setError(t('auth.genericError'));
      }
      setSubmitting(false);
    }
  }

  const cancel = () => onDone(null);

  let content: ReactNode;
  if (!permitted) {
    content = (
      <>
        <h2 id="commercial-step-up-title">{t('stepUp.commercial.title')}</h2>
        <p id="commercial-step-up-body">{t('stepUp.commercial.notPermitted')}</p>
        <div className="modal-actions">
          <button ref={cancelRef} type="button" className="btn" onClick={cancel}>
            {t('common.cancel')}
          </button>
        </div>
      </>
    );
  } else if (!hasAuthenticator) {
    content = (
      <>
        <h2 id="commercial-step-up-title">{t('stepUp.commercial.setupRequiredTitle')}</h2>
        <p id="commercial-step-up-body">{t('stepUp.commercial.setupRequiredBody')}</p>
        <div className="modal-actions">
          <button ref={cancelRef} type="button" className="btn" onClick={cancel}>
            {t('common.cancel')}
          </button>
          <Link className="btn btn-primary" to="/mfa/setup" onClick={cancel}>
            {t('stepUp.commercial.setupLink')}
          </Link>
        </div>
      </>
    );
  } else {
    content = (
      <>
        <h2 id="commercial-step-up-title">{t('stepUp.commercial.title')}</h2>
        <p id="commercial-step-up-body">{t('stepUp.commercial.body')}</p>
        <form onSubmit={handleSubmit} noValidate>
          <div className="field">
            <label htmlFor="commercial-step-up-code">{t('mfa.codeLabel')}</label>
            <input
              ref={inputRef}
              id="commercial-step-up-code"
              name="totp"
              type="text"
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              autoComplete="one-time-code"
              required
              aria-describedby={error ? 'commercial-step-up-error' : undefined}
              aria-invalid={codeInvalid || undefined}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            />
          </div>
          {error && (
            <p id="commercial-step-up-error" role="alert" className="field-error">
              {error}
            </p>
          )}
          <div className="modal-actions">
            <button ref={cancelRef} type="button" className="btn" onClick={cancel} disabled={submitting}>
              {t('common.cancel')}
            </button>
            <button type="submit" className="btn btn-primary" disabled={submitting} aria-busy={submitting}>
              {t('stepUp.commercial.confirm')}
            </button>
          </div>
        </form>
      </>
    );
  }

  return (
    <div className="modal-overlay" role="presentation" onKeyDown={(e) => e.key === 'Escape' && !submitting && cancel()}>
      <div
        ref={dialogRef}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="commercial-step-up-title"
        aria-describedby="commercial-step-up-body"
      >
        {content}
      </div>
    </div>
  );
}

export function StepUpProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const clients = getApiClients();
  const [pending, setPending] = useState<PendingStepUp | null>(null);
  const [pendingCommercial, setPendingCommercial] = useState<PendingCommercialStepUp | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (pending) confirmButtonRef.current?.focus();
  }, [pending]);

  useModalFocusTrap(dialogRef, !!pending);

  const requestStepUp = useCallback((actionId: string) => {
    return new Promise<boolean>((resolve) => {
      setPending({ actionId, resolve });
    });
  }, []);

  const requestCommercialStepUp = useCallback((operation: CommercialStepUpOperation) => {
    return new Promise<string | null>((resolve) => {
      setPendingCommercial({ operation, resolve });
    });
  }, []);

  const handleCommercialDone = useCallback(
    (token: string | null) => {
      if (!pendingCommercial) return;
      pendingCommercial.resolve(token);
      setPendingCommercial(null);
    },
    [pendingCommercial],
  );

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
    <StepUpContext.Provider value={{ requestStepUp, requestCommercialStepUp }}>
      {children}
      {pendingCommercial && <CommercialStepUpDialog pending={pendingCommercial} onDone={handleCommercialDone} />}
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
